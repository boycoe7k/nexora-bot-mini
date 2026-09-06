require("dotenv").config();

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestWaWebVersion,
    jidDecode,
    downloadContentFromMessage,
    proto
} = require("@whiskeysockets/baileys");

const P = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const figlet = require("figlet");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const express = require("express");

const { handleCommand } = require("./src/commands");

// ============================================================
// CONFIG
// ============================================================

const BOT_NAME = process.env.BOT_NAME || "Nexora Bot Mini";
const AUTHOR = process.env.AUTHOR || "Boycoe-dev";

const PORT = Number(process.env.PORT) || 3000;

const SESSION_DIR = path.resolve(
    process.env.SESSION_DIR || "./session"
);

// IMPORTANT:
// No hardcoded owner number anymore.
// Set OWNER_NUMBER in your .env file.
const OWNER_NUMBER = String(process.env.OWNER_NUMBER || "")
    .replace(/\D/g, "");

if (!OWNER_NUMBER) {
    console.warn(
        chalk.yellow(
            "⚠️ OWNER_NUMBER is not configured. Owner-only features will be unavailable."
        )
    );
}

// Dashboard authentication token.
// REQUIRED for destructive/admin dashboard operations.
const DASHBOARD_TOKEN = String(
    process.env.DASHBOARD_TOKEN || ""
).trim();

if (!DASHBOARD_TOKEN) {
    console.warn(
        chalk.yellow(
            "⚠️ DASHBOARD_TOKEN is not configured. /reset will remain disabled."
        )
    );
}

// External menu image.
const MENU_IMAGE =
    process.env.MENU_IMAGE ||
    "https://i.ibb.co/your-menu-image";

// ============================================================
// WHATSAPP CHANNELS
// ============================================================

const AUTO_FOLLOW_CHANNELS = [
    "https://whatsapp.com/channel/0029VaYOURCHANNEL1",
    "https://whatsapp.com/channel/0029VaYOURCHANNEL2",
    "https://whatsapp.com/channel/0029VaYOURCHANNEL3",
    "https://whatsapp.com/channel/0029VaYOURCHANNEL4",
    "https://whatsapp.com/channel/0029VaYOURCHANNEL5"
];

// ============================================================
// SETTINGS
// ============================================================

const settings = {
    autoreact: false,
    autostatus: true,
    antibadword: false,
    antilink: false,
    antidelete: false,
    anticall: false,
    welcome: false,
    goodbye: false
};

// ============================================================
// RUNTIME STORAGE
// ============================================================

const messageStore = new Map();
const linkWarnings = new Map();

const MAX_LINK_WARNINGS = 3;

// WhatsApp URL detection.
const LINK_REGEX =
    /(https?:\/\/[^\s]+|www\.[^\s]+|chat\.whatsapp\.com\/[^\s]+)/i;

// Keep memory from growing forever.
const MAX_STORED_MESSAGES = 1000;

// ============================================================
// STATUS
// ============================================================

const status = {
    connection: "starting",
    pairingCode: null,
    qrCodeSvg: null,
    botName: BOT_NAME,
    botId: null,
    browser: null,
    lastUpdate: null
};

let globalSock = null;
let onboardingSent = false;
let restarting = false;

// ============================================================
// HELPERS
// ============================================================

function setStatus(updates = {}) {
    Object.assign(status, updates, {
        lastUpdate: new Date().toISOString()
    });
}

function jidFromNumber(number) {
    const clean = String(number || "").replace(/\D/g, "");

    if (!clean) return null;

    return `${clean}@s.whatsapp.net`;
}

function normalizePhone(number) {
    return String(number || "").replace(/\D/g, "");
}

function channelInviteCode(url) {
    try {
        const match = String(url || "").match(
            /whatsapp\.com\/channel\/([^/?]+)/i
        );

        return match ? match[1] : null;
    } catch {
        return null;
    }
}

// ============================================================
// DASHBOARD AUTH
// ============================================================

function getDashboardToken(req) {
    const authorization = req.get("authorization");

    if (authorization) {
        const match = authorization.match(
            /^Bearer\s+(.+)$/i
        );

        if (match) {
            return match[1].trim();
        }
    }

    const headerToken = req.get("x-dashboard-token");

    if (headerToken) {
        return headerToken.trim();
    }

    return null;
}

function requireDashboardToken(req, res, next) {
    if (!DASHBOARD_TOKEN) {
        return res.status(503).json({
            success: false,
            error: "Dashboard authentication is not configured."
        });
    }

    const provided = getDashboardToken(req);

    if (!provided || provided !== DASHBOARD_TOKEN) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized."
        });
    }

    next();
}

