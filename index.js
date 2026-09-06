require("dotenv").config();

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestWaWebVersion
} = require("@whiskeysockets/baileys");

const P = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const figlet = require("figlet");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const express = require("express");

const { handleCommand } = require("./src/commands");

// ============================================================
// NEXORA MULTI-SESSION CONFIG
// ============================================================

const BOT_NAME = process.env.BOT_NAME || "Nexora Bot Mini";
const AUTHOR = process.env.AUTHOR || "Boycoe-dev";
const PREFIX = process.env.PREFIX || ".";
const PORT = Number(process.env.PORT) || 3000;
const MAX_SESSIONS = 3;

const OWNER_NUMBER = String(process.env.OWNER_NUMBER || "")
    .replace(/\D/g, "");

const DASHBOARD_TOKEN = String(
    process.env.DASHBOARD_TOKEN || ""
).trim();

// Render Free has an ephemeral filesystem. SESSION_ROOT can be changed
// later to a persistent storage location on a paid Render disk.
const SESSION_ROOT = path.resolve(
    process.env.SESSION_ROOT ||
    (process.env.RENDER ? "/tmp/nexora-sessions" : "./sessions")
);

const MENU_IMAGE = process.env.MENU_IMAGE ||
    "https://i.ibb.co/xtLwMf12/file-00000000561c824699096bbdc5566486.png";

const settingsDefaults = {
    autoreact: false,
    autostatus: true,
    antibadword: false,
    antilink: false,
    antidelete: false,
    anticall: false,
    welcome: false,
    goodbye: false
};

if (!OWNER_NUMBER) {
    console.warn(chalk.yellow(
        "⚠️ OWNER_NUMBER is not configured. Owner-only commands will be unavailable."
    ));
}

if (!DASHBOARD_TOKEN) {
    console.warn(chalk.yellow(
        "⚠️ DASHBOARD_TOKEN is not configured. Protected session-management endpoints are disabled."
    ));
}

// ============================================================
// SESSION STATE
// ============================================================

const sessions = new Map();

function sessionDir(slot) {
    return path.join(SESSION_ROOT, `session-${slot}`);
}

function createSessionState(slot) {
    return {
        slot,
        sock: null,
        reconnectTimer: null,
        reconnectAttempts: 0,
        pairingCode: null,
        qrDataUrl: null,
        connection: "idle",
        botId: null,
        name: null,
        lastUpdate: new Date().toISOString(),
        settings: { ...settingsDefaults },
        messageStore: new Map(),
        linkWarnings: new Map(),
        pairingInProgress: false,
        stopping: false
    };
}

for (let slot = 1; slot <= MAX_SESSIONS; slot++) {
    sessions.set(slot, createSessionState(slot));
}

function setSessionStatus(state, updates = {}) {
    Object.assign(state, updates, {
        lastUpdate: new Date().toISOString()
    });
}

function publicSession(state) {
    return {
        slot: state.slot,
        connection: state.connection,
        botId: state.botId,
        name: state.name,
        pairingCode: state.pairingCode,
        qrDataUrl: state.qrDataUrl,
        lastUpdate: state.lastUpdate,
        uptime: process.uptime()
    };
}

function getSlot(value) {
    const slot = Number(value);
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SESSIONS) {
        return null;
    }
    return slot;
}

function hasCredentials(slot) {
    return fs.existsSync(path.join(sessionDir(slot), "creds.json"));
}

function ensureSessionDir(slot) {
    fs.mkdirSync(sessionDir(slot), { recursive: true });
}

function removeSessionFiles(slot) {
    const dir = sessionDir(slot);
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// ============================================================
// SECURITY / RATE LIMITING
// ============================================================

function getDashboardToken(req) {
    const authorization = req.get("authorization");
    if (authorization) {
        const match = authorization.match(/^Bearer\s+(.+)$/i);
        if (match) return match[1].trim();
    }

    const headerToken = req.get("x-dashboard-token");
    return headerToken ? headerToken.trim() : null;
}

function requireDashboardToken(req, res, next) {
    if (!DASHBOARD_TOKEN) {
        return res.status(503).json({
            success: false,
            error: "Dashboard authentication is not configured."
        });
    }

    if (getDashboardToken(req) !== DASHBOARD_TOKEN) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized."
        });
    }

    next();
}

