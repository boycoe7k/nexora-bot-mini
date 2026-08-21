require('dotenv').config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidDecode,
  downloadContentFromMessage,
  proto,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const chalk = require("chalk");
const figlet = require("figlet");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const express = require("express");

const { handleCommand } = require("./src/commands");

const SESSION_DIR = "./session";
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// ─── Bot Branding ───
const BOT_NAME = "Nexora Bot Mini";
const AUTHOR = "Shadow Dev";
const startTime = Date.now();

// ─── Settings State (In-memory) ───
const settings = {
  autoreact: false,
  autostatus: true,
  antibadword: false,
  antilink: false,
  antidelete: false,
  anticall: false,
};

// ─── Message Store (for Anti-Delete) ───
const messageStore = {};

// ─── Status State ───
const status = {
  connection: "starting",
  pairingCode: null,
  qrCodeAvailable: false,
  qrCodeSvg: null,
  botName: null,
  botId: null,
  browser: "Safari (macOS)",
  lastUpdate: new Date().toISOString(),
};

let globalSock = null;

function setStatus(patch) {
  Object.assign(status, patch, { lastUpdate: new Date().toISOString() });
}

// ─── Web Dashboard ───
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

async function buildQrSvg(qrString) {
  return QRCode.toString(qrString, {
    type: "svg",
    width: 280,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

app.get("/", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${BOT_NAME} | Pair Code</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    body { background: #f8f9fa; color: #333; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .container { background: #fff; width: 90%; max-width: 400px; padding: 40px 20px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); text-align: center; }
    .bot-icon { background: #000; color: #fff; width: 80px; height: 80px; border-radius: 50%; display: flex; justify-content: center; align-items: center; font-size: 40px; margin: 0 auto 20px; }
    h1 { font-size: 24px; margin: 0 0 5px; font-weight: 700; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 25px; }
    . social-icons { display: flex; justify-content: center; gap: 15px; margin-bottom: 30px; }
    .social-icons a { width: 40px; height: 40px; border-radius: 50%; display: flex; justify-content: center; align-items: center; color: #fff; text-decoration: none; font-size: 18px; }
    .btn-yt { background: #ff0000; }
    .btn-tg { background: #0088cc; }
    .btn-wa { background: #25d366; }
    .btn-gh { background: #333; }
    .tabs { display: flex; background: #f1f3f5; border-radius: 10px; padding: 5px; margin-bottom: 25px; }
    .tab { flex: 1; padding: 10px; border-radius: 8px; cursor: pointer; border: none; font-weight: 600; font-size: 14px; background: transparent; color: #555; }
    .tab.active { background: #000; color: #fff; }
    .input-group { text-align: left; margin-bottom: 20px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 8px; color: #000; }
    input { width: 100%; padding: 12px 15px; border-radius: 10px; border: 1px solid #ddd; font-size: 15px; box-sizing: border-box; outline: none; }
    .btn-main { width: 100%; padding: 12px; border-radius: 10px; border: none; background: #000; color: #fff; font-weight: 600; cursor: pointer; margin-bottom: 15px; font-size: 15px; }
    .btn-main:disabled { background: #ccc; cursor: not-allowed; }
    .display-box { background: #f1f3f5; padding: 15px; border-radius: 10px; margin-bottom: 15px; font-weight: 600; font-size: 16px; color: #555; min-height: 20px; }
    .code-text { color: #000; letter-spacing: 2px; font-size: 18px; }
    .btn-copy { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid #ddd; background: #fff; color: #000; font-weight: 600; cursor: pointer; font-size: 15px; }
    .qr-container { display: none; margin-top: 10px; }
    .qr-container.active { display: block; }
    .qr-svg { margin: 0 auto; }
    footer { margin-top: 30px; font-size: 12px; color: #aaa; }
    .status-badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 10px; }
    .status-pairing { background: #fff3cd; color: #856404; }
    .status-connected { background: #d4edda; color: #155724; }
    .status-disconnected { background: #f8d7da; color: #721c24; }
  </style>
</head>
<body>
  <div class="container">
    <div class="bot-icon"><i class="fas fa-robot"></i></div>
    <div class="status-badge status-${status.connection}">${status.connection}</div>
    <h1>${BOT_NAME}</h1>
    <p class="subtitle">Link your WhatsApp device</p>
    <div class="social-icons">
      <a href="#" class="btn-yt"><i class="fab fa-youtube"></i></a>
      <a href="#" class="btn-tg"><i class="fab fa-telegram"></i></a>
      <a href="#" class="btn-wa"><i class="fab fa-whatsapp"></i></a>
      <a href="#" class="btn-gh"><i class="fab fa-github"></i></a>
    </div>
    <div class="tabs">
      <button class="tab active" id="tab-btn-pair" onclick="switchTab('pair')"><i class="fas fa-key"></i> Pair Code</button>
      <button class="tab" id="tab-btn-qr" onclick="switchTab('qr')"><i class="fas fa-qrcode"></i> QR Code</button>
    </div>
    <div id="pair-section">
      <div class="input-group">
        <label>Enter your WhatsApp number with country code</label>
        <input type="text" id="phone-input" placeholder="+263716808196">
      </div>
      <button class="btn-main" id="gen-btn" onclick="generatePairCode()"><i class="fas fa-key"></i> Generate Pair Code</button>
      <div class="display-box" id="code-box">Your pair code will appear here</div>
      <button class="btn-copy" onclick="copyCode()"><i class="fas fa-copy"></i> Copy Code</button>
    </div>
    <div id="qr-section" class="qr-container">
      <div class="qr-svg" id="qr-box"><p style="padding: 20px; color: #888;">Waiting for QR code...</p></div>
      <p class="subtitle" style="margin-top: 15px;">Scan this QR with WhatsApp Linked Devices</p>
    </div>
    <footer>&copy; 2026 ${AUTHOR} | ${BOT_NAME}</footer>
  </div>
  <script>
    function switchTab(type) {
      const pairSec = document.getElementById('pair-section');
      const qrSec = document.getElementById('qr-section');
      const pairBtn = document.getElementById('tab-btn-pair');
      const qrBtn = document.getElementById('tab-btn-qr');
      if (type === 'pair') {
        pairSec.style.display = 'block';
        qrSec.classList.remove('active');
        pairBtn.classList.add('active');
        qrBtn.classList.remove('active');
      } else {
        pairSec.style.display = 'none';
        qrSec.classList.add('active');
        pairBtn.classList.remove('active');
        qrBtn.classList.add('active');
        fetchStatus();
      }
    }
    async function generatePairCode() {
      const phone = document.getElementById('phone-input').value.replace(/[^0-9]/g, '');
      if (!phone) return alert('Please enter a valid number!');
      const btn = document.getElementById('gen-btn');
      const box = document.getElementById('code-box');
      btn.disabled = true;
      box.innerText = 'Generating...';
      try {
        const res = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
        const data = await res.json();
        if (data.code) { box.innerHTML = '<span class="code-text">' + data.code + '</span>'; } else { box.innerText = 'Error: ' + (data.error || 'Failed to generate'); btn.disabled = false; }
      } catch (e) { box.innerText = 'Error connecting to server'; btn.disabled = false; }
    }
    function copyCode() {
      const box = document.getElementById('code-box');
      const code = box.innerText.trim();
      if (code.includes('appear') || code.includes('Generating')) return;
      navigator.clipboard.writeText(code).then(() => alert('Code copied!'));
    }
    async function fetchStatus() {
      const res = await fetch('/status');
      const data = await res.json();
      if (data.qrCodeSvg) { document.getElementById('qr-box').innerHTML = data.qrCodeSvg; }
    }
    setInterval(async () => {
      const res = await fetch('/status');
      const data = await res.json();
      if (data.connection === 'connected') location.reload();
      if (document.getElementById('qr-section').classList.contains('active') && data.qrCodeSvg) { document.getElementById('qr-box').innerHTML = data.qrCodeSvg; }
    }, 5000);
  </script>
</body>
</html>`);
});

app.get("/status", (req, res) => res.json(status));

app.post("/api/pair", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone number required" });
  if (!globalSock) return res.status(500).json({ error: "Bot not initialized" });
  try {
    await new Promise((r) => setTimeout(r, 2000));
    const code = await globalSock.requestPairingCode(phone);
    const fmt = code.match(/.{1,4}/g).join("-");
    setStatus({ pairingCode: fmt });
    res.json({ code: fmt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/reset", (req, res) => {
  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
  res.send("Resetting... please wait.");
  setTimeout(() => process.exit(0), 1000);
});

app.listen(PORT, () => console.log(chalk.cyan(`Dashboard: http://localhost:${PORT}`)));

// ─── Bot Logic ───
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    browser: ["Mac OS", "Safari", "17.0"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  globalSock = sock;

  if (!sock.authState.creds.registered) {
    setStatus({ connection: "pairing" });
    const qrListener = async (update) => {
      const { qr } = update;
      if (!qr) return;
      const svg = await buildQrSvg(qr);
      setStatus({ qrCodeAvailable: true, qrCodeSvg: svg });
      qrcodeTerminal.generate(qr, { small: true });
    };
    sock.ev.on("connection.update", qrListener, { unregister: true });
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      setStatus({ connection: "disconnected", pairingCode: null, qrCodeAvailable: false });
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        process.exit(0);
      } else { setTimeout(startBot, 5000); }
    } else if (connection === "open") {
      console.log(chalk.green(`\n✅ ${BOT_NAME} CONNECTED!`));
      setStatus({ connection: "connected", botName: sock.user?.name, botId: sock.user?.id });
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message) continue;
      
      const jid = msg.key.remoteJid;
      const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();

      // ── Anti-Delete Store ──
      if (settings.antidelete && !msg.key.fromMe) {
        messageStore[msg.key.id] = msg;
      }

      // ── Auto-Status ──
      if (settings.autostatus && jid === "status@broadcast") {
        await sock.readMessages([msg.key]);
      }

      // ── Anti-Link ──
      if (settings.antilink && isGroup(jid) && text.includes("chat.whatsapp.com")) {
        const groupMeta = await sock.groupMetadata(jid);
        const isAdmin = groupMeta.participants.find(p => p.id === msg.key.participant)?.admin;
        if (!isAdmin && !msg.key.fromMe) {
          await sock.sendMessage(jid, { delete: msg.key });
          await sock.groupParticipantsUpdate(jid, [msg.key.participant], "remove");
          await sock.sendMessage(jid, { text: `⚠️ *Anti-Link Active:* @${msg.key.participant.split("@")[0]} was removed for sharing a group link.`, mentions: [msg.key.participant] });
        }
      }

      await handleCommand(sock, msg, { startTime, settings });
    }
  });

  // ── Anti-Delete Logic ──
  sock.ev.on("messages.update", async (updates) => {
    if (!settings.antidelete) return;
    for (const update of updates) {
      if (update.update.protocolMessage?.type === 0) { // Message deleted
        const deletedId = update.update.protocolMessage.key.id;
        const oldMsg = messageStore[deletedId];
        if (oldMsg) {
          const jid = oldMsg.key.remoteJid;
          const sender = oldMsg.key.participant || jid;
          await sock.sendMessage(jid, { text: `🛡️ *Anti-Delete Active*\n\n👤 *Sender:* @${sender.split("@")[0]}\n🕒 *Time:* ${new Date().toLocaleTimeString()}\n\n*Message:*`, mentions: [sender] });
          await sock.copyNForward(jid, oldMsg, false);
        }
      }
    }
  });

  // ── Anti-Call ──
  sock.ev.on("call", async (calls) => {
    if (!settings.anticall) return;
    for (const call of calls) {
      if (call.status === "offer") {
        await sock.rejectCall(call.id, call.from);
        await sock.sendMessage(call.from, { text: `⚠️ *Anti-Call Active:* Calls are not allowed.` });
      }
    }
  });

  return sock;
}

function isGroup(jid) { return jid.endsWith("@g.us"); }

startBot().catch(err => console.error("FATAL:", err));
