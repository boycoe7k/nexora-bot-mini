const axios = require("axios");
const fs = require("fs");

const PREFIX = ".";
const BOT_NAME = "Nexora Bot Mini";
const AUTHOR = "Boycoe-dev";
const MENU_IMAGE = "https://ibb.co/TB8XpF2T";
const OWNER = process.env.OWNER_NUMBER || "263781021754";

// ── Nexa VDL Config ──
const API_URL = "https://video-download-api-l5m6.onrender.com";
const API_KEY = process.env.API_KEY || "Nexora_YOUR_KEY_HERE";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120;

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

function extractUrl(text) {
  const match = text.match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
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
    const infoRes = await axios.post(`${API_URL}/api/media/info`, { url }, { headers });
    if (!infoRes.data.success) throw new Error(infoRes.data.error || "Failed to fetch media info");
    const title = infoRes.data.title || "Nexora Download";
    await reply(sock, msg, `🎬 *Found:* ${title.slice(0, 50)}...\n⏱️ *Starting download...*`);
    const dlRes = await axios.post(`${API_URL}/api/media/download`, { url, type, quality: "720p" }, { headers });
    if (!dlRes.data.success) throw new Error(dlRes.data.error || "Download request failed");
    const jobId = dlRes.data.jobId;
    let attempts = 0;
    let statusData = null;
    while (attempts < MAX_POLL_ATTEMPTS) {
      attempts++;
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const statusRes = await axios.get(`${API_URL}/api/status/${jobId}`, { headers });
      statusData = statusRes.data;
      if (statusData.status === "completed") break;
      if (statusData.status === "failed") throw new Error(statusData.error || "Job failed");
      if (attempts % 10 === 0 && statusData.progress) await reply(sock, msg, `⏳ *Progress:* ${statusData.progress}%`);
    }
    if (!statusData || statusData.status !== "completed") throw new Error("Download timed out");
    await reply(sock, msg, `✅ *Download complete!*\n📤 *Sending file...*`);
    const fileUrl = `${API_URL}/api/download/${jobId}`;
    const buffer = await urlToBuffer(fileUrl);
    if (type === "audio") await sock.sendMessage(jid, { audio: buffer, mimetype: "audio/mpeg", fileName: `${title}.mp3` }, { quoted: msg });
    else await sock.sendMessage(jid, { video: buffer, mimetype: "video/mp4", caption: `✅ *${title}*`, fileName: `${title}.mp4` }, { quoted: msg });
    await react(sock, msg, "✅");
  } catch (err) { await reply(sock, msg, `❌ *Nexora Error:* ${err.message}`); await react(sock, msg, "❌"); }
}

async function searchYouTubeWithButtons(sock, msg, query) {
  try {
    const jid = msg.key.remoteJid;
    await reply(sock, msg, `🔎 *Searching for:* ${query}...`);
    const res = await axios.get(`${API_URL}/api/search?q=${encodeURIComponent(query)}`, { headers });
    if (!res.data || !res.data.length) return reply(sock, msg, "❌ *No results found.*");
    const topResult = res.data[0];
    const caption = `📥 *NEXORA DOWNLOADER*\n\n📌 *Title:* ${topResult.title.slice(0, 60)}\n🌐 *Platform:* YouTube\n🔗 *URL:* ${topResult.url}\n\n_Select an option below:_`;
    const buttons = [{ buttonId: `dl_video|${topResult.url}`, buttonText: { displayText: "🎥 Video" }, type: 1 }, { buttonId: `dl_audio|${topResult.url}`, buttonText: { displayText: "🎵 Audio" }, type: 1 }];
    await sock.sendMessage(jid, { image: { url: topResult.thumbnail }, caption, footer: `Nexora Bot Mini By ${AUTHOR}`, buttons, headerType: 4 }, { quoted: msg });
  } catch (err) { await reply(sock, msg, `❌ *Search failed:* ${err.message}`); }
}

