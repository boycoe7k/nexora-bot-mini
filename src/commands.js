const axios = require("axios");
const fs = require("fs");

const PREFIX = ".";
const BOT_NAME = "Nexora Bot Mini";
const MENU_IMAGE = "https://files.catbox.moe/qvsvi2.jpg";
const OWNER = process.env.OWNER_NUMBER || "263716808196";

// ── Nexa VDL Config ──
const API_URL = "https://video-download-api-l5m6.onrender.com";
const API_KEY = process.env.API_KEY || "Nexora_YOUR_KEY_HERE";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120;

const headers = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMessageText(msg) {
  const m = msg.message;
  if (!m) return "";
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || "";
}

async function urlToBuffer(url) {
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 60000, headers });
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

function extractUrl(text) {
  const match = text.match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
}

// ── Nexa VDL Logic ──
async function downloadMedia(sock, msg, url, type = "video") {
  const jid = msg.key.remoteJid;
  await reply(sock, msg, `⏳ *Nexora is processing your request...*\n🔗 *URL:* ${url}\n🛠️ *Type:* ${type.toUpperCase()}`);

  try {
    // 1. Get Info
    const infoRes = await axios.post(`${API_URL}/api/media/info`, { url }, { headers });
    if (!infoRes.data.success) throw new Error(infoRes.data.error || "Failed to fetch media info");
    
    const title = infoRes.data.title || "Nexora Download";
    await reply(sock, msg, `🎬 *Found:* ${title.slice(0, 50)}...\n⏱️ *Starting download...*`);

    // 2. Start Download
    const dlRes = await axios.post(`${API_URL}/api/media/download`, { url, type, quality: "720p" }, { headers });
    if (!dlRes.data.success) throw new Error(dlRes.data.error || "Download request failed");
    
    const jobId = dlRes.data.jobId;
    let attempts = 0;
    let statusData = null;

    // 3. Poll Status
    while (attempts < MAX_POLL_ATTEMPTS) {
      attempts++;
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      
      const statusRes = await axios.get(`${API_URL}/api/status/${jobId}`, { headers });
      statusData = statusRes.data;

      if (statusData.status === "completed") break;
      if (statusData.status === "failed") throw new Error(statusData.error || "Job failed");
      
      if (attempts % 10 === 0 && statusData.progress) {
        await reply(sock, msg, `⏳ *Progress:* ${statusData.progress}%`);
      }
    }

    if (!statusData || statusData.status !== "completed") throw new Error("Download timed out");

    // 4. Send File
    await reply(sock, msg, `✅ *Download complete!*\n📤 *Sending file...*`);
    const fileUrl = `${API_URL}/api/download/${jobId}`;
    const buffer = await urlToBuffer(fileUrl);
    
    if (type === "audio") {
      await sock.sendMessage(jid, { audio: buffer, mimetype: "audio/mpeg", fileName: `${title}.mp3` }, { quoted: msg });
    } else {
      await sock.sendMessage(jid, { video: buffer, mimetype: "video/mp4", caption: `✅ *${title}*`, fileName: `${title}.mp4` }, { quoted: msg });
    }
    await react(sock, msg, "✅");

  } catch (err) {
    console.error("VDL Error:", err.message);
    await reply(sock, msg, `❌ *Nexora Error:* ${err.message}`);
    await react(sock, msg, "❌");
  }
}

