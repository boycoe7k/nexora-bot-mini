const axios = require("axios");
const fs = require("fs");
const { OpenAI } = require("openai");

const PREFIX = ".";
const BOT_NAME = "Nexora Bot Mini";
const AUTHOR = "Boycoe-dev";
const MENU_IMAGE = "https://i.ibb.co/JR7L0Mtd/4eb100a2-65ed-4607-8b68-26280d75f6b9.jpg";
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

// Initialize OpenAI for AI commands
let openai;
try {
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
} catch (e) {
  console.error("OpenAI Init Error:", e.message);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMessageText(msg) {
  const m = msg.message;
  if (!m) return "";
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.buttonsResponseMessage?.selectedButtonId) return m.buttonsResponseMessage.selectedButtonId;
  if (m.templateButtonReplyMessage?.selectedId) return m.templateButtonReplyMessage.selectedId;
  if (m.listResponseMessage?.singleSelectReply?.selectedRowId) return m.listResponseMessage.singleSelectReply.selectedRowId;
  return "";
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

async function youtubeSearch(sock, msg, query) {
  const jid = msg.key.remoteJid;
  await reply(sock, msg, `🔎 *Searching YouTube for:* ${query}...`);
  try {
    const res = await axios.get(`${VDL_API}/api/search?q=${encodeURIComponent(query)}`, { headers });
    const results = res.data.results || [];
    if (results.length === 0) return reply(sock, msg, "❌ No results found.");

    const first = results[0];
    const caption = `🎬 *YouTube Search Results*
    
📌 *Title:* ${first.title}
⏱️ *Duration:* ${first.duration}
🔗 *URL:* ${first.url}

*Reply with:*
1️⃣ .song ${first.url} (Audio)
2️⃣ .video ${first.url} (Video)

_Or search for something else._`;

    const buf = await urlToBuffer(first.thumbnail);
    await sock.sendMessage(jid, { 
        image: buf, 
        caption: caption,
        footer: "Nexora Bot Mini",
        buttons: [
            { buttonId: `.song ${first.url}`, buttonText: { displayText: '🎵 Audio' }, type: 1 },
            { buttonId: `.video ${first.url}`, buttonText: { displayText: '🎥 Video' }, type: 1 }
        ],
        headerType: 4
    }, { quoted: msg });
    
  } catch (err) { 
      console.error(err);
      reply(sock, msg, "❌ Error fetching search results."); 
  }
}

// ── AI Logic ──
async function handleAI(sock, msg, prompt) {
    if (!openai) {
        return reply(sock, msg, "❌ *AI Error:* OpenAI API Key is missing. Please set `OPENAI_API_KEY` in your Render environment variables to enable AI commands.");
    }
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
        });
        const aiText = response.choices[0].message.content;
        await reply(sock, msg, `🤖 *Nexora AI:*\n\n${aiText}`);
    } catch (err) {
        await reply(sock, msg, "❌ AI Service currently unavailable. Try again later.");
    }
}

