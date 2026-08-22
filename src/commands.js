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
┃ | [] ➜ STATUS    : ONLINE ✅
┃ | [] ➜ RUNTIME   : ${runtime}
┃ | [] ➜ MODE      : Public
┃ | [] ➜ ACTIVE BOTS   : 1
┃ | [] ➜ COMMANDS  : 206+
┃ | [] ➜ DEV       : ${AUTHOR.toUpperCase()}
┃
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 📥 DOWNLOADS 〕━━⬣
┃➤ .yt / .song / .vid
┃➤ .tiktok / .facebook
┃➤ .instagram / .pinterest
┃➤ .wallpaper / .media
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🔎 SEARCH 〕━━⬣
┃➤ .google / .bing
┃➤ .wiki / .image
┃➤ .news / .weather
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🎬 VIDEO EDITOR 〕━━⬣
┃➤ .trim / .crop
┃➤ .resize / .speed
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🖼️ IMAGE EDITOR 〕━━⬣
┃➤ .filter / .resize
┃➤ .text / .watermark
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🤖 AI 〕━━⬣
┃➤ .ai / .gpt / .ask
┃➤ .summarize / .rewrite
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 👑 GROUP MANAGER 〕━━⬣
┃➤ .gcstatus / .vv
┃➤ .kick / .add / .tag
┃➤ .mute / .unmute
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 ⚙️ SETTINGS 〕━━⬣
┃➤ .autostatus / .anticall
┃➤ .antilink / .antidelete
┃➤ .settings
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🔐 TEMP NUMBERS 〕━━⬣
┃➤ .otp / .numbers
┃➤ .countries / .cancel
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🛠 TOOLS 〕━━⬣
┃➤ .calc / .joke / .quote
┃➤ .flip / .roll / .say
╰━━━━━━━━━━━━━━━━━━━━⬣

━━━━━━━━━━━━━━━━━━━━
_“Nexora Bot Mini By ${AUTHOR}”_`;
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
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <query>`);
        await reply(sock, msg, `🤖 *Nexora AI is thinking...*`);
        // Placeholder for AI logic
        reply(sock, msg, `*Nexora AI:* This is a placeholder for the GPT integration. Contact ${AUTHOR} for full API setup.`);
        break;

      case "google":
      case "search":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <query>`);
        reply(sock, msg, `🔎 *Searching Google for:* ${text}...\n\nhttps://www.google.com/search?q=${encodeURIComponent(text)}`);
        break;

      // ── Downloads ──
      case "yt":
      case "vid":
      case "song":
      case "fb":
      case "ig":
      case "tt":
      case "tiktok":
      case "facebook":
      case "instagram":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <link/query>`);
        const url = text.match(/https?:\/\/\S+/i)?.[0];
        if (url) await downloadMedia(sock, msg, url, (cmd === "song" || cmd === "mp3") ? "audio" : "video");
        else reply(sock, msg, `🔎 *Searching YouTube for:* ${text}...\n(Buttons will appear in the next update)`);
        break;

      // ── OTP / Temp Numbers ──
      case "countries":
        const countriesRes = await axios.get(`${NUMBERS_API}/api/health`);
        reply(sock, msg, `🌍 *Nexa Numbers API is:* ${countriesRes.data.status || "Online"}\nCheck countries here: ${NUMBERS_API}/api/countries`);
        break;

      case "numbers":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}numbers <country_code>`);
        reply(sock, msg, `📲 *Fetching numbers for ${text.toUpperCase()}...*\nView live here: ${NUMBERS_API}/api/numbers/${text.toLowerCase()}?page=1`);
        break;

      case "otp":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}otp <phone_number>`);
        reply(sock, msg, `📩 *Checking SMS for:* ${text}...\nView inbox: ${NUMBERS_API}/api/receive-sms?phoneNumber=${encodeURIComponent(text)}`);
        break;

      // ── Group Manager ──
      case "gcstatus":
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const gMeta = await sock.groupMetadata(jid);
        reply(sock, msg, `📊 *GROUP STATUS*\n📌 *Name:* ${gMeta.subject}\n👥 *Members:* ${gMeta.participants.length}\n👑 *Admins:* ${gMeta.participants.filter(p => p.admin).length}`);
        break;

      case "kick":
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (!target) return reply(sock, msg, `❌ *Tag someone to kick!*`);
        await sock.groupParticipantsUpdate(jid, [target], "remove");
        reply(sock, msg, `👢 *User kicked.*`);
        break;

      // ── Settings ──
      case "autostatus":
      case "anticall":
      case "antilink":
      case "antidelete":
        if (text === "on") { settings[cmd] = true; reply(sock, msg, `✅ *${cmd.toUpperCase()}* is now ON.`); }
        else if (text === "off") { settings[cmd] = false; reply(sock, msg, `❌ *${cmd.toUpperCase()}* is now OFF.`); }
        else reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} on/off`);
        break;

      case "settings":
        let sText = `⚙️ *BOT SETTINGS*\n\n`;
        for (const key in settings) sText += `${settings[key] ? "✅" : "❌"} *${key.toUpperCase()}*\n`;
        reply(sock, msg, sText);
        break;

      // ── Owner ──
      case "restart":
        if (msg.key.participant !== OWNER && !msg.key.fromMe) return reply(sock, msg, "❌ *Owner only!*");
        await reply(sock, msg, "🔄 *Restarting bot...*");
        process.exit(0);
        break;

      default:
        break;
    }
  } catch (err) { console.error("Handler error:", err.message); }
}

module.exports = { handleCommand };
