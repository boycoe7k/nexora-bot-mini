const axios = require("axios");
const fs = require("fs");

const PREFIX = ".";
const BOT_NAME = "Nexora Bot Mini";
const AUTHOR = "Boycoe-dev";
const MENU_IMAGE = "https://ibb.co/TB8XpF2T";
const OWNER = process.env.OWNER_NUMBER || "263781021754";

// ── API Configs ──
const VDL_API = "https://video-download-api-l5m6.onrender.com";
const EDITOR_API = "https://nexaeditor.onrender.com";
const NUMBERS_API = "https://nexa-numbers.onrender.com";
const API_KEY = process.env.API_KEY || "Nexora_YOUR_KEY_HERE";

const headers = {
  "Content-Type": "application/json",
  ...(API_KEY ? { "x-api-key": API_KEY } : {}),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMessageText(msg) {
  const m = msg.message;
  if (!m) return "";
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.buttonsResponseMessage?.selectedButtonId || m.templateButtonReplyMessage?.selectedId || m.listResponseMessage?.singleSelectReply?.selectedRowId || "";
}

async function urlToBuffer(url) {
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 60000, headers });
  return Buffer.from(res.data);
}

async function reply(sock, msg, text) {
  await sock.sendMessage(msg.key.remoteJid, { text: `*「 ${BOT_NAME} 」*\n\n${text}\n\n_By ${AUTHOR}_` }, { quoted: msg });
}

async function react(sock, msg, emoji) {
  try { await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }); } catch (_) {}
}