function buildMenu(pushName, runtime) {
  return `┌──『 *${BOT_NAME.toUpperCase()}* 』───
│
│ ➻ *STATUS:* ONLINE ✅
│ ➻ *RUNTIME:* ${runtime}
│ ➻ *MODE:* Public
│ ➻ *ACTIVE BOTS:* 1
│ ➻ *TOTAL CMDS:* 206+
│ ➻ *DEV:* ${AUTHOR.toUpperCase()}
│
└───────────────┈ ➻

👑 *GROUP MANAGER*
┣ \`${PREFIX}gcstatus\`
┣ \`${PREFIX}vv\`
┣ \`${PREFIX}kick\`
┣ \`${PREFIX}add\`
┣ \`${PREFIX}promote\`
┣ \`${PREFIX}demote\`
┣ \`${PREFIX}mute\`
┣ \`${PREFIX}unmute\`
┣ \`${PREFIX}link\`
┣ \`${PREFIX}revoke\`
┣ \`${PREFIX}groupinfo\`
┗ \`${PREFIX}tag\`

⚙️ *SETTINGS*
┣ \`${PREFIX}autoreact\` [on/off]
┣ \`${PREFIX}autostatus\` [on/off]
┣ \`${PREFIX}antibadword\` [on/off]
┣ \`${PREFIX}antilink\` [on/off]
┣ \`${PREFIX}antidelete\` [on/off]
┣ \`${PREFIX}anticall\` [on/off]
┗ \`${PREFIX}settings\`

📥 *DOWNLOADER*
┣ \`${PREFIX}vid\` / \`${PREFIX}song\`
┣ \`${PREFIX}yt\` / \`${PREFIX}fb\`
┗ \`${PREFIX}ig\` / \`${PREFIX}tt\`

🎨 *FUN & TOOLS*
┣ \`${PREFIX}sticker\`
┣ \`${PREFIX}joke\`
┗ \`${PREFIX}wiki\`

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
      await react(sock, msg, "🚀");
      return downloadMedia(sock, msg, url, type === "dl_video" ? "video" : "audio");
    }

    if (!rawText.startsWith(PREFIX)) return;
    const parts = rawText.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = parts.shift().toLowerCase();
    const text = parts.join(" ");

    await react(sock, msg, "🚀");

    switch (cmd) {
      case "menu":
        const menu = buildMenu(msg.pushName || "User", getRuntime(startTime));
        try {
          const buf = await urlToBuffer(MENU_IMAGE);
          await sock.sendMessage(jid, { image: buf, caption: menu }, { quoted: msg });
        } catch { await reply(sock, msg, menu); }
        break;

      case "gcstatus":
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const gMeta = await sock.groupMetadata(jid);
        reply(sock, msg, `📊 *GROUP STATUS*\n📌 *Name:* ${gMeta.subject}\n👥 *Members:* ${gMeta.participants.length}`);
        break;

      case "vv":
        reply(sock, msg, "✅ *Anti-ViewOnce Triggered!*");
        break;

      case "kick":
      case "promote":
      case "demote":
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (!target) return reply(sock, msg, `❌ *Tag someone to ${cmd}!*`);
        await sock.groupParticipantsUpdate(jid, [target], cmd === "kick" ? "remove" : cmd);
        reply(sock, msg, `✅ *Action ${cmd} completed.*`);
        break;

      case "mute":
      case "unmute":
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        await sock.groupSettingUpdate(jid, cmd === "mute" ? "announcement" : "not_announcement");
        reply(sock, msg, `✅ *Group ${cmd}d.*`);
        break;

      case "tag":
      case "tagall":
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const meta = await sock.groupMetadata(jid);
        const members = meta.participants.map(p => p.id);
        await sock.sendMessage(jid, { text: `📢 *SUMMONING EVERYONE!*\n\n${text || ""}\n\n` + members.map(m => `@${m.split("@")[0]}`).join(" "), mentions: members }, { quoted: msg });
        break;

      case "autoreact":
      case "autostatus":
      case "antibadword":
      case "antilink":
      case "antidelete":
      case "anticall":
        if (text === "on") { settings[cmd] = true; reply(sock, msg, `✅ *${cmd.toUpperCase()}* is now ON.`); }
        else if (text === "off") { settings[cmd] = false; reply(sock, msg, `❌ *${cmd.toUpperCase()}* is now OFF.`); }
        else reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} on/off`);
        break;

      case "settings":
        let sText = `⚙️ *BOT SETTINGS*\n\n`;
        for (const key in settings) sText += `${settings[key] ? "✅" : "❌"} *${key.toUpperCase()}*\n`;
        reply(sock, msg, sText);
        break;

      case "vid":
        if (!text) return reply(sock, msg, `❌ *Usage:* ${PREFIX}vid <video name>`);
        const vUrl = extractUrl(text);
        if (vUrl) await downloadMedia(sock, msg, vUrl, "video");
        else await searchYouTubeWithButtons(sock, msg, text);
        break;

      case "song":
        if (!text) return reply(sock, msg, `❌ *Usage:* ${PREFIX}song <song name>`);
        const sUrl = extractUrl(text);
        if (sUrl) await downloadMedia(sock, msg, sUrl, "audio");
        else await searchYouTubeWithButtons(sock, msg, text);
        break;

      default:
        break;
    }
  } catch (err) { console.error("Handler error:", err.message); }
}

module.exports = { handleCommand };