const pairAttempts = new Map();
const PAIR_WINDOW_MS = 60 * 1000;
const MAX_PAIR_ATTEMPTS = 5;

function checkPairRateLimit(ip) {
    const now = Date.now();
    const current = pairAttempts.get(ip);

    if (!current || now - current.startedAt >= PAIR_WINDOW_MS) {
        pairAttempts.set(ip, { startedAt: now, count: 1 });
        return true;
    }

    if (current.count >= MAX_PAIR_ATTEMPTS) return false;
    current.count++;
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of pairAttempts) {
        if (now - data.startedAt >= PAIR_WINDOW_MS) {
            pairAttempts.delete(ip);
        }
    }
}, PAIR_WINDOW_MS).unref();

// ============================================================
// MESSAGE / GROUP HELPERS
// ============================================================

const LINK_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+|chat\.whatsapp\.com\/[^\s]+)/i;
const MAX_LINK_WARNINGS = 3;
const MAX_STORED_MESSAGES = 200;

function storeMessage(state, message) {
    if (!message?.key?.id) return;
    state.messageStore.set(message.key.id, message);

    while (state.messageStore.size > MAX_STORED_MESSAGES) {
        const oldest = state.messageStore.keys().next().value;
        if (!oldest) break;
        state.messageStore.delete(oldest);
    }
}

function getMessageText(message) {
    return (
        message?.message?.conversation ||
        message?.message?.extendedTextMessage?.text ||
        message?.message?.imageMessage?.caption ||
        message?.message?.videoMessage?.caption ||
        ""
    );
}

// ============================================================
// PAIRING WEBSITE
// ============================================================

const PAIRING_HTML = fs.readFileSync(path.join(__dirname, "public", "pairing.html"), "utf8");

// ============================================================
// EXPRESS SERVER
// ============================================================

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => res.type("html").send(PAIRING_HTML));

app.get("/health", (req, res) => {
    res.json({
        success: true,
        name: BOT_NAME,
        sessions: [...sessions.values()].map(s => ({
            slot: s.slot,
            connection: s.connection
        })),
        uptime: process.uptime()
    });
});

app.get("/api/sessions", (req, res) => {
    res.json({
        success: true,
        maxSessions: MAX_SESSIONS,
        sessions: [...sessions.values()].map(publicSession)
    });
});

app.post("/api/pair", async (req, res) => {
    try {
        const ip = req.ip || req.socket?.remoteAddress || "unknown";
        if (!checkPairRateLimit(ip)) {
            return res.status(429).json({
                success: false,
                error: "Too many pairing attempts. Please wait one minute."
            });
        }

        const slot = getSlot(req.body?.slot);
        const phone = String(req.body?.phone || "").replace(/\D/g, "");

        if (!slot) {
            return res.status(400).json({ success: false, error: "Choose session 1, 2, or 3." });
        }

        if (phone.length < 8 || phone.length > 15) {
            return res.status(400).json({ success: false, error: "Enter a valid phone number with country code." });
        }

        const state = sessions.get(slot);
        if (state.pairingInProgress) {
            return res.status(409).json({ success: false, error: "Pairing is already being generated for this slot." });
        }

        if (state.connection === "open") {
            return res.status(409).json({ success: false, error: "This session is already connected." });
        }

        state.pairingInProgress = true;

        if (state.sock) {
            try { state.stopping = true; state.sock.end(new Error("Replacing session for pairing")); } catch {}
            state.sock = null;
        }

        // A logged-out/failed session cannot be reused safely.
        removeSessionFiles(slot);
        state.messageStore.clear();
        state.linkWarnings.clear();
        state.reconnectAttempts = 0;
        setSessionStatus(state, {
            connection: "pairing",
            pairingCode: null,
            qrDataUrl: null,
            botId: null,
            name: null
        });

        const sock = await createSocket(state, true);
        await new Promise(resolve => setTimeout(resolve, 1800));

        if (!sock.requestPairingCode) {
            throw new Error("Pairing codes are unavailable in this Baileys build.");
        }

        const code = await sock.requestPairingCode(phone);
        state.pairingCode = code;
        state.pairingInProgress = false;
        setSessionStatus(state, { connection: "pairing", pairingCode: code });

        return res.json({ success: true, slot, code });
    } catch (error) {
        const slot = getSlot(req.body?.slot);
        if (slot) {
            const state = sessions.get(slot);
            state.pairingInProgress = false;
            setSessionStatus(state, { connection: "idle", pairingCode: null, qrDataUrl: null });
        }

        console.error(chalk.red("Pairing error:"), error);
        return res.status(500).json({
            success: false,
            error: error?.message || "Failed to generate pairing code."
        });
    }
});