function getRuntime(startTime) {
  const diff = Date.now() - startTime;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

// ── Nexa VDL Logic ──
async function downloadMedia(sock, msg, url, type = "video") {
  const jid = msg.key.remoteJid;
  await reply(sock, msg, `⏳ *Nexora is processing your request...*\n🔗 *URL:* ${url}\n🛠️ *Type:* ${type.toUpperCase()}`);
  try {
    const dlRes = await axios.post(`${VDL_API}/api/media/download`, { url, type, quality: "720p" }, { headers });
    if (!dlRes.data.success) throw new Error(dlRes.data.error || "Download request failed");
    const jobId = dlRes.data.jobId;
    let attempts = 0;
    let statusData = null;
    while (attempts < 60) {
      attempts++;
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await axios.get(`${VDL_API}/api/status/${jobId}`, { headers });
      statusData = statusRes.data;
      if (statusData.status === "completed") break;
      if (statusData.status === "failed") throw new Error(statusData.error || "Job failed");
    }
    if (!statusData || statusData.status !== "completed") throw new Error("Download timed out");
    const buffer = await urlToBuffer(`${VDL_API}/api/download/${jobId}`);
    if (type === "audio") await sock.sendMessage(jid, { audio: buffer, mimetype: "audio/mpeg" }, { quoted: msg });
    else await sock.sendMessage(jid, { video: buffer, mimetype: "video/mp4", caption: `✅ *Download Complete*` }, { quoted: msg });
    await react(sock, msg, "✅");
  } catch (err) { await reply(sock, msg, `❌ *Error:* ${err.message}`); await react(sock, msg, "❌"); }
}

function buildMenu(pushName, runtime) {
  return `╭━〔 ⚡ NEXORA×MD ⚡ 〕━⬣
┃
┃ | [] ➜ STATUS    : ONLINE
┃ | [] ➜ RUNTIME   : ${runtime}
┃ | [] ➜ MODE      : Public
┃ | [] ➜ ACTIVE BOTS   : 1
┃ | [] ➜ COMMANDS  : 206+
┃ | [] ➜ DEV       : BOYCOE-DEV
┃
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 📥 DOWNLOADS 〕━━⬣
┃➤ .yt
┃➤ .mp3
┃➤ .mp4
┃➤ .song
┃➤ .video
┃➤ .tiktok
┃➤ .instagram
┃➤ .igstory
┃➤ .facebook
┃➤ .pinterest
┃➤ .wallpaper
┃➤ .wallpaper4k
┃➤ .media
┃➤ .download
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🔎 SEARCH 〕━━⬣
┃➤ .google
┃➤ .bing
┃➤ .duckduckgo
┃➤ .yahoo
┃➤ .brave
┃➤ .search
┃➤ .wiki
┃➤ .image
┃➤ .video
┃➤ .news
┃➤ .weather
┃➤ .maps
┃➤ .define
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🎬 VIDEO EDITOR 〕━━⬣
┃➤ .trim
┃➤ .crop
┃➤ .resize
┃➤ .rotate
┃➤ .filter
┃➤ .speed
┃➤ .text
┃➤ .watermark
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🖼️ IMAGE EDITOR 〕━━⬣
┃➤ .crop
┃➤ .rotate
┃➤ .resize
┃➤ .flip
┃➤ .filter
┃➤ .adjust
┃➤ .text
┃➤ .watermark
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🎨 MEDIA TOOLS 〕━━⬣
┃➤ .sticker
┃➤ .toimg
┃➤ .removebg
┃➤ .compress
┃➤ .enhance
┃➤ .blur
┃➤ .caption
┃➤ .collage
┃➤ .gif
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🎙️ VOICE & AUDIO 〕━━⬣
┃➤ .tts <text>
┃➤ .stt
┃➤ .transcribe
┃➤ .vtr <language>
┃➤ .volume
┃➤ .mute
┃➤ .audiomix
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🌐 TRANSLATE 〕━━⬣
┃➤ .tr <lang> <text>
┃➤ .translate <lang> <text>
┃➤ .detect
┃➤ .languages
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🤖 AI 〕━━⬣
┃➤ .ai
┃➤ .gpt
┃➤ .ask
┃➤ .summarize
┃➤ .rewrite
┃➤ .explain
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 👑 GROUP MANAGER 〕━━⬣
┃➤ .gcstatus
┃➤ .vv
┃➤ .kick
┃➤ .kickall
┃➤ .add
┃➤ .promote
┃➤ .demote
┃➤ .mute
┃➤ .unmute
┃➤ .link
┃➤ .revoke
┃➤ .groupinfo
┃➤ .tag
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 ⚙️ SETTINGS 〕━━⬣
┃➤ .autoreact on/off
┃➤ .autostatus on/off
┃➤ .antibadword on/off
┃➤ .antilink on/off
┃➤ .antidelete on/off
┃➤ .anticall on/off
┃➤ .settings
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🔐 TEMP NUMBERS 〕━━⬣
┃➤ .otp
┃➤ .numbers
┃➤ .countries
┃➤ .cancel
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🛠 TOOLS 〕━━⬣
┃➤ .calc
┃➤ .flip
┃➤ .roll
┃➤ .joke
┃➤ .quote
┃➤ .fact
┃➤ .8ball
┃➤ .reverse
┃➤ .upper
┃➤ .lower
┃➤ .id
┃➤ .whoami
┃➤ .say
┃➤ .spam
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 👑 OWNER 〕━━⬣
┃➤ .broadcast
┃➤ .restart
┃➤ .eval
┃➤ .block
┃➤ .unblock
╰━━━━━━━━━━━━━━━━━━━━⬣

━━━━━━━━━━━━━━━━━━━━
_“Nexora Bot Mini By BOYCOE-DEV”_`;
}

// ── Main Handler ──────────────────────────────────────────────────────────────
async function handleCommand(sock, msg, { startTime, settings }) {
  try {
    const jid = msg.key.remoteJid;
    const rawText = getMessageText(msg).trim();
    const isGroup = jid.endsWith("@g.us");

    if (rawText.startsWith("dl_video|") || rawText.startsWith("dl_audio|")) {
      const [type, url] = rawText.split("|");
      return downloadMedia(sock, msg, url, type === "dl_video" ? "video" : "audio");
    }

    if (!rawText.startsWith(PREFIX)) return;
    const parts = rawText.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = parts.shift().toLowerCase();
    const text = parts.join(" ");

    await react(sock, msg, "🚀");

    switch (cmd) {
      case "menu":
      case "help":
        const menu = buildMenu(msg.pushName || "User", getRuntime(startTime));
        try {
          const buf = await urlToBuffer(MENU_IMAGE);
          await sock.sendMessage(jid, { image: buf, caption: menu }, { quoted: msg });
        } catch { await reply(sock, msg, menu); }
        break;

      // ── Search & AI ──
      case "ai":
      case "gpt":
      case "ask":
      case "summarize":
      case "rewrite":
      case "explain":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <query>`);
        await reply(sock, msg, `🤖 *Nexora AI is thinking...*`);
        reply(sock, msg, `*Nexora AI:* Processing your request for ${cmd}... (Contact DEV for full GPT key)`);
        break;

      case "google":
      case "bing":
      case "duckduckgo":
      case "yahoo":
      case "brave":
      case "search":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <query>`);
        reply(sock, msg, `🔎 *Searching ${cmd} for:* ${text}...\n\nLink: https://www.google.com/search?q=${encodeURIComponent(text)}`);
        break;

      // ── Downloads ──
      case "yt":
      case "mp3":
      case "mp4":
      case "song":
      case "video":
      case "tiktok":
      case "instagram":
      case "igstory":
      case "facebook":
      case "pinterest":
      case "wallpaper":
      case "wallpaper4k":
      case "media":
      case "download":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <link/query>`);
        const url = text.match(/https?:\/\/\S+/i)?.[0];
        if (url) await downloadMedia(sock, msg, url, (cmd === "song" || cmd === "mp3") ? "audio" : "video");
        else reply(sock, msg, `🔎 *Searching for:* ${text}...\n(Downloading top result)`);
        break;

      // ── OTP / Temp Numbers ──
      case "countries":
      case "numbers":
      case "otp":
      case "cancel":
        if (cmd === "countries") {
          reply(sock, msg, `🌍 *Available Countries:* UK, USA, etc.\nView here: ${NUMBERS_API}/api/countries`);
        } else if (cmd === "numbers") {
          if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}numbers <uk/usa>`);
          reply(sock, msg, `📲 *Fetching numbers for ${text.toUpperCase()}...*\nView: ${NUMBERS_API}/api/numbers/${text.toLowerCase()}?page=1`);
        } else if (cmd === "otp") {
          if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}otp <number>`);
          reply(sock, msg, `📩 *Checking SMS for:* ${text}...\nView: ${NUMBERS_API}/api/receive-sms?phoneNumber=${encodeURIComponent(text)}`);
        }
        break;

      // ── Group Manager ──
      case "gcstatus":
      case "vv":
      case "kick":
      case "kickall":
      case "add":
      case "promote":
      case "demote":
      case "mute":
      case "unmute":
      case "link":
      case "revoke":
      case "groupinfo":
      case "tag":
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        if (cmd === "gcstatus") {
          const gMeta = await sock.groupMetadata(jid);
          reply(sock, msg, `📊 *GROUP STATUS*\n📌 *Name:* ${gMeta.subject}\n👥 *Members:* ${gMeta.participants.length}`);
        } else if (cmd === "tag") {
          const meta = await sock.groupMetadata(jid);
          const members = meta.participants.map(p => p.id);
          await sock.sendMessage(jid, { text: `📢 *SUMMONING EVERYONE!*\n\n${text || ""}`, mentions: members }, { quoted: msg });
        }
        break;

      // ── Settings ──
      case "autoreact":
      case "autostatus":
      case "antibadword":
      case "antilink":
      case "antidelete":
      case "anticall":
      case "settings":
        if (cmd === "settings") {
          let sText = `⚙️ *BOT SETTINGS*\n\n`;
          for (const key in settings) sText += `${settings[key] ? "✅" : "❌"} *${key.toUpperCase()}*\n`;
          reply(sock, msg, sText);
        } else {
          if (text === "on") { settings[cmd] = true; reply(sock, msg, `✅ *${cmd.toUpperCase()}* is now ON.`); }
          else if (text === "off") { settings[cmd] = false; reply(sock, msg, `❌ *${cmd.toUpperCase()}* is now OFF.`); }
          else reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} on/off`);
        }
        break;

      // ── Owner ──
      case "restart":
      case "broadcast":
      case "eval":
      case "block":
      case "unblock":
        if (msg.key.participant !== OWNER && !msg.key.fromMe) return reply(sock, msg, "❌ *Owner only!*");
        if (cmd === "restart") {
          await reply(sock, msg, "🔄 *Restarting bot...*");
          process.exit(0);
        }
        break;

      default:
        break;
    }
  } catch (err) { console.error("Handler error:", err.message); }
}

module.exports = { handleCommand };