function buildMenu(pushName, runtime) {
  return `╭━〔 ⚡ NEXORA×MD ⚡ 〕━⬣
┃
┃ | [] ➜ STATUS    : ONLINE
┃ | [] ➜ RUNTIME   : ${runtime}
┃ | [] ➜ MODE      : Public
┃ | [] ➜ ACTIVE BOTS   : 1
┃ | [] ➜ COMMANDS  : 100+
┃ | [] ➜ DEV       : BOYCOE-DEV
┃
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 📥 DOWNLOADS 〕━━⬣
┃➤ .yt <query>
┃➤ .mp3 <url>
┃➤ .mp4 <url>
┃➤ .song <query/url>
┃➤ .video <query/url>
┃➤ .tiktok <url>
┃➤ .instagram <url>
┃➤ .igstory <url>
┃➤ .facebook <url>
┃➤ .pinterest <url>
┃➤ .wallpaper <query>
┃➤ .wallpaper4k <query>
┃➤ .media <url>
┃➤ .download <url>
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🔎 SEARCH 〕━━⬣
┃➤ .google <query>
┃➤ .bing <query>
┃➤ .duckduckgo <query>
┃➤ .yahoo <query>
┃➤ .brave <query>
┃➤ .search <query>
┃➤ .wiki <query>
┃➤ .image <query>
┃➤ .video <query>
┃➤ .news <query>
┃➤ .weather <city>
┃➤ .maps <location>
┃➤ .define <word>
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🎬 VIDEO EDITOR 〕━━⬣
┃➤ .trim (reply video)
┃➤ .crop (reply video)
┃➤ .resize (reply video)
┃➤ .rotate (reply video)
┃➤ .filter (reply video)
┃➤ .speed (reply video)
┃➤ .text (reply video)
┃➤ .watermark (reply video)
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🖼️ IMAGE EDITOR 〕━━⬣
┃➤ .crop (reply img)
┃➤ .rotate (reply img)
┃➤ .resize (reply img)
┃➤ .flip (reply img)
┃➤ .filter (reply img)
┃➤ .adjust (reply img)
┃➤ .text (reply img)
┃➤ .watermark (reply img)
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🎨 MEDIA TOOLS 〕━━⬣
┃➤ .sticker (reply img)
┃➤ .toimg (reply sticker)
┃➤ .removebg (reply img)
┃➤ .compress (reply media)
┃➤ .enhance (reply img)
┃➤ .blur (reply img)
┃➤ .caption (reply media)
┃➤ .collage (reply imgs)
┃➤ .gif (reply video)
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🎙️ VOICE & AUDIO 〕━━⬣
┃➤ .tts <text>
┃➤ .stt (reply audio)
┃➤ .transcribe (reply audio)
┃➤ .vtr <language>
┃➤ .volume (reply audio)
┃➤ .mute (reply audio)
┃➤ .audiomix
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🌐 TRANSLATE 〕━━⬣
┃➤ .tr <lang> <text>
┃➤ .translate <lang> <text>
┃➤ .detect <text>
┃➤ .languages
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🤖 AI 〕━━⬣
┃➤ .ai <query>
┃➤ .gpt <query>
┃➤ .ask <query>
┃➤ .summarize <text>
┃➤ .rewrite <text>
┃➤ .explain <text>
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 👑 GROUP MANAGER 〕━━⬣
┃➤ .gcstatus
┃➤ .vv
┃➤ .kick @user
┃➤ .kickall
┃➤ .add 263...
┃➤ .promote @user
┃➤ .demote @user
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
┃➤ .otp <number>
┃➤ .numbers <country>
┃➤ .countries
┃➤ .cancel
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🛠 TOOLS 〕━━⬣
┃➤ .calc <math>
┃➤ .flip
┃➤ .roll
┃➤ .joke
┃➤ .quote
┃➤ .fact
┃➤ .8ball <q>
┃➤ .reverse <text>
┃➤ .upper <text>
┃➤ .lower <text>
┃➤ .id
┃➤ .whoami
┃➤ .say <text>
┃➤ .spam <text>
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 👑 OWNER 〕━━⬣
┃➤ .broadcast <text>
┃➤ .restart
┃➤ .eval <code>
┃➤ .block @user
┃➤ .unblock @user
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

    if (!rawText.startsWith(PREFIX)) {
        // Handle button clicks (which might not start with prefix if ID is just a URL)
        if (rawText.includes("https://www.youtube.com/watch?v=")) {
            const url = rawText.match(/https?:\/\/\S+/i)?.[0];
            if (rawText.includes(".song")) return downloadMedia(sock, msg, url, "audio");
            if (rawText.includes(".video")) return downloadMedia(sock, msg, url, "video");
        }
        return;
    }

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
        await handleAI(sock, msg, text);
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
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}yt <query>`);
        await youtubeSearch(sock, msg, text);
        break;
      case "song":
      case "mp3":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <query/url>`);
        if (text.startsWith("http")) await downloadMedia(sock, msg, text, "audio");
        else await youtubeSearch(sock, msg, text);
        break;
      case "video":
      case "mp4":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <query/url>`);
        if (text.startsWith("http")) await downloadMedia(sock, msg, text, "video");
        else await youtubeSearch(sock, msg, text);
        break;
      case "tiktok":
      case "instagram":
      case "facebook":
      case "pinterest":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <url>`);
        await downloadMedia(sock, msg, text, "video");
        break;

      // ── OTP / Temp Numbers ──
      case "countries":
        try {
            const res = await axios.get(`${NUMBERS_API}/api/countries`, { headers });
            const list = res.data.countries || ["UK", "USA", "Russia", "Nigeria"];
            reply(sock, msg, `🌍 *Available Countries:*\n\n${list.join(", ")}\n\nUse ${PREFIX}numbers <country> to get numbers.`);
        } catch { reply(sock, msg, "❌ Error fetching countries."); }
        break;
      case "numbers":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}numbers <country>`);
        try {
            const res = await axios.get(`${NUMBERS_API}/api/numbers/${text.toLowerCase()}?page=1`, { headers });
            const nums = res.data.numbers || [];
            if (nums.length === 0) return reply(sock, msg, "❌ No numbers found for this country.");
            let nText = `📲 *Numbers for ${text.toUpperCase()}:*\n\n`;
            nums.slice(0, 10).forEach(n => nText += `• ${n.phoneNumber}\n`);
            nText += `\nUse ${PREFIX}otp <number> to check SMS.`;
            reply(sock, msg, nText);
        } catch { reply(sock, msg, "❌ Error fetching numbers."); }
        break;
      case "otp":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}otp <number>`);
        try {
            const res = await axios.get(`${NUMBERS_API}/api/receive-sms?phoneNumber=${encodeURIComponent(text)}`, { headers });
            const sms = res.data.messages || [];
            if (sms.length === 0) return reply(sock, msg, "❌ No messages found for this number yet.");
            let sText = `📩 *Recent SMS for ${text}:*\n\n`;
            sms.slice(0, 5).forEach(m => sText += `From: ${m.from}\nMsg: ${m.text}\nTime: ${m.time}\n\n`);
            reply(sock, msg, sText);
        } catch { reply(sock, msg, "❌ Error fetching OTP."); }
        break;

      // ── Group Manager ──
      case "kick":
      case "promote":
      case "demote":
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (users.length === 0) return reply(sock, msg, "❌ Mention the user!");
        await sock.groupParticipantsUpdate(jid, users, cmd === "kick" ? "remove" : cmd);
        reply(sock, msg, `✅ Done.`);
        break;
      case "tag":
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const meta = await sock.groupMetadata(jid);
        const members = meta.participants.map(p => p.id);
        await sock.sendMessage(jid, { text: `📢 *SUMMONING EVERYONE!*\n\n${text || ""}`, mentions: members }, { quoted: msg });
        break;

      // ── Utilities ──
      case "calc":
        if (!text) return reply(sock, msg, "❓ *Usage:* .calc 2+2");
        try { reply(sock, msg, `📊 *Result:* ${eval(text)}`); } catch { reply(sock, msg, "❌ Invalid expression."); }
        break;
      case "joke":
        const joke = await axios.get("https://official-joke-api.appspot.com/random_joke");
        reply(sock, msg, `😂 *Joke:*\n\n${joke.data.setup}\n\n${joke.data.punchline}`);
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