// ============================================================
// RATE LIMITING
// ============================================================

const pairAttempts = new Map();

const PAIR_WINDOW_MS = 60 * 1000;
const MAX_PAIR_ATTEMPTS = 5;

function checkPairRateLimit(ip) {
    const now = Date.now();

    const current = pairAttempts.get(ip);

    if (!current || now - current.startedAt > PAIR_WINDOW_MS) {
        pairAttempts.set(ip, {
            startedAt: now,
            count: 1
        });

        return true;
    }

    if (current.count >= MAX_PAIR_ATTEMPTS) {
        return false;
    }

    current.count++;

    return true;
}

// Periodically remove old rate-limit entries.
setInterval(() => {
    const now = Date.now();

    for (const [ip, data] of pairAttempts.entries()) {
        if (now - data.startedAt > PAIR_WINDOW_MS) {
            pairAttempts.delete(ip);
        }
    }
}, PAIR_WINDOW_MS).unref();

// ============================================================
// MESSAGE STORE
// ============================================================

function storeMessage(message) {
    if (!message?.key?.id) return;

    const id = message.key.id;

    messageStore.set(id, message);

    while (messageStore.size > MAX_STORED_MESSAGES) {
        const oldestKey = messageStore.keys().next().value;

        if (oldestKey) {
            messageStore.delete(oldestKey);
        } else {
            break;
        }
    }
}

// ============================================================
// EXPRESS DASHBOARD
// ============================================================

const app = express();

app.disable("x-powered-by");

app.use(express.json({
    limit: "1mb"
}));

// ------------------------------------------------------------
// Basic health endpoint
// ------------------------------------------------------------

app.get("/", (req, res) => {
    res.json({
        success: true,
        name: BOT_NAME,
        status: status.connection,
        uptime: process.uptime()
    });
});

// ------------------------------------------------------------
// Public sanitized status
// ------------------------------------------------------------

app.get("/status", (req, res) => {
    res.json({
        success: true,
        botName: status.botName,
        botId: status.botId,
        connection: status.connection,
        browser: status.browser,
        lastUpdate: status.lastUpdate,
        uptime: process.uptime()
    });
});

// ------------------------------------------------------------
// Authenticated dashboard status
// ------------------------------------------------------------

app.get(
    "/api/status",
    requireDashboardToken,
    (req, res) => {
        res.json({
            success: true,
            ...status,
            settings,
            uptime: process.uptime()
        });
    }
);

// ------------------------------------------------------------
// Pairing
// ------------------------------------------------------------

app.post("/api/pair", async (req, res) => {
    try {
        const ip =
            req.ip ||
            req.socket?.remoteAddress ||
            "unknown";

        if (!checkPairRateLimit(ip)) {
            return res.status(429).json({
                success: false,
                error:
                    "Too many pairing attempts. Please wait one minute."
            });
        }

        if (!globalSock) {
            return res.status(503).json({
                success: false,
                error: "WhatsApp socket is not ready."
            });
        }

        if (!globalSock.requestPairingCode) {
            return res.status(503).json({
                success: false,
                error:
                    "Pairing codes are not available right now."
            });
        }

        let phone = normalizePhone(
            req.body?.phone
        );

        // Prevent obviously invalid input.
        if (!phone || phone.length < 8 || phone.length > 15) {
            return res.status(400).json({
                success: false,
                error:
                    "Enter a valid phone number with country code."
            });
        }

        // Avoid trying to pair when already connected.
        if (status.connection === "open") {
            return res.status(409).json({
                success: false,
                error: "Bot is already connected."
            });
        }

        // Small delay gives Baileys time to initialize.
        await new Promise(resolve =>
            setTimeout(resolve, 2000)
        );

        const code =
            await globalSock.requestPairingCode(phone);

        status.pairingCode = code;

        setStatus({
            pairingCode: code
        });

        return res.json({
            success: true,
            code
        });

    } catch (error) {
        console.error(
            chalk.red("Pairing error:"),
            error
        );

        return res.status(500).json({
            success: false,
            error:
                error?.message ||
                "Failed to generate pairing code."
        });
    }
});

// ------------------------------------------------------------
// SECURE RESET
// ------------------------------------------------------------
//
// IMPORTANT:
// This endpoint used to be publicly accessible.
// It now:
//   - requires DASHBOARD_TOKEN
//   - requires POST
//   - deletes the session only after authentication
// ------------------------------------------------------------