app.get("/api/admin/sessions", requireDashboardToken, (req, res) => {
    res.json({
        success: true,
        sessions: [...sessions.values()].map(s => ({
            ...publicSession(s),
            settings: s.settings
        }))
    });
});

app.post("/api/admin/logout", requireDashboardToken, async (req, res) => {
    const slot = getSlot(req.body?.slot);
    if (!slot) return res.status(400).json({ success: false, error: "Invalid session slot." });

    const state = sessions.get(slot);
    try {
        state.stopping = true;
        if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
        if (state.sock) {
            try { state.sock.end(new Error("Session logged out from dashboard")); } catch {}
        }
        removeSessionFiles(slot);
        state.sock = null;
        state.reconnectAttempts = 0;
        state.pairingCode = null;
        state.qrDataUrl = null;
        state.botId = null;
        state.name = null;
        state.pairingInProgress = false;
        state.messageStore.clear();
        state.linkWarnings.clear();
        state.settings = { ...settingsDefaults };
        state.stopping = false;
        setSessionStatus(state, { connection: "idle" });
        return res.json({ success: true, slot });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(chalk.green(`🌐 Nexora pairing site running on port ${PORT}`));
});

// ============================================================
// WHATSAPP SESSION ENGINE
// ============================================================

async function createSocket(state, pairingRequested = false) {
    const slot = state.slot;
    ensureSessionDir(slot);

    const { state: authState, saveCreds } = await useMultiFileAuthState(sessionDir(slot));

    let version;
    try {
        const latest = await fetchLatestWaWebVersion();
        version = latest?.version;
    } catch (error) {
        console.warn(chalk.yellow(`⚠️ Session ${slot}: could not fetch latest WhatsApp Web version.`));
    }

    const sock = makeWASocket({
        auth: authState,
        logger: P({ level: process.env.LOG_LEVEL || "silent" }),
        printQRInTerminal: false,
        browser: ["Nexora", "Chrome", "1.0.0"],
        ...(version ? { version } : {}),
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: false
    });

    state.sock = sock;
    state.stopping = false;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async update => {
        await handleConnectionUpdate(state, update);
    });

    sock.ev.on("group-participants.update", async update => {
        await handleGroupParticipants(state, update);
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        await handleMessages(state, messages);
    });

    sock.ev.on("messages.update", async updates => {
        await handleDeletedMessages(state, updates);
    });

    sock.ev.on("call", async calls => {
        await handleCalls(state, calls);
    });

    if (pairingRequested) {
        setSessionStatus(state, { connection: "pairing" });
    }

    return sock;
}

