const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const readline = require("readline");
const chalk = require("chalk");
const figlet = require("figlet");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const express = require("express");

const { handleCommand } = require("./src/commands");

// Session dir
const SESSION_DIR = "./session";
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// ─── Status state (shown on the web status page) ───────────────────────────
const status = {
  connection: "starting", // starting | pairing | connecting | connected | disconnected
  pairingCode: null,
  qrCodeAvailable: false,
  botName: null,
  botId: null,
  browser: "Shadow Bot (Chrome)",
  lastUpdate: new Date().toISOString(),
};

function setStatus(patch) {
  Object.assign(status, patch, { lastUpdate: new Date().toISOString() });
}

// ─── Minimal HTTP server so Render's free web service stays alive ──────────
// Render's free tier requires binding to $PORT and responding to HTTP
// requests (used for the health check). This also gives you a page to see
// connection state, the pairing code, and the QR code without watching logs.
const app = express();
const PORT = process.env.PORT || 3000;

// Convert the Baileys QR payload string into a real scannable SVG QR code.
// Baileys' qr payload is comma-joined key data (ref, noise key, identity key,
// adv secret), NOT an ASCII-art matrix — it must be encoded with a QR library.
async function buildQrSvg(qrString) {
  return QRCode.toString(qrString, {
    type: "svg",
    width: 300,
    margin: 1,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

app.get("/", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Shadow Bot Status</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="5">
  <style>
    :root {
      --bg: #0b0b14;
      --card: #161624;
      --accent: #7c5cfc;
      --green: #2ecc71;
      --yellow: #f1c40f;
      --red: #e74c3c;
      --muted: #8a8aa0;
    }
    * { box-sizing: border-box; }
    body {
      background: var(--bg);
      color: #e8e8f0;
      font-family: 'Segoe UI', system-ui, monospace;
      margin: 0;
      padding: 2rem 1rem;
    }
    .container { max-width: 640px; margin: 0 auto; }
    .banner {
      text-align: center;
      margin-bottom: 1.5rem;
    }
    .banner h1 {
      font-size: 2.2rem;
      margin: 0 0 .25rem;
      background: linear-gradient(90deg, #7c5cfc, #00d2ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: 2px;
    }
    .banner p { margin: 0; color: var(--muted); font-size: .9rem; }
    .card {
      background: var(--card);
      border: 1px solid #262640;
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .card h2 { margin: 0 0 .75rem; font-size: 1.05rem; color: #c9c9e0; }
    .badge { display:inline-block; padding: 5px 12px; border-radius: 20px; font-weight:bold; font-size: .9rem; }
    .connected { background:#1f7a3f; }
    .connecting, .starting, .pairing { background:#a67c00; }
    .disconnected { background:#8a1f1f; }
    .auth-tabs { display: flex; gap: 8px; margin-bottom: 1rem; }
    .auth-tabs button {
      flex: 1;
      background: #23233a;
      color: #c9c9e0;
      border: 1px solid #32325a;
      border-radius: 8px;
      padding: 10px;
      font-size: .95rem;
      cursor: pointer;
      transition: all .15s;
    }
    .auth-tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .auth-tabs button:hover:not(.active) { border-color: var(--accent); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .code {
      font-size: 1.8rem;
      letter-spacing: 4px;
      background: #0f0f1a;
      border: 1px dashed #7c5cfc;
      color: #a8f0c0;
      padding: 14px 20px;
      border-radius: 10px;
      text-align: center;
      font-weight: bold;
    }
    .steps { color: #c9c9e0; line-height: 1.7; font-size: .95rem; margin: 0; }
    .steps b { color: #fff; }
    .qr-box {
      background: #ffffff;
      border-radius: 10px;
      padding: 14px;
      display: inline-block;
    }
    .hint { color: var(--muted); font-size: .85rem; margin-top: .75rem; }
    .muted { color: var(--muted); font-size: .85rem; }
    .divider { border-top: 1px dashed #32325a; margin: .75rem 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="banner">
      <h1>⚡ SHADOW BOT</h1>
      <p>WhatsApp Multi-Device Bot — Shadow Dev</p>
    </div>

    <div class="card">
      <h2>📡 Connection</h2>
      <span class="badge ${status.connection}">${status.connection}</span>
      <p class="hint">Browser: <b style="color:#fff">${status.browser}</b></p>
      ${status.connection === "connected" ? `<p class="hint">Linked as: <b style="color:#fff">${status.botName || "Unknown"}</b> (${status.botId || ""})</p>` : ""}
      <div style="margin-top: 10px; border-top: 1px solid #262640; padding-top: 10px;">
        <button onclick="if(confirm('This will clear the current session and restart the bot to get a fresh code. Continue?')) location.href='/reset'" 
                style="background:#e74c3c; color:#fff; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:0.8rem;">
          🔄 Reset Session & Get New Code
        </button>
      </div>
    </div>

    ${status.pairingCode || status.qrCodeAvailable || status.connection === "pairing" ? `
    <div class="card">
      <h2>🔗 Authenticate</h2>
      <div class="auth-tabs">
        <button class="${status.pairingCode ? "active" : ""}" onclick="showTab('pairing', this)">📱 Pairing Code</button>
        <button class="${!status.pairingCode ? "active" : ""}" onclick="showTab('qr', this)">📷 QR Code</button>
      </div>

      <div id="tab-pairing" class="tab-content ${status.pairingCode ? "active" : ""}">
        ${status.pairingCode ? `
          <p>Enter this code in WhatsApp → Linked Devices:</p>
          <div class="code">${status.pairingCode}</div>
          <p class="steps">
            <b>1.</b> Open WhatsApp on your phone<br>
            <b>2.</b> Tap the 3 dots (top right)<br>
            <b>3.</b> Tap <b>Linked Devices</b><br>
            <b>4.</b> Tap <b>Link a Device</b><br>
            <b>5.</b> Tap <b>"Link with phone number instead"</b><br>
            <b>6.</b> Enter <b>YOUR number</b> and then the code above
          </p>
          <p class="hint">⏱️ Code expires in 60 seconds — a fresh code appears on restart.</p>
        ` : `
          <p class="hint">A pairing code will appear here once requested.</p>
        `}
      </div>

      <div id="tab-qr" class="tab-content ${!status.pairingCode ? "active" : ""}">
        ${status.qrCodeAvailable ? `
          <p>Scan this QR with WhatsApp:</p>
          <div class="qr-box">${status.qrCodeSvg || ""}</div>
          <p class="steps">
            <b>1.</b> Open WhatsApp on your phone<br>
            <b>2.</b> Tap the 3 dots (top right)<br>
            <b>3.</b> Tap <b>Linked Devices</b> → <b>Link a Device</b><br>
            <b>4.</b> Scan the QR code above
          </p>
          <p class="hint">⏱️ QR expires in ~60 seconds — refresh the page to get a fresh one.</p>
        ` : `
          <p class="hint">Waiting for the QR code… it will appear here automatically (the page refreshes every 5s).</p>
        `}
      </div>
    </div>
    ` : ""}

    <p class="muted">Last update: ${status.lastUpdate}</p>
    <p class="muted">Page auto-refreshes every 5s.</p>
  </div>

  <script>
    function showTab(name, btn) {
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-tabs button').forEach(b => b.classList.remove('active'));
      document.getElementById('tab-' + name).classList.add('active');
      btn.classList.add('active');
    }
  </script>
</body>
</html>`);
});

// Simple JSON endpoint, handy for scripting/uptime pings
app.get("/status", (req, res) => res.json(status));

// Reset endpoint to clear session and get a new code (useful for "Couldn't link device" errors)
app.get("/reset", (req, res) => {
  console.log(chalk.red("Reset requested via web dashboard. Clearing session..."));
  try {
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }
    res.send("Session cleared. The bot is restarting now... Please wait 10 seconds and refresh the home page.");
    setTimeout(() => process.exit(0), 1000); // Exit so Render restarts the process
  } catch (err) {
    res.status(500).send("Error resetting session: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(chalk.cyan(`Status server listening on port ${PORT}`));
});

function printBanner() {
  console.clear();
  try {
    console.log(chalk.cyan(figlet.textSync("SHADOW BOT", { font: "ANSI Shadow", horizontalLayout: "full" })));
  } catch (e) {
    console.log(chalk.cyan("=== SHADOW BOT ==="));
  }
  console.log(chalk.magenta("═".repeat(60)));
  console.log(
    chalk.yellow("  WhatsApp Multi-Device Bot") +
      chalk.white("  •  ") +
      chalk.magenta.bold("by Shadow Dev")
  );
  console.log(
    chalk.white("  ") + chalk.dim("📱 Pairing code") + chalk.white("  •  ") + chalk.dim("📷 QR code") + chalk.white("  •  ") + chalk.dim("🌐 Web dashboard")
  );
  console.log(chalk.magenta("═".repeat(60)));
  console.log();
}

async function askPhoneNumber() {
  // On a host like Render there's no interactive terminal to type into, so
  // prefer OWNER_NUMBER from the environment. Falls back to the interactive
  // prompt for local/Termux use if OWNER_NUMBER isn't set and a TTY exists.
  const fromEnv = (process.env.OWNER_NUMBER || "").replace(/[^0-9]/g, "");
  if (fromEnv) {
    console.log(chalk.green("Using OWNER_NUMBER from environment: " + fromEnv));
    return fromEnv;
  }

  if (!process.stdin.isTTY) {
    console.error(chalk.red("No OWNER_NUMBER env var set and no interactive terminal available."));
    console.error(chalk.yellow("On Render: set OWNER_NUMBER in the service's Environment tab and redeploy."));
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      chalk.green("Enter your WhatsApp number with country code (e.g. 263716808196): "),
      (answer) => {
        rl.close();
        // Strip everything except digits, remove leading zeros
        const clean = answer.trim().replace(/[^0-9]/g, "");
        resolve(clean);
      }
    );
  });
}

// ── Pretty console box helpers ─────────────────────────────────────────────
function printBox(title, bodyLines) {
  // Each ANSI-escaped cell is 2 visible chars wide, so halve the lengths
  const visibleLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const cellLen = (s) => Math.ceil(visibleLen(s) / 2);
  const target = Math.max(cellLen(title), ...bodyLines.map(cellLen)) + 4;
  const border = chalk.bgGreen.black.bold("═".repeat(target));
  console.log(border);
  console.log(chalk.bgGreen.black.bold(("  " + title).padEnd(target)));
  bodyLines.forEach((line) => {
    console.log(chalk.bgGreen.black.bold(("  " + line).padEnd(target)));
  });
  console.log(border);
}

async function startBot(qrMode = false) {
  printBanner();

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    browser: ["Mac OS", "Chrome", "121.0.6167.85"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  // Pairing code flow (preferred) + QR code available side-by-side
  if (!sock.authState.creds.registered) {
    setStatus({ connection: "pairing" });

    // Register the QR listener ON EVERY startup so the web dashboard can
    // always render the QR code the server provides, regardless of which
    // auth method is used. It self-unregisters after the first QR event.
    const qrListener = async (update) => {
      const { qr } = update;
      if (!qr) return;
      const svg = await buildQrSvg(qr);
      setStatus({ qrCodeAvailable: true, qrCodeSvg: svg });
      // Also print it to the terminal (Render logs) when it appears
      console.log(chalk.white.bold("\n📷 QR CODE (scan with WhatsApp):"));
      qrcode.generate(qr, { small: true }, (code) => console.log(chalk.white(code)));
      console.log(chalk.dim("QR also available on the web dashboard."));
    };
    sock.ev.on("connection.update", qrListener, { unregister: true });

    console.log(chalk.white.bold("\n🔐 AUTHENTICATION REQUIRED\n"));
    console.log(chalk.cyan("Two ways to link your WhatsApp account:\n"));
    console.log(chalk.cyan("  📱 METHOD 1 (recommended): PAIRING CODE"));
    console.log(chalk.cyan("     A code will appear in this console + the web dashboard.\n"));
    console.log(chalk.cyan("  📷 METHOD 2:               QR CODE"));
    console.log(chalk.cyan("     A QR code appears on the web dashboard + in these logs.\n"));
    console.log(chalk.dim("   " + "─".repeat(56)));

    // QR mode skips the phone-number prompt entirely (QR listener already
    // registered above, so nothing extra needed)
    if (qrMode) {
      console.log(chalk.yellow("📷 QR CODE MODE\n"));
      console.log(chalk.cyan("Scan the QR code with WhatsApp to link this bot."));
      console.log(chalk.cyan("QR appears in these logs + on the web dashboard.\n"));
      console.log(chalk.dim("   " + "─".repeat(56)));
      return sock;
    }

    const phoneNumber = await askPhoneNumber();

    console.log(chalk.yellow("\nNumber to use: " + phoneNumber));
    console.log(chalk.yellow("Waiting 4 seconds for socket to stabilize...\n"));

    // Must wait for socket before requesting code
    await new Promise((r) => setTimeout(r, 4000));

    let pairingSucceeded = false;

    // ── Try pairing code first ──────────────────────────────────────────
    try {
      const code = await sock.requestPairingCode(phoneNumber);
      const formatted = code.match(/.{1,4}/g).join("-");
      // NOTE: qrCodeAvailable is intentionally left as-is — the global QR
      // listener above keeps the QR code live on the dashboard even when
      // the pairing code is shown, so the user can pick either method.
      setStatus({ connection: "pairing", pairingCode: formatted });

      console.log("");
      printBox("📱 YOUR PAIRING CODE: " + formatted, [
        "",
        "STEPS:",
        "1. Open WhatsApp on your phone",
        "2. Tap the 3 dots (top right)",
        "3. Tap Linked Devices",
        "4. Tap Link a Device",
        "5. Tap 'Link with phone number instead'",
        "6. Enter YOUR number: " + phoneNumber,
        "7. Enter code: " + formatted,
        "",
        "⏱️ You have 60 seconds! (or check the status page)",
      ]);
      console.log("");

      // Pairing code flow started successfully.
      // If the server later replies that pairing failed, the socket emits
      // a `qr` in the connection.update event and we show the QR fallback.
      pairingSucceeded = true;
    } catch (err) {
      console.error(chalk.red("⚠️  Pairing code request failed: " + err.message));
      console.log(chalk.yellow("   Falling back to QR code authentication...\n"));
      setStatus({ connection: "pairing", pairingCode: null });
    }

    // ── QR code fallback ────────────────────────────────────────────────
    if (!pairingSucceeded) {
      // Close this socket and restart in QR-only mode
      sock.ws.close();
      return startBot(true);
    }
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(chalk.red("\n❌ Disconnected. Code: " + statusCode));
      setStatus({ connection: "disconnected", pairingCode: null, qrCodeAvailable: false });

      if (statusCode === DisconnectReason.loggedOut) {
        console.log(chalk.red("Logged out! Clearing session..."));
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        process.exit(0);
      } else {
        console.log(chalk.yellow("Reconnecting in 5 seconds...\n"));
        setTimeout(startBot, 5000);
      }
    } else if (connection === "open") {
      console.log(chalk.green("\n✅ BOT CONNECTED TO WHATSAPP!"));
      console.log(chalk.cyan("Bot: " + (sock.user?.name || "Unknown") + " (" + sock.user?.id + ")"));
      console.log(chalk.yellow("Send .menu in any chat to get started!\n"));
      setStatus({
        connection: "connected",
        pairingCode: null,
        qrCodeAvailable: false,
        botName: sock.user?.name || "Unknown",
        botId: sock.user?.id || "",
      });
    } else if (connection === "connecting") {
      console.log(chalk.yellow("Connecting to WhatsApp..."));
      setStatus({ connection: "connecting" });
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      try {
        await handleCommand(sock, msg);
      } catch (err) {
        console.error(chalk.red("Command error: " + err.message));
      }
    }
  });

  return sock;
}

startBot().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