app.post(
    "/reset",
    requireDashboardToken,
    async (req, res) => {
        try {
            if (restarting) {
                return res.status(409).json({
                    success: false,
                    error: "Reset already in progress."
                });
            }

            restarting = true;

            res.json({
                success: true,
                message:
                    "Reset authorized. Restarting Nexora..."
            });

            setTimeout(() => {
                try {
                    if (fs.existsSync(SESSION_DIR)) {
                        fs.rmSync(SESSION_DIR, {
                            recursive: true,
                            force: true
                        });
                    }

                    console.log(
                        chalk.yellow(
                            "🧹 WhatsApp session removed."
                        )
                    );

                    process.exit(0);
                } catch (error) {
                    console.error(
                        chalk.red(
                            "Failed to remove session:"
                        ),
                        error
                    );

                    process.exit(1);
                }
            }, 1000);

        } catch (error) {
            restarting = false;

            console.error(
                chalk.red("Reset error:"),
                error
            );

            if (!res.headersSent) {
                return res.status(500).json({
                    success: false,
                    error: "Reset failed."
                });
            }
        }
    }
);

// ------------------------------------------------------------
// Start dashboard
// ------------------------------------------------------------

app.listen(PORT, () => {
    console.log(
        chalk.green(
            `🌐 Nexora dashboard running on port ${PORT}`
        )
    );
});

// ============================================================
// CHANNEL FOLLOWING
// ============================================================

async function followConfiguredChannels(sock) {
    if (!Array.isArray(AUTO_FOLLOW_CHANNELS)) {
        return;
    }

    for (const channel of AUTO_FOLLOW_CHANNELS) {
        try {
            const code = channelInviteCode(channel);

            if (!code) continue;

            // Baileys may not expose channel following
            // depending on version. Keep this optional.
            if (
                typeof sock.newsletterFollow ===
                "function"
            ) {
                await sock.newsletterFollow(code);

                console.log(
                    chalk.green(
                        `✓ Followed channel: ${code}`
                    )
                );
            }
        } catch (error) {
            console.log(
                chalk.gray(
                    `Could not follow channel: ${channel}`
                )
            );
        }
    }
}

// ============================================================
// CONNECTION ONBOARDING
// ============================================================

async function sendConnectionOnboarding(sock) {
    if (onboardingSent) return;

    onboardingSent = true;

    try {
        const ownerText = OWNER_NUMBER
            ? `Owner: +${OWNER_NUMBER}`
            : "Owner: Not configured";

        const caption = `
╭━━━〔 ${BOT_NAME} 〕━━━╮
┃
┃  🤖 WhatsApp Multi-Device Bot
┃
┃  ${ownerText}
┃  Developed by ${AUTHOR}
┃
┃  🌐 nexora.zone.id
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯
`;

        const target =
            sock.user?.id ||
            jidFromNumber(OWNER_NUMBER);

        if (!target) {
            console.log(
                chalk.yellow(
                    "⚠️ No onboarding target available."
                )
            );

            return;
        }

        await sock.sendMessage(target, {
            text: caption
        });

    } catch (error) {
        onboardingSent = false;

        console.error(
            chalk.red(
                "Onboarding message failed:"
            ),
            error
        );
    }
}

// ============================================================
// DISPLAY BANNER
// ============================================================

function showBanner() {
    console.clear();

    try {
        console.log(
            chalk.cyan(
                figlet.textSync("NEXORA", {
                    horizontalLayout: "default"
                })
            )
        );
    } catch {
        console.log(
            chalk.cyan(
                "=============================="
            )
        );

        console.log(
            chalk.cyan("        NEXORA BOT")
        );

        console.log(
            chalk.cyan(
                "=============================="
            )
        );
    }

    console.log(
        chalk.gray(
            `${BOT_NAME} • ${AUTHOR}`
        )
    );

    console.log();
}

// ============================================================
// START BOT
// ============================================================

