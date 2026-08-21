const axios = require("axios");
const fs = require("fs");

const PREFIX = ".";
const BOT_NAME = "Nexora Bot Mini";
const MENU_IMAGE = "https://files.catbox.moe/qvsvi2.jpg";
const OWNER = process.env.OWNER_NUMBER || "263716808196";

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMessageText(msg) {
  const m = msg.message;
  if (!m) return "";
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || "";
}

async function urlToBuffer(url) {
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
  return Buffer.from(res.data);
}

async function reply(sock, msg, text) {
  await sock.sendMessage(msg.key.remoteJid, { 
    text: `*「 ${BOT_NAME} 」*\n\n${text}\n\n_Powered by Shadow Dev_` 
  }, { quoted: msg });
}

async function react(sock, msg, emoji) {
  try { await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }); } catch (_) {}
}

function buildMenu(pushName) {
  const time = new Date().toLocaleTimeString("en-US", { hour12: true });
  return `✨ *WELCOME TO NEXORA MINI* ✨

👋 *Hello,* ${pushName}
🕒 *Time:* ${time}
🤖 *Bot:* ${BOT_NAME}
🔣 *Prefix:* \`${PREFIX}\`

━━━━━━━━━━━━━━━━━━━━━━━━
🚀 *CORE COMMANDS*
┣ \`${PREFIX}ping\` - Check bot latency
┣ \`${PREFIX}alive\` - Bot system status
┣ \`${PREFIX}owner\` - Contact my creator
┣ \`${PREFIX}menu\` - Show this interface
┗ \`${PREFIX}runtime\` - How long I've been active

🛡️ *GROUP TOOLS*
┣ \`${PREFIX}tagall\` - Summon all members
┣ \`${PREFIX}groupinfo\` - Detailed group stats
┣ \`${PREFIX}link\` - Get group invite link
┣ \`${PREFIX}mute\` - Admins only mode
┗ \`${PREFIX}unmute\` - Open group chat

🎨 *CREATIVE & FUN*
┣ \`${PREFIX}sticker\` - Image to sticker
┣ \`${PREFIX}joke\` - Get a random laugh
┣ \`${PREFIX}quote\` - Daily inspiration
┣ \`${PREFIX}weather\` - Check city weather
┗ \`${PREFIX}wiki\` - Search Wikipedia

🔍 *SEARCH TOOLS*
┣ \`${PREFIX}image\` - Search high-res images
┗ \`${PREFIX}gif\` - Find the perfect GIF

━━━━━━━━━━━━━━━━━━━━━━━━
_“Efficiency in every message.”_`;
}

// ── Main Handler ──────────────────────────────────────────────────────────────
async function handleCommand(sock, msg) {
  try {
    const jid = msg.key.remoteJid;
    const sender = msg.key.participant || jid;
    const pushName = msg.pushName || "User";
    const body = getMessageText(msg).trim();

    if (!body.startsWith(PREFIX)) return;

    const parts = body.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = parts.shift().toLowerCase();
    const text = parts.join(" ");

    await react(sock, msg, "🚀");

    switch (cmd) {
      case "menu":
        const menu = buildMenu(pushName);
        try {
          const buf = await urlToBuffer(MENU_IMAGE);
          await sock.sendMessage(jid, { image: buf, caption: menu }, { quoted: msg });
        } catch {
          await reply(sock, msg, menu);
        }
        break;

      case "ping":
        const start = Date.now();
        await reply(sock, msg, "🚀 *Analyzing system latency...*");
        await reply(sock, msg, `✅ *Nexora is running smooth!*\n⚡ *Latency:* ${Date.now() - start}ms`);
        break;

      case "alive":
        const uptime = process.uptime();
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        const s = Math.floor(uptime % 60);
        await reply(sock, msg, 
          `🌟 *NEXORA MINI IS ACTIVE* 🌟\n\n` +
          `📡 *Status:* Fully Operational\n` +
          `⏱️ *Uptime:* ${h}h ${m}m ${s}s\n` +
          `💻 *Platform:* Render Cloud\n` +
          `🛡️ *Identity:* Safari (macOS)\n\n` +
          `_I am ready to assist you!_`
        );
        break;

      case "owner":
        await reply(sock, msg, `👑 *MY CREATOR*\n\nHello! I was built by *Shadow Dev*. You can reach him here:\n\n📱 *WhatsApp:* wa.me/${OWNER}\n✨ *Project:* Nexora Bot Mini`);
        break;

      case "joke":
        try {
          const res = await axios.get("https://official-joke-api.appspot.com/random_joke");
          await reply(sock, msg, `😂 *Here is a joke for you!*\n\n*Q:* ${res.data.setup}\n*A:* ${res.data.punchline}`);
        } catch {
          await reply(sock, msg, "😂 *Classic Joke:* Why did the web developer walk out of a restaurant? Because of the table layout!");
        }
        break;

      case "quote":
        try {
          const res = await axios.get("https://api.quotable.io/random");
          await reply(sock, msg, `💭 *Daily Inspiration*\n\n"${res.data.content}"\n\n— _${res.data.author}_`);
        } catch {
          await reply(sock, msg, "💭 *Inspiration:* The best way to predict the future is to create it.");
        }
        break;

      case "wiki":
        if (!text) return reply(sock, msg, "🔍 *Please provide a topic to search!*");
        try {
          const res = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text)}`);
          await reply(sock, msg, `📚 *WIKIPEDIA: ${res.data.title}*\n\n${res.data.extract}`);
        } catch {
          await reply(sock, msg, "❌ *Sorry, I couldn't find any information on that topic.*");
        }
        break;

      case "sticker":
      case "s":
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const img = quoted?.imageMessage || msg.message?.imageMessage;
        if (!img) return reply(sock, msg, "🎨 *Please reply to an image to create a sticker!*");
        await reply(sock, msg, "⏳ *Converting image to sticker, please wait...*");
        try {
          const buf = await urlToBuffer(img.url);
          await sock.sendMessage(jid, { sticker: buf }, { quoted: msg });
        } catch (e) {
          await reply(sock, msg, "❌ *Sticker creation failed. Please try again with a different image.*");
        }
        break;

      case "tagall":
        if (!jid.endsWith("@g.us")) return reply(sock, msg, "❌ *This command only works in groups!*");
        const meta = await sock.groupMetadata(jid);
        const members = meta.participants.map(p => p.id);
        const mentionText = `📢 *NEXORA SUMMONS EVERYONE!*\n\n` + (text ? `💬 *Message:* ${text}\n\n` : "") + members.map(m => `@${m.split("@")[0]}`).join(" ");
        await sock.sendMessage(jid, { text: mentionText, mentions: members }, { quoted: msg });
        break;

      default:
        // Silently ignore unknown commands
        break;
    }
  } catch (err) {
    console.error("Handler error:", err.message);
  }
}

module.exports = { handleCommand };
