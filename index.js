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
const express = require("express");

const { handleCommand } = require("./src/commands");

// Session dir
const SESSION_DIR = "./session";
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// ─── Status state (shown on the web status page) ───────────────────────────
const status = {
  connection: "starting", // starting | pairing | connecting | connected | disconnected
  pairingCode: null,
  botName: null,
  botId: null,
  lastUpdate: new Date().toISOString(),
};

function setStatus(patch) {
  Object.assign(status, patch, { lastUpdate: new Date().toISOString() });
}

// ─── Minimal HTTP server so Render's free web service stays alive ──────────
// Render's free tier requires binding to $PORT and responding to HTTP
// requests (used for the health check). This also gives you a page to see
// connection state and the pairing code without watching logs.
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Shadow Bot Status</title>
  <meta http-equiv="refresh" content="5">
  <style>
    body { background:#0b0b0f; color:#e6e6e6; font-family: monospace; padding: 2rem; }
    .badge { display:inline-block; padding: 4px 10px; border-radius: 6px; font-weight:bold; }
    .connected { background:#1f7a3f; }
    .connecting, .starting, .pairing { background:#a67c00; }
    .disconnected { background:#8a1f1f; }
    .code { font-size: 1.6rem; letter-spacing: 3px; background:#1a1a22; padding: 12px 20px; border-radius: 8px; display:inline-block; margin-top: 1rem; }
    .muted { color:#888; }
  </style>
</head>
<body>
  <h1>⚡ Shadow Bot</h1>
  <p>Status: <span class="badge ${status.connection}">${status.connection}</span></p>
  ${status.pairingCode ? `<p>Pairing code (enter in WhatsApp &rarr; Linked Devices):</p><div class="code">${status.pairingCode}</div>` : ""}
  ${status.connection === "connected" ? `<p>Linked as: ${status.botName || "Unknown"} (${status.botId || ""})</p>` : ""}
  <p class="muted">Last update: ${status.lastUpdate}</p>
  <p class="muted">Page auto-refreshes every 5s.</p>
</body>
</html>`);
});

// Simple JSON endpoint, handy for scripting/uptime pings
app.get("/status", (req, res) => res.json(status));

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
  console.log(chalk.magenta("=".repeat(60)));
  console.log(chalk.yellow("  WhatsApp Multi-Device Bot  by Shadow Dev"));
  console.log(chalk.magenta("=".repeat(60)));
  console.log();
}

async function askPhoneNumber() {
  // On a host like Render there's no interactive terminal to type into, so
  // prefer OWNER_NUMBER from the environment. Falls back to the interactive
  // prompt for local/Termux use if OWNER_NUMBER isn't set and a TTY exists.
  const fromEnv = (process.env.OWNER_NUMBER || "").replace(/[^0-9]/g, "").replace(/^0+/, "");
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
        const clean = answer.trim().replace(/[^0-9]/g, "").replace(/^0+/, "");
        resolve(clean);
      }
    );
  });
}

async function startBot() {
  printBanner();

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  // Pairing code flow
  if (!sock.authState.creds.registered) {
    setStatus({ connection: "pairing" });
    const phoneNumber = await askPhoneNumber();

    console.log(chalk.yellow("\nNumber to use: " + phoneNumber));
    console.log(chalk.yellow("Waiting 4 seconds for socket to stabilize...\n"));

    // Must wait for socket before requesting code
    await new Promise((r) => setTimeout(r, 4000));

    try {
      const code = await sock.requestPairingCode(phoneNumber);
      const formatted = code.match(/.{1,4}/g).join("-");
      setStatus({ connection: "pairing", pairingCode: formatted });
      console.log("");
      console.log(chalk.bgGreen.black.bold("  ============================================  "));
      console.log(chalk.bgGreen.black.bold("   YOUR PAIRING CODE: " + formatted + "              "));
      console.log(chalk.bgGreen.black.bold("  ============================================  "));
      console.log("");
      console.log(chalk.cyan("STEPS:"));
      console.log(chalk.cyan("1. Open WhatsApp on your phone"));
      console.log(chalk.cyan("2. Tap the 3 dots (top right)"));
      console.log(chalk.cyan("3. Tap Linked Devices"));
      console.log(chalk.cyan("4. Tap Link a Device"));
      console.log(chalk.cyan("5. Tap 'Link with phone number instead'"));
      console.log(chalk.cyan("6. Enter YOUR number: " + phoneNumber));
      console.log(chalk.cyan("7. Enter code: " + formatted));
      console.log(chalk.yellow("\nYou have 60 seconds! (or check the Render status page)\n"));
    } catch (err) {
      console.error(chalk.red("FAILED to get pairing code: " + err.message));
      console.error(chalk.yellow("Fix: Run this in console: rm -rf session/  then restart"));
      setStatus({ connection: "disconnected" });
      process.exit(1);
    }
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(chalk.red("Disconnected. Code: " + statusCode));
      setStatus({ connection: "disconnected", pairingCode: null });

      if (statusCode === DisconnectReason.loggedOut) {
        console.log(chalk.red("Logged out! Clearing session..."));
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        process.exit(0);
      } else {
        console.log(chalk.yellow("Reconnecting in 5 seconds..."));
        setTimeout(startBot, 5000);
      }
    } else if (connection === "open") {
      console.log(chalk.green("\n✅ BOT CONNECTED TO WHATSAPP!"));
      console.log(chalk.cyan("Bot: " + (sock.user?.name || "Unknown") + " (" + sock.user?.id + ")"));
      console.log(chalk.yellow("Send .menu in any chat to get started!\n"));
      setStatus({
        connection: "connected",
        pairingCode: null,
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