async function searchYouTube(sock, msg, query) {
  try {
    await reply(sock, msg, `🔎 *Searching for:* ${query}...`);
    const res = await axios.get(`${API_URL}/api/search?q=${encodeURIComponent(query)}`, { headers });
    if (!res.data || !res.data.length) return reply(sock, msg, "❌ *No results found.*");

    let resultsText = `🎬 *YOUTUBE SEARCH RESULTS*\n\n`;
    res.data.slice(0, 6).forEach((res, i) => {
      resultsText += `*${i + 1}.* ${res.title}\n⏱️ *Duration:* ${res.duration}\n🔗 ${res.url}\n\n`;
    });
    resultsText += `_Use ${PREFIX}yt <link> to download_`;
    
    await reply(sock, msg, resultsText);
  } catch (err) {
    await reply(sock, msg, `❌ *Search failed:* ${err.message}`);
  }
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
┣ \`${PREFIX}ping\` - Latency test
┣ \`${PREFIX}alive\` - System status
┣ \`${PREFIX}owner\` - Creator info
┗ \`${PREFIX}menu\` - Show menu

📥 *DOWNLOADER (NEXA VDL)*
┣ \`${PREFIX}yts\` - YouTube Search
┣ \`${PREFIX}yt\` - YouTube Video
┣ \`${PREFIX}song\` - YouTube Audio (MP3)
┣ \`${PREFIX}fb\` - Facebook Video
┣ \`${PREFIX}ig\` - Instagram Reels/Video
┗ \`${PREFIX}tt\` - TikTok (No Watermark)

🛡️ *GROUP TOOLS*
┣ \`${PREFIX}tagall\` - Summon all
┣ \`${PREFIX}groupinfo\` - Group stats
┣ \`${PREFIX}link\` - Invite link
┗ \`${PREFIX}mute\` / \`${PREFIX}unmute\`

🎨 *FUN & TOOLS*
┣ \`${PREFIX}sticker\` - Image to sticker
┣ \`${PREFIX}joke\` - Random laugh
┣ \`${PREFIX}quote\` - Inspiration
┗ \`${PREFIX}wiki\` - Search Wiki

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
        await reply(sock, msg, `✅ *Pong!*\n⚡ *Latency:* ${Date.now() - start}ms`);
        break;

      case "alive":
        await reply(sock, msg, `🌟 *NEXORA MINI IS ACTIVE* 🌟\n📡 *Status:* Fully Operational\n💻 *Platform:* Render Cloud\n🛡️ *Identity:* Safari (macOS)`);
        break;

      case "yts":
        if (!text) return reply(sock, msg, `❌ *Usage:* ${PREFIX}yts <query>`);
        await searchYouTube(sock, msg, text);
        break;

      case "yt":
      case "fb":
      case "ig":
      case "tt":
        const url = extractUrl(text);
        if (!url) return reply(sock, msg, `❌ *Please provide a valid link!*`);
        await downloadMedia(sock, msg, url, "video");
        break;

      case "song":
      case "mp3":
        const songUrl = extractUrl(text);
        if (songUrl) {
          await downloadMedia(sock, msg, songUrl, "audio");
        } else if (text) {
          // If no URL but text exists, search first
          try {
            const res = await axios.get(`${API_URL}/api/search?q=${encodeURIComponent(text)}`, { headers });
            if (res.data && res.data.length) {
              await downloadMedia(sock, msg, res.data[0].url, "audio");
            } else {
              await reply(sock, msg, "❌ *No results found.*");
            }
          } catch (e) {
            await reply(sock, msg, `❌ *Search failed:* ${e.message}`);
          }
        } else {
          await reply(sock, msg, `❌ *Usage:* ${PREFIX}${cmd} <link/search query>`);
        }
        break;

      case "sticker":
      case "s":
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const img = quoted?.imageMessage || msg.message?.imageMessage;
        if (!img) return reply(sock, msg, "🎨 *Reply to an image to create a sticker!*");
        await reply(sock, msg, "⏳ *Converting...*");
        try {
          const buf = await urlToBuffer(img.url);
          await sock.sendMessage(jid, { sticker: buf }, { quoted: msg });
        } catch (e) {
          await reply(sock, msg, "❌ *Sticker failed.*");
        }
        break;

      case "tagall":
        if (!jid.endsWith("@g.us")) return reply(sock, msg, "❌ *Groups only!*");
        const meta = await sock.groupMetadata(jid);
        const members = meta.participants.map(p => p.id);
        const mentionText = `📢 *SUMMONING EVERYONE!*\n\n` + (text ? `💬 *Message:* ${text}\n\n` : "") + members.map(m => `@${m.split("@")[0]}`).join(" ");
        await sock.sendMessage(jid, { text: mentionText, mentions: members }, { quoted: msg });
        break;

      default:
        break;
    }
  } catch (err) {
    console.error("Handler error:", err.message);
  }
}

module.exports = { handleCommand };