async function handleConnectionUpdate(state, update) {
    const { connection, lastDisconnect, qr } = update;
    const sock = state.sock;

    if (connection) setSessionStatus(state, { connection });

    if (qr) {
        try {
            qrcodeTerminal.generate(qr, { small: true });
            state.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
            setSessionStatus(state, { qrDataUrl: state.qrDataUrl, connection: "pairing" });
        } catch (error) {
            console.error(chalk.red(`Session ${state.slot} QR error:`), error);
        }
    }

    if (connection === "open") {
        state.reconnectAttempts = 0;
        state.pairingInProgress = false;
        setSessionStatus(state, {
            connection: "open",
            botId: sock?.user?.id || null,
            name: sock?.user?.name || null,
            pairingCode: null,
            qrDataUrl: null
        });
        console.log(chalk.green(`✅ Session ${state.slot} connected: ${state.botId || "WhatsApp"}`));
        return;
    }

    if (connection !== "close") return;

    const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
    console.log(chalk.yellow(`⚠️ Session ${state.slot} closed. Code: ${statusCode || "unknown"}`));

    state.sock = null;
    state.pairingInProgress = false;

    if (state.stopping) {
        setSessionStatus(state, { connection: "idle", pairingCode: null, qrDataUrl: null });
        return;
    }

    if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.badSession) {
        removeSessionFiles(state.slot);
        setSessionStatus(state, {
            connection: statusCode === DisconnectReason.loggedOut ? "logged_out" : "bad_session",
            pairingCode: null,
            qrDataUrl: null,
            botId: null
        });
        return;
    }

    scheduleReconnect(state);
}

function scheduleReconnect(state) {
    if (state.stopping || state.reconnectTimer) return;

    state.reconnectAttempts++;
    const delay = Math.min(60_000, 5_000 * (2 ** Math.min(state.reconnectAttempts - 1, 3)));

    setSessionStatus(state, { connection: "reconnecting" });
    console.log(chalk.yellow(`🔄 Session ${state.slot}: reconnecting in ${Math.round(delay / 1000)}s...`));

    state.reconnectTimer = setTimeout(async () => {
        state.reconnectTimer = null;
        if (state.stopping) return;
        try {
            await createSocket(state);
        } catch (error) {
            console.error(chalk.red(`Session ${state.slot} reconnect failed:`), error);
            scheduleReconnect(state);
        }
    }, delay);
}

async function handleGroupParticipants(state, update) {
    const { id, participants, action } = update;
    if (!state.settings.welcome && !state.settings.goodbye) return;

    try {
        const metadata = await state.sock.groupMetadata(id);
        for (const participant of participants) {
            const number = participant.split("@")[0];
            if (action === "add" && state.settings.welcome) {
                await state.sock.sendMessage(id, {
                    text: `👋 Welcome @${number} to *${metadata.subject}*!`,
                    mentions: [participant]
                });
            }
            if (action === "remove" && state.settings.goodbye) {
                await state.sock.sendMessage(id, {
                    text: `👋 Goodbye @${number}!`,
                    mentions: [participant]
                });
            }
        }
    } catch (error) {
        console.error(chalk.red(`Session ${state.slot} group event error:`), error);
    }
}

async function handleMessages(state, messages) {
    const sock = state.sock;
    if (!sock) return;

    for (const msg of messages) {
        if (!msg?.message) continue;

        try {
            if (state.settings.antidelete && msg.key?.id) {
                storeMessage(state, msg);
            }

            if (state.settings.autostatus && msg.key?.remoteJid === "status@broadcast") {
                try { await sock.readMessages([msg.key]); } catch {}
            }

            if (state.settings.antilink && msg.key?.remoteJid?.endsWith("@g.us")) {
                await handleAntiLink(state, msg);
            }

            await handleCommand(sock, msg, {
                startTime: process.uptime(),
                settings: state.settings
            });
        } catch (error) {
            console.error(chalk.red(`Session ${state.slot} message handler error:`), error);
        }
    }
}

async function handleAntiLink(state, msg) {
    const sock = state.sock;
    const text = getMessageText(msg);
    if (!LINK_REGEX.test(text)) return;

    const groupJid = msg.key.remoteJid;
    const sender = msg.key.participant;
    if (!sender) return;

    try {
        const metadata = await sock.groupMetadata(groupJid);
        const senderParticipant = metadata.participants.find(p => p.id === sender);
        const isSenderAdmin = Boolean(senderParticipant?.admin);
        const botId = sock.user?.id;
        const botNumber = botId?.split(":")[0]?.split("@")[0];
        const isBotAdmin = metadata.participants.some(p =>
            p.id === botId || p.id?.startsWith(`${botNumber}@`)
        );

        if (isSenderAdmin || sender.split("@")[0] === OWNER_NUMBER || !isBotAdmin) return;

        try { await sock.sendMessage(groupJid, { delete: msg.key }); } catch {}

        const warningKey = `${groupJid}:${sender}`;
        const current = (state.linkWarnings.get(warningKey) || 0) + 1;
        state.linkWarnings.set(warningKey, current);

        if (current >= MAX_LINK_WARNINGS) {
            try {
                await sock.groupParticipantsUpdate(groupJid, [sender], "remove");
            } catch (error) {
                console.error(chalk.red(`Session ${state.slot} anti-link removal error:`), error);
            }
            state.linkWarnings.delete(warningKey);
        } else {
            await sock.sendMessage(groupJid, {
                text: `⚠️ @${sender.split("@")[0]} links are not allowed here.\n\nWarning ${current}/${MAX_LINK_WARNINGS}`,
                mentions: [sender]
            });
        }
    } catch (error) {
        console.error(chalk.red(`Session ${state.slot} anti-link error:`), error);
    }
}