async function startBot() {
    try {
        showBanner();

        if (!fs.existsSync(SESSION_DIR)) {
            fs.mkdirSync(SESSION_DIR, {
                recursive: true
            });
        }

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(
            SESSION_DIR
        );

        let version;

        try {
            const latest =
                await fetchLatestWaWebVersion();

            version = latest?.version;

            if (version) {
                console.log(
                    chalk.gray(
                        `WhatsApp Web version: ${version.join(".")}`
                    )
                );
            }
        } catch (error) {
            console.log(
                chalk.yellow(
                    "⚠️ Could not fetch latest WhatsApp Web version."
                )
            );
        }

        const sock = makeWASocket({
            auth: state,

            logger: P({
                level:
                    process.env.LOG_LEVEL ||
                    "silent"
            }),

            printQRInTerminal: false,

            browser: [
                "Nexora",
                "Chrome",
                "1.0.0"
            ],

            ...(version
                ? { version }
                : {}),

            generateHighQualityLinkPreview:
                true,

            syncFullHistory: false,

            markOnlineOnConnect: false
        });

        globalSock = sock;

        setStatus({
            connection: "connecting",
            pairingCode: null,
            qrCodeSvg: null,
            botId: null
        });

        // ----------------------------------------------------
        // Save credentials
        // ----------------------------------------------------

        sock.ev.on(
            "creds.update",
            saveCreds
        );

        // ----------------------------------------------------
        // Connection updates
        // ----------------------------------------------------

        sock.ev.on(
            "connection.update",
            async (update) => {
                const {
                    connection,
                    lastDisconnect,
                    qr
                } = update;

                if (connection) {
                    setStatus({
                        connection
                    });
                }

                // --------------------------------------------
                // QR
                // --------------------------------------------

                if (qr) {
                    try {
                        qrcode.generate(
                            qr,
                            {
                                small: true
                            }
                        );

                        status.qrCodeSvg =
                            await QRCode.toString(
                                qr,
                                {
                                    type: "svg"
                                }
                            );

                        setStatus({
                            qrCodeSvg:
                                status.qrCodeSvg
                        });

                    } catch (error) {
                        console.error(
                            chalk.red(
                                "QR generation failed:"
                            ),
                            error
                        );
                    }
                }

                // --------------------------------------------
                // OPEN
                // --------------------------------------------

                if (connection === "open") {
                    const botId =
                        sock.user?.id ||
                        null;

                    setStatus({
                        connection: "open",
                        botId,
                        pairingCode: null,
                        qrCodeSvg: null,
                        browser:
                            sock.user?.name ||
                            null
                    });

                    console.log(
                        chalk.green(
                            "\n✅ Nexora connected successfully!"
                        )
                    );

                    onboardingSent = false;

                    await followConfiguredChannels(
                        sock
                    );

                    await sendConnectionOnboarding(
                        sock
                    );
                }

                // --------------------------------------------
                // CLOSE
                // --------------------------------------------

                if (connection === "close") {
                    const statusCode =
                        new Boom(
                            lastDisconnect?.error
                        )?.output?.statusCode;

                    console.log(
                        chalk.red(
                            `❌ WhatsApp connection closed. Code: ${statusCode}`
                        )
                    );

                    setStatus({
                        connection: "closed"
                    });

                    globalSock = null;

                    // Logged out permanently.
                    if (
                        statusCode ===
                        DisconnectReason.loggedOut
                    ) {
                        console.log(
                            chalk.red(
                                "🚪 WhatsApp session logged out."
                            )
                        );

                        setStatus({
                            connection:
                                "logged_out"
                        });

                        return;
                    }

                    // Bad session.
                    if (
                        statusCode ===
                        DisconnectReason.badSession
                    ) {
                        console.log(
                            chalk.red(
                                "⚠️ Bad session detected."
                            )
                        );

                        return;
                    }

                    // Other disconnects should reconnect.
                    if (!restarting) {
                        console.log(
                            chalk.yellow(
                                "🔄 Reconnecting in 5 seconds..."
                            )
                        );

                        setTimeout(() => {
                            if (!restarting) {
                                startBot().catch(
                                    error => {
                                        console.error(
                                            chalk.red(
                                                "Restart failed:"
                                            ),
                                            error
                                        );
                                    }
                                );
                            }
                        }, 5000);
                    }
                }
            }
        );

        // ----------------------------------------------------
        // Group participant events
        // ----------------------------------------------------

        sock.ev.on(
            "group-participants.update",
            async update => {
                try {
                    const {
                        id,
                        participants,
                        action
                    } = update;

                    if (!settings.welcome &&
                        !settings.goodbye) {
                        return;
                    }

                    const metadata =
                        await sock.groupMetadata(
                            id
                        );

                    for (const participant of participants) {
                        const number =
                            participant.split(
                                "@"
                            )[0];

                        if (action === "add" &&
                            settings.welcome) {
                            await sock.sendMessage(
                                id,
                                {
                                    text:
                                        `👋 Welcome @${number} to *${metadata.subject}*!`,
                                    mentions: [
                                        participant
                                    ]
                                }
                            );
                        }

                        if (
                            action === "remove" &&
                            settings.goodbye
                        ) {
                            await sock.sendMessage(
                                id,
                                {
                                    text:
                                        `👋 Goodbye @${number}!`,
                                    mentions: [
                                        participant
                                    ]
                                }
                            );
                        }
                    }

                } catch (error) {
                    console.error(
                        chalk.red(
                            "Group participant handler error:"
                        ),
                        error
                    );
                }
            }
        );

        // ----------------------------------------------------
        // Incoming messages
        // ----------------------------------------------------

        sock.ev.on(
            "messages.upsert",
            async ({ messages }) => {
                try {
                    for (const msg of messages) {
                        if (!msg?.message) {
                            continue;
                        }

                        // ------------------------------------
                        // Store messages for anti-delete
                        // ------------------------------------

                        if (
                            settings.antidelete &&
                            msg.key?.id
                        ) {
                            storeMessage(msg);
                        }

                        // ------------------------------------
                        // Auto view WhatsApp status
                        // ------------------------------------

                        if (
                            settings.autostatus &&
                            msg.key?.remoteJid ===
                            "status@broadcast"
                        ) {
                            try {
                                await sock.readMessages([
                                    msg.key
                                ]);
                            } catch {}
                        }

                        // ------------------------------------
                        // Anti-link
                        // ------------------------------------

                        if (
                            settings.antilink &&
                            msg.key?.remoteJid?.endsWith(
                                "@g.us"
                            )
                        ) {
                            try {
                                const text =
                                    msg.message
                                        ?.conversation ||
                                    msg.message
                                        ?.extendedTextMessage
                                        ?.text ||
                                    "";

                                if (
                                    LINK_REGEX.test(
                                        text
                                    )
                                ) {
                                    const groupJid =
                                        msg.key.remoteJid;

                                    const sender =
                                        msg.key.participant;

                                    const metadata =
                                        await sock.groupMetadata(
                                            groupJid
                                        );

                                    const senderParticipant =
                                        metadata.participants.find(
                                            p =>
                                                p.id ===
                                                sender
                                        );

                                    const senderNumber =
                                        sender
                                            ?.split(
                                                "@"
                                            )[0];

                                    const botJid =
                                        sock.user?.id;

                                    const botNumber =
                                        botJid
                                            ?.split(
                                                ":"
                                            )[0]
                                            ?.split(
                                                "@"
                                            )[0];

                                    const isSenderAdmin =
                                        senderParticipant
                                            ?.admin;

                                    const isBotAdmin =
                                        metadata.participants.some(
                                            p =>
                                                p.id ===
                                                    botJid ||
                                                p.id?.startsWith(
                                                    `${botNumber}@`
                                                )
                                        );

                                    // Don't punish admins.
                                    if (
                                        isSenderAdmin ||
                                        senderNumber ===
                                            OWNER_NUMBER
                                    ) {
                                        continue;
                                    }

                                    // Need bot admin to delete.
                                    if (
                                        !isBotAdmin
                                    ) {
                                        continue;
                                    }

                                    try {
                                        await sock.sendMessage(
                                            groupJid,
                                            {
                                                delete:
                                                    msg.key
                                            }
                                        );
                                    } catch {}

                                    const current =
                                        (linkWarnings.get(
                                            sender
                                        ) || 0) + 1;

                                    linkWarnings.set(
                                        sender,
                                        current
                                    );

                                    if (
                                        current >=
                                        MAX_LINK_WARNINGS
                                    ) {
                                        try {
                                            await sock.groupParticipantsUpdate(
                                                groupJid,
                                                [
                                                    sender
                                                ],
                                                "remove"
                                            );

                                            linkWarnings.delete(
                                                sender
                                            );
                                        } catch (
                                            removeError
                                        ) {
                                            console.error(
                                                chalk.red(
                                                    "Failed to remove link sender:"
                                                ),
                                                removeError
                                            );
                                        }
                                    } else {
                                        await sock.sendMessage(
                                            groupJid,
                                            {
                                                text:
                                                    `⚠️ @${senderNumber} links are not allowed here.\n\nWarning ${current}/${MAX_LINK_WARNINGS}`,
                                                mentions: [
                                                    sender
                                                ]
                                            }
                                        );
                                    }
                                }

                            } catch (
                                antiLinkError
                            ) {
                                console.error(
                                    chalk.red(
                                        "Anti-link error:"
                                    ),
                                    antiLinkError
                                );
                            }
                        }

                        // ------------------------------------
                        // Command handler
                        // ------------------------------------

                        try {
                            await handleCommand(
                                sock,
                                msg,
                                {
                                    startTime:
                                        process.uptime(),
                                    settings
                                }
                            );
                        } catch (commandError) {
                            console.error(
                                chalk.red(
                                    "Command handler error:"
                                ),
                                commandError
                            );
                        }
                    }

                } catch (error) {
                    console.error(
                        chalk.red(
                            "Message handler error:"
                        ),
                        error
                    );
                }
            }
        );

        // ----------------------------------------------------
        // Deleted messages / anti-delete
        // ----------------------------------------------------

        sock.ev.on(
            "messages.update",
            async updates => {
                if (!settings.antidelete) {
                    return;
                }

                try {
                    for (const update of updates) {
                        const message =
                            update.update?.message;

                        if (message) {
                            continue;
                        }

                        const key =
                            update.key;

                        if (!key?.id) {
                            continue;
                        }

                        const original =
                            messageStore.get(
                                key.id
                            );

                        if (!original?.message) {
                            continue;
                        }

                        const jid =
                            key.remoteJid;

                        if (!jid) {
                            continue;
                        }

                        const sender =
                            key.participant ||
                            jid;

                        try {
                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        `🛡️ *Anti-Delete*\n\nMessage deleted by @${sender.split("@")[0]}`,
                                    mentions: [
                                        sender
                                    ]
                                }
                            );

                            await sock.relayMessage(
                                jid,
                                original.message,
                                {
                                    messageId:
                                        original.key
                                            ?.id
                                }
                            );

                        } catch (
                            restoreError
                        ) {
                            console.error(
                                chalk.red(
                                    "Anti-delete restore error:"
                                ),
                                restoreError
                            );
                        }
                    }
                } catch (error) {
                    console.error(
                        chalk.red(
                            "Anti-delete handler error:"
                        ),
                        error
                    );
                }
            }
        );

        // ----------------------------------------------------
        // Anti-call
        // ----------------------------------------------------

        sock.ev.on(
            "call",
            async calls => {
                if (!settings.anticall) {
                    return;
                }

                for (const call of calls) {
                    try {
                        if (
                            call.status ===
                            "offer"
                        ) {
                            await sock.rejectCall(
                                call.id,
                                call.from
                            );

                            console.log(
                                chalk.yellow(
                                    `📵 Rejected call from ${call.from}`
                                )
                            );
                        }
                    } catch (error) {
                        console.error(
                            chalk.red(
                                "Anti-call error:"
                            ),
                            error
                        );
                    }
                }
            }
        );

        return sock;

    } catch (error) {
        globalSock = null;

        setStatus({
            connection: "error"
        });

        console.error(
            chalk.red(
                "❌ Failed to start Nexora:"
            ),
            error
        );

        if (!restarting) {
            setTimeout(() => {
                startBot().catch(
                    restartError => {
                        console.error(
                            chalk.red(
                                "Bot restart failed:"
                            ),
                            restartError
                        );
                    }
                );
            }, 5000);
        }
    }
}

// ============================================================
// PROCESS SHUTDOWN
// ============================================================

async function gracefulShutdown(signal) {
    if (restarting) return;

    restarting = true;

    console.log(
        chalk.yellow(
            `\n${signal} received. Shutting down Nexora...`
        )
    );

    try {
        if (globalSock) {
            try {
                globalSock.end(
                    new Error(
                        "Process shutting down"
                    )
                );
            } catch {}
        }
    } catch {}

    setTimeout(() => {
        process.exit(0);
    }, 1000);
}

process.on(
    "SIGINT",
    () => gracefulShutdown("SIGINT")
);

process.on(
    "SIGTERM",
    () => gracefulShutdown("SIGTERM")
);

// Prevent unexpected errors from silently killing
// the process without logging.
process.on(
    "uncaughtException",
    error => {
        console.error(
            chalk.red(
                "❌ Uncaught exception:"
            ),
            error
        );
    }
);

process.on(
    "unhandledRejection",
    reason => {
        console.error(
            chalk.red(
                "❌ Unhandled promise rejection:"
            ),
            reason
        );
    }
);

// ============================================================
// START
// ============================================================

startBot().catch(error => {
    console.error(
        chalk.red(
            "Fatal startup error:"
        ),
        error
    );
});