async function handleDeletedMessages(state, updates) {
    if (!state.settings.antidelete || !state.sock) return;

    for (const update of updates) {
        if (update.update?.message) continue;
        const key = update.key;
        const original = key?.id ? state.messageStore.get(key.id) : null;
        if (!original?.message || !key?.remoteJid) continue;

        try {
            const sender = key.participant || key.remoteJid;
            await state.sock.sendMessage(key.remoteJid, {
                text: `🛡️ *Anti-Delete*\n\nMessage deleted by @${sender.split("@")[0]}`,
                mentions: [sender]
            });
            await state.sock.relayMessage(key.remoteJid, original.message, {
                messageId: original.key?.id
            });
        } catch (error) {
            console.error(chalk.red(`Session ${state.slot} anti-delete error:`), error);
        }
    }
}

async function handleCalls(state, calls) {
    if (!state.settings.anticall || !state.sock) return;

    for (const call of calls) {
        if (call.status !== "offer") continue;
        try {
            await state.sock.rejectCall(call.id, call.from);
        } catch (error) {
            console.error(chalk.red(`Session ${state.slot} anti-call error:`), error);
        }
    }
}

// ============================================================
// START EXISTING SESSIONS
// ============================================================

async function loadExistingSessions() {
    ensureSessionDirRoot();

    for (const state of sessions.values()) {
        if (!hasCredentials(state.slot)) continue;
        try {
            console.log(chalk.gray(`Loading existing session ${state.slot}...`));
            await createSocket(state);
        } catch (error) {
            console.error(chalk.red(`Failed to load session ${state.slot}:`), error);
            setSessionStatus(state, { connection: "error" });
        }
    }
}

function ensureSessionDirRoot() {
    fs.mkdirSync(SESSION_ROOT, { recursive: true });
}

function showBanner() {
    try {
        console.log(chalk.cyan(figlet.textSync("NEXORA", { horizontalLayout: "default" })));
    } catch {
        console.log(chalk.cyan("=============================="));
        console.log(chalk.cyan("          NEXORA"));
        console.log(chalk.cyan("=============================="));
    }
    console.log(chalk.gray(`${BOT_NAME} • ${AUTHOR} • max ${MAX_SESSIONS} sessions`));
    console.log(chalk.gray(`Session storage: ${SESSION_ROOT}`));
}

// ============================================================
// SHUTDOWN
// ============================================================

let shuttingDown = false;

async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(chalk.yellow(`\n${signal} received. Shutting down Nexora...`));

    for (const state of sessions.values()) {
        state.stopping = true;
        if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
        if (state.sock) {
            try { state.sock.end(new Error("Process shutting down")); } catch {}
        }
    }

    setTimeout(() => process.exit(0), 1200);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("uncaughtException", error => console.error(chalk.red("❌ Uncaught exception:"), error));
process.on("unhandledRejection", reason => console.error(chalk.red("❌ Unhandled rejection:"), reason));

// ============================================================
// START
// ============================================================

(async () => {
    showBanner();
    await loadExistingSessions();
    console.log(chalk.green(`\n🚀 Nexora is ready. ${MAX_SESSIONS} session slots available.`));
})().catch(error => {
    console.error(chalk.red("Fatal startup error:"), error);
    process.exit(1);
});
