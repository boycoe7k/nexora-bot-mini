const axios = require("axios");
const FormData = require("form-data");
const sharp = require("sharp");
const { OpenAI } = require("openai");
const {
  downloadContentFromMessage,
  generateWAMessageFromContent,
  proto,
} = require("@whiskeysockets/baileys");

const PREFIX = process.env.PREFIX || ".";
const BOT_NAME = "Nexora Bot Mini";
const AUTHOR = "Boycoe-dev";
const MENU_IMAGE = "https://i.ibb.co/xtLwMf12/file-00000000561c824699096bbdc5566486.png";
const OWNER = process.env.OWNER_NUMBER || "263781021754";
const KICKALL_DELAY_MS = parseInt(process.env.KICKALL_DELAY_MS || "4000", 10);

// Tracks an in-progress .kickall per group so .kill can interrupt it between
// removals. Spacing removals out (KICKALL_DELAY_MS) avoids a burst of
// group-removal actions that can get the bot's WhatsApp account flagged.
const activeKicks = new Map(); // jid -> { cancelled: boolean, removed: number, total: number }

// ── API Configs ──
// Nexa VDL API configuration. The API runs in open mode when no key is set.
const VDL_API = (
  process.env.NEXA_VDL_API_URL ||
  process.env.VDL_API_URL ||
  "https://video-download-api-l5m6.onrender.com"
).replace(/\/+$/, "");
const EDITOR_API = "https://nexaeditor.onrender.com";
const NUMBERS_API = "https://nexa-numbers.onrender.com";
const API_KEY = process.env.NEXA_VDL_API_KEY || process.env.API_KEY || "";
const REMOVEBG_KEY = process.env.REMOVEBG_KEY || "";
const UNSPLASH_KEY = process.env.UNSPLASH_KEY || "";
const IMGBB_API_KEY = process.env.IMGBB_API_KEY || "";
const IMGBB_UPLOAD_URL = "https://api.imgbb.com/1/upload";

const headers = {
  "Content-Type": "application/json",
  ...(API_KEY && API_KEY !== "Nexora_YOUR_KEY_HERE"
    ? { "x-api-key": API_KEY }
    : {}),
};

const VDL_ENDPOINTS = {
  search: `${VDL_API}/api/search`,
  startDownload: `${VDL_API}/api/media/download`,
  status: (jobId) => `${VDL_API}/api/status/${encodeURIComponent(jobId)}`,
  file: (jobId) => `${VDL_API}/api/download/${encodeURIComponent(jobId)}`,
};

// Render can briefly return gateway errors while the VDL worker is waking up or
// finishing a job. Retry only safe GET requests and keep the retry scope inside
// the downloader so unrelated bot commands retain their original behavior.
const VDL_RETRY_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const AUTOREACT_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "✨"];
let lastAutoReactIndex = -1;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextAutoReact() {
  let index = Math.floor(Math.random() * AUTOREACT_EMOJIS.length);
  if (index === lastAutoReactIndex) index = (index + 1) % AUTOREACT_EMOJIS.length;
  lastAutoReactIndex = index;
  return AUTOREACT_EMOJIS[index];
}

function getVdlGetHeaders() {
  return API_KEY && API_KEY !== "Nexora_YOUR_KEY_HERE" ? { "x-api-key": API_KEY } : {};
}

function resolveVdlUrl(candidate, fallback) {
  if (!candidate) return fallback;
  try { return new URL(candidate, `${VDL_API}/`).toString(); } catch (_) { return fallback; }
}

function backendErrorText(err) {
  const body = err?.response?.data;
  if (!body) return "";
  if (Buffer.isBuffer(body)) return body.toString("utf8").replace(/\s+/g, " ").slice(0, 240);
  if (typeof body === "string") return body.replace(/\s+/g, " ").slice(0, 240);
  if (typeof body === "object") return body.error || body.message || "";
  return "";
}

function describeVdlError(err) {
  const status = err?.response?.status;
  const detail = backendErrorText(err);
  const message = status
    ? `VDL returned HTTP ${status}${detail ? `: ${detail}` : ""}`
    : detail || err?.message || "Download failed";
  return message.replace(/https?:\/\/\S+/gi, "[link hidden]");
}

async function vdlGet(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await axios.get(url, {
        ...options,
        headers: getVdlGetHeaders(),
        timeout: options.timeout || 45000,
      });
    } catch (err) {
      lastError = err;
      const status = err?.response?.status;
      if (!VDL_RETRY_STATUS_CODES.has(status) || attempt === 2) throw err;
      await wait(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function vdlStartDownload(payload) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await axios.post(VDL_ENDPOINTS.startDownload, payload, { headers, timeout: 45000 });
    } catch (err) {
      lastError = err;
      const status = err?.response?.status;
      if (!VDL_RETRY_STATUS_CODES.has(status) || attempt === 1) throw err;
      await wait(2000);
    }
  }
  throw lastError;
}

let openai;
try {
  if (process.env.OPENAI_API_KEY) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch (e) {
  console.error("OpenAI init error:", e.message);
}

// ── Core helpers ─────────────────────────────────────────────────────────────
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

async function vdlFileToBuffer(url) {
  const res = await vdlGet(url, { responseType: "arraybuffer", timeout: 60000 });
  return Buffer.from(res.data);
}

// Every reply — text or media caption — is wrapped in this same branded
// shell so every command "looks" the same, matching the house style.
function wrapCaption(text) {
  return `*「 ${BOT_NAME} 」*\n\n${text}\n\n> _By ${AUTHOR}_`;
}

async function reply(sock, msg, text) {
  await sock.sendMessage(msg.key.remoteJid, { text: wrapCaption(text) }, { quoted: msg });
}

async function react(sock, msg, emoji) {
  try { await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }); } catch (_) {}
}

// ── Real, tappable WhatsApp buttons (native flow "quick_reply") ─────────────
// The old `buttons:` array on sendMessage is a deprecated template WhatsApp
// now falls back to rendering as plain numbered text on most devices. This
// builds an actual interactiveMessage with a nativeFlowMessage so the
// buttons show up as real tappable rows (like the "↩ Other / ↩ Self" style).
async function sendButtons(sock, jid, msg, { text, footer, buttons }) {
  const nativeButtons = buttons.map((b) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({ display_text: b.text, id: b.id }),
  }));
  try {
    const waMsg = generateWAMessageFromContent(
      jid,
      {
        viewOnceMessage: {
          message: {
            messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} },
            interactiveMessage: proto.Message.InteractiveMessage.create({
              body: proto.Message.InteractiveMessage.Body.create({ text: wrapCaption(text) }),
              footer: proto.Message.InteractiveMessage.Footer.create({ text: footer || BOT_NAME }),
              nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                buttons: nativeButtons,
              }),
            }),
          },
        },
      },
      { quoted: msg }
    );
    await sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id });
  } catch (err) {
    // Fallback for older WhatsApp/Baileys combos that can't render native
    // flow buttons — a numbered text list still works everywhere.
    const list = buttons.map((b, i) => `${i + 1}️⃣ ${b.text} → \`${b.id}\``).join("\n");
    await reply(sock, msg, `${text}\n\n${list}`);
  }
}

function getRuntime(startTime) {
  const diff = Date.now() - startTime;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff / 3600000) % 24);
  const minutes = Math.floor((diff / 60000) % 60);
  const seconds = Math.floor((diff / 1000) % 60);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function parseKV(text) {
  const params = {};
  (text || "").split(/\s+/).filter(Boolean).forEach((tok) => {
    const eq = tok.indexOf("=");
    if (eq === -1) return;
    const k = tok.slice(0, eq);
    const v = tok.slice(eq + 1);
    const num = Number(v);
    params[k] = v !== "" && !Number.isNaN(num) ? num : v;
  });
  return params;
}

async function getQuotedOrDirectMedia(msg, kind) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const target = quoted?.[`${kind}Message`] || msg.message?.[`${kind}Message`];
  if (!target) return null;
  const stream = await downloadContentFromMessage(target, kind);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer;
}

// Sender must be a group admin (or the bot owner) to run moderation commands.
async function requireGroupAdmin(sock, msg, jid) {
  const meta = await sock.groupMetadata(jid);
  const senderId = msg.key.participant || msg.key.remoteJid;
  const senderNum = senderId?.split("@")[0];
  if (senderNum === OWNER || msg.key.fromMe) return { ok: true, meta };
  const isAdmin = meta.participants.find((p) => p.id === senderId)?.admin;
  if (!isAdmin) return { ok: false, meta, error: "❌ *Admins only!*" };
  const botIsAdmin = meta.participants.find((p) => p.id === sock.user?.id?.split(":")[0] + "@s.whatsapp.net" || p.id === sock.user?.id)?.admin;
  if (!botIsAdmin) return { ok: false, meta, error: "❌ *I need to be a group admin to do that.*" };
  return { ok: true, meta };
}

// ── Darkroom (Nexa Editor) image/video pipeline ──────────────────────────────
async function callImageEditor(imageBuffer, operations, format = "jpeg") {
  const form = new FormData();
  form.append("image", imageBuffer, "input.jpg");
  form.append("operations", JSON.stringify(operations));
  form.append("format", format);
  const res = await axios.post(`${EDITOR_API}/api/edit`, form, {
    headers: form.getHeaders(),
    responseType: "arraybuffer",
    timeout: 60000,
  });
  return Buffer.from(res.data);
}

async function callVideoEditor(videoBuffer, operations, format = "mp4") {
  const form = new FormData();
  form.append("video", videoBuffer, "input.mp4");
  form.append("operations", JSON.stringify(operations));
  form.append("format", format);
  const res = await axios.post(`${EDITOR_API}/api/video/edit`, form, {
    headers: form.getHeaders(),
    responseType: "arraybuffer",
    timeout: 180000,
  });
  return Buffer.from(res.data);
}

async function runImageOp(sock, msg, op, params = {}, { caption } = {}) {
  const buf = await getQuotedOrDirectMedia(msg, "image");
  if (!buf) return reply(sock, msg, `❌ *Reply to (or send with caption) an image with* \`${PREFIX}${op}\``);
  try {
    const out = await callImageEditor(buf, [{ op, ...params }], "jpeg");
    await sock.sendMessage(msg.key.remoteJid, { image: out, caption: wrapCaption(caption || `✅ *${op}* applied.`) }, { quoted: msg });
  } catch (err) {
    const detail = err.response?.data ? Buffer.from(err.response.data).toString().slice(0, 200) : err.message;
    await reply(sock, msg, `❌ *Edit failed:* ${detail}\n\nIf this is a parameter error, try:\n\`${PREFIX}imgedit ${op} key=value\``);
  }
}

async function runVideoOp(sock, msg, op, params = {}, format = "mp4") {
  const buf = await getQuotedOrDirectMedia(msg, "video");
  if (!buf) return reply(sock, msg, `❌ *Reply to (or send with caption) a video with* \`${PREFIX}${op}\``);
  try {
    await reply(sock, msg, `⏳ *Processing video (${op})...* this can take a moment.`);
    const out = await callVideoEditor(buf, [{ op, ...params }], format);
    await sock.sendMessage(msg.key.remoteJid, { video: out, mimetype: "video/mp4", caption: wrapCaption(`✅ *${op}* applied.`) }, { quoted: msg });
  } catch (err) {
    const detail = err.response?.data ? Buffer.from(err.response.data).toString().slice(0, 200) : err.message;
    await reply(sock, msg, `❌ *Video edit failed:* ${detail}\n\nIf this is a parameter error, try:\n\`${PREFIX}videdit ${op} key=value\``);
  }
}

// ── Nexa VDL (video/audio downloader) ────────────────────────────────────────
async function downloadMedia(sock, msg, url, type = "video") {
  const jid = msg.key.remoteJid;
  await reply(sock, msg, `⏳ *Nexora is processing your request...*\n🛠️ *Type:* ${type.toUpperCase()}`);
  try {
    const dlRes = await vdlStartDownload({ url, type, quality: "720p" });
    if (!dlRes.data.success) throw new Error(dlRes.data.error || "Download request failed");
    const jobId = dlRes.data.jobId;
    const statusUrl = resolveVdlUrl(dlRes.data.statusUrl, VDL_ENDPOINTS.status(jobId));
    let attempts = 0;
    let statusData = null;
    while (attempts < 60) {
      attempts++;
      await wait(3000);
      const statusRes = await vdlGet(statusUrl);
      statusData = statusRes.data;
      if (statusData.success === false) throw new Error(statusData.error || "Status lookup failed");
      if (statusData.status === "completed") break;
      if (statusData.status === "failed") throw new Error(statusData.error || "Job failed");
    }
    if (!statusData || statusData.status !== "completed") throw new Error("Download timed out");
    const fileUrl = resolveVdlUrl(statusData.downloadUrl, VDL_ENDPOINTS.file(jobId));
    const buffer = await vdlFileToBuffer(fileUrl);
    if (type === "audio") await sock.sendMessage(jid, { audio: buffer, mimetype: "audio/mpeg" }, { quoted: msg });
    else await sock.sendMessage(jid, { video: buffer, mimetype: "video/mp4", caption: wrapCaption(`✅ *Download Complete*`) }, { quoted: msg });
    await react(sock, msg, "✅");
  } catch (err) {
    await reply(sock, msg, `❌ *Error:* ${describeVdlError(err)}`);
    await react(sock, msg, "❌");
  }
}

async function youtubeSearch(sock, msg, query, autoDownloadType = null) {
  const jid = msg.key.remoteJid;
  await reply(sock, msg, `🔎 *Searching for:* ${query}...`);
  try {
    const res = await axios.get(VDL_ENDPOINTS.search, {
      params: { q: query },
      headers,
      timeout: 30000,
    });
    const results = res.data.results || [];
    if (results.length === 0) return reply(sock, msg, "❌ No results found.");
    const first = results[0];
    const info = `🎬 *YouTube Search Results*

📌 *Title:* ${first.title}
⏱️ *Duration:* ${first.duration}`;
    try {
      const buf = await urlToBuffer(first.thumbnail);
      await sock.sendMessage(jid, { image: buf, caption: wrapCaption(info) }, { quoted: msg });
    } catch (_) {
      await reply(sock, msg, info);
    }
    // Real tappable buttons (not fallback text) for picking audio or video.
    await sendButtons(sock, jid, msg, {
      text: autoDownloadType
        ? `*${first.title}*\n⏬ Downloading the first result as ${autoDownloadType}...`
        : `*${first.title}*\nChoose a download format below 👇`,
      footer: BOT_NAME,
      buttons: [
        { text: "🎵 Audio", id: `${PREFIX}song ${first.url}` },
        { text: "🎥 Video", id: `${PREFIX}video ${first.url}` },
      ],
    });
    if (autoDownloadType) {
      await downloadMedia(sock, msg, first.url, autoDownloadType);
    }
  } catch (err) {
    reply(sock, msg, "❌ Error fetching search results.");
  }
}

// ── AI Providers ───────────────────────────────────────────────────────────────
// Keys are read only from deployment environment variables. Never hard-code them.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const AI_PROVIDER = (process.env.AI_PROVIDER || "auto").toLowerCase();
const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY || "";
const POLLINATIONS_MODEL = process.env.POLLINATIONS_MODEL || "flux";

async function askGemini(prompt, { system } = {}) {
  if (!GEMINI_API_KEY) throw new Error("Gemini is not configured. Set GEMINI_API_KEY in the deployment environment.");
  const response = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    },
    { headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY }, timeout: 60000 }
  );
  const text = response.data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw new Error("Gemini returned no text.");
  return text;
}

async function askDeepSeek(prompt, { system } = {}) {
  if (!DEEPSEEK_API_KEY) throw new Error("DeepSeek is not configured. Set DEEPSEEK_API_KEY in the deployment environment.");
  const messages = system
    ? [{ role: "system", content: system }, { role: "user", content: prompt }]
    : [{ role: "user", content: prompt }];
  const response = await axios.post(
    "https://api.deepseek.com/chat/completions",
    {
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      messages,
      thinking: { type: "enabled" },
      reasoning_effort: process.env.DEEPSEEK_REASONING_EFFORT || "high",
      stream: false,
    },
    { headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_API_KEY}` }, timeout: 90000 }
  );
  const text = response.data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("DeepSeek returned no text.");
  return text;
}

async function askOpenAI(prompt, { system } = {}) {
  if (!openai) throw new Error("OpenAI is not configured. Set OPENAI_API_KEY in the deployment environment.");
  const messages = system ? [{ role: "system", content: system }, { role: "user", content: prompt }] : [{ role: "user", content: prompt }];
  const response = await openai.chat.completions.create({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", messages });
  const text = response.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI returned no text.");
  return text;
}

async function askTextAI(prompt, options = {}, preferredProvider = AI_PROVIDER) {
  const providers = preferredProvider === "auto"
    ? ["openai", "gemini", "deepseek"]
    : [preferredProvider];
  let lastError = null;
  for (const provider of providers) {
    const configured = provider === "openai" ? Boolean(openai) : provider === "gemini" ? Boolean(GEMINI_API_KEY) : provider === "deepseek" ? Boolean(DEEPSEEK_API_KEY) : false;
    if (!configured) continue;
    try {
      if (provider === "gemini") return await askGemini(prompt, options);
      if (provider === "deepseek") return await askDeepSeek(prompt, options);
      return await askOpenAI(prompt, options);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("No AI provider is configured. Set OPENAI_API_KEY, GEMINI_API_KEY, or DEEPSEEK_API_KEY.");
}

async function handleImageGeneration(sock, msg, prompt) {
  if (!POLLINATIONS_API_KEY) return reply(sock, msg, "❌ *Image generation unavailable:* set `POLLINATIONS_API_KEY` in the deployment environment.");
  try {
    const imageUrl = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=${encodeURIComponent(POLLINATIONS_MODEL)}`;
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${POLLINATIONS_API_KEY}` },
      timeout: 120000,
    });
    await sock.sendMessage(msg.key.remoteJid, { image: Buffer.from(response.data), caption: wrapCaption(`🖼️ *Generated image*\n\nPrompt: ${prompt}`) }, { quoted: msg });
  } catch (err) {
    await reply(sock, msg, `❌ *Image generation failed:* ${err.response?.data?.error || err.message}`);
  }
}

async function handleAI(sock, msg, prompt, mode = "ai", provider = AI_PROVIDER) {
  const systemPrompts = {
    summarize: "Summarize the following text clearly and concisely, in your own words.",
    rewrite: "Rewrite the following text to be clearer and better written, preserving its meaning.",
    explain: "Explain the following in simple, easy-to-understand terms.",
  };
  try {
    const text = await askTextAI(prompt, { system: systemPrompts[mode] }, provider);
    if (text) await reply(sock, msg, `🤖 *Nexora AI:*\n\n${text}`);
  } catch (err) {
    await reply(sock, msg, `❌ ${err.message}`);
  }
}

async function handleTranslate(sock, msg, targetLang, text) {
  try {
    const out = await askTextAI(text, {
      system: `Translate the user's message into ${targetLang}. Reply with only the translation, nothing else.`,
    });
    if (out) await reply(sock, msg, `🌐 *Translated (${targetLang}):*\n\n${out}`);
  } catch (err) {
    await reply(sock, msg, `❌ ${err.message}`);
  }
}

async function handleDetectLang(sock, msg, text) {
  try {
    const out = await askTextAI(text, {
      system: "Identify the language of the user's message. Reply with only the language name, nothing else.",
    });
    if (out) await reply(sock, msg, `🌐 *Detected language:* ${out}`);
  } catch (err) {
    await reply(sock, msg, `❌ ${err.message}`);
  }
}

async function handleTTS(sock, msg, text) {
  if (!openai) return reply(sock, msg, "❌ *TTS unavailable:* set `OPENAI_API_KEY` in your env.");
  try {
    const res = await openai.audio.speech.create({ model: "tts-1", voice: "alloy", input: text.slice(0, 800) });
    const buf = Buffer.from(await res.arrayBuffer());
    await sock.sendMessage(msg.key.remoteJid, { audio: buf, mimetype: "audio/mpeg", ptt: true }, { quoted: msg });
  } catch (err) {
    await reply(sock, msg, "❌ *TTS failed.* Try shorter text.");
  }
}

async function handleTranscribe(sock, msg, { translateTo } = {}) {
  if (!openai) return reply(sock, msg, "❌ *Transcription unavailable:* set `OPENAI_API_KEY` in your env.");
  const buf = await getQuotedOrDirectMedia(msg, "audio");
  if (!buf) return reply(sock, msg, `❌ *Reply to a voice note with* \`${PREFIX}stt\``);
  try {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tmpFile = path.join(os.tmpdir(), `nexora-audio-${Date.now()}.ogg`);
    fs.writeFileSync(tmpFile, buf);
    const transcript = await openai.audio.transcriptions.create({ file: fs.createReadStream(tmpFile), model: "whisper-1" });
    fs.unlinkSync(tmpFile);
    if (translateTo) {
      const translated = await askTextAI(transcript.text, { system: `Translate this into ${translateTo}. Reply with only the translation.` });
      return reply(sock, msg, `🎙️ *Transcript:*\n${transcript.text}\n\n🌐 *Translated (${translateTo}):*\n${translated}`);
    }
    await reply(sock, msg, `🎙️ *Transcript:*\n\n${transcript.text}`);
  } catch (err) {
    await reply(sock, msg, "❌ *Transcription failed.*");
  }
}

function buildMenu(pushName, runtime) {
  return `╭━〔${BOT_NAME}〕━⬣
┃ [] STATUS  : ONLINE
┃ [] RUNTIME : ${runtime}
┃ [] USER    : ${pushName}
┃ [] DEV     : ${AUTHOR}
┃ [] SITE    : nexora.zone.id
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 📥 DOWNLOADS 〕━━⬣
┃➤ ${PREFIX}yt
┃➤ ${PREFIX}play <query>
┃➤ ${PREFIX}song 
┃➤ ${PREFIX}video 
┃➤ ${PREFIX}tt
┃➤ ${PREFIX}ig
┃➤ ${PREFIX}fb 
┃➤ ${PREFIX}wallpaper
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🔎 SEARCH 〕━━⬣
┃➤ ${PREFIX}google
┃➤ ${PREFIX}bing 
┃➤ ${PREFIX}duckduckgo 
┃➤ ${PREFIX}yahoo 
┃➤ ${PREFIX}brave
┃➤ ${PREFIX}wiki
┃➤ ${PREFIX}define
┃➤ ${PREFIX}weather
┃➤ ${PREFIX}maps
┃➤ ${PREFIX}news
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🖼️ IMAGE EDITOR 〕━━⬣
┃➤ ${PREFIX}crop
┃➤ ${PREFIX}resize
┃➤ ${PREFIX}rotate
┃➤ ${PREFIX}flip
┃➤ ${PREFIX}filter
┃➤ ${PREFIX}adjust
┃➤ ${PREFIX}text
┃➤ ${PREFIX}watermark
┃➤ ${PREFIX}imgedit
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🎬 VIDEO EDITOR 〕━━⬣
┃➤ ${PREFIX}trim
┃➤ ${PREFIX}speed
┃➤ ${PREFIX}vidfilter
┃➤ ${PREFIX}mute 
┃➤ ${PREFIX}volume
┃➤ ${PREFIX}videdit
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🎨 MEDIA TOOLS 〕━━⬣
┃➤ ${PREFIX}sticker
┃➤ ${PREFIX}toimg
┃➤ ${PREFIX}compress
┃➤ ${PREFIX}enhance
┃➤ ${PREFIX}blur
┃➤ ${PREFIX}removebg
┃➤ ${PREFIX}tourl
╰━━━━━━━━━━━━━━━━━━━━⬣

  ╭━━〔 🎙️ VOICE & AI 〕━━⬣
  ┃➤ ${PREFIX}tts
  ┃➤ ${PREFIX}stt
  ┃➤ ${PREFIX}vtr
  ┃➤ ${PREFIX}tr
  ┃➤ ${PREFIX}detect
  ┃➤ ${PREFIX}ai 
  ┃➤ ${PREFIX}gpt /
  ┃➤ ${PREFIX}ask
  ┃➤ ${PREFIX}gemini /
  ┃➤ ${PREFIX}deepseek
  ┃➤ ${PREFIX}summarize 
  ┃➤ ${PREFIX}rewrite /
  ┃➤  ${PREFIX}explain
  ┃➤ ${PREFIX}image <prompt>
  ┃➤ ${PREFIX}suno (official API pending)
  ╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 👑 GROUP MANAGER 〕━━⬣ (admins only)
┃➤ ${PREFIX}gcstatus 
┃➤ ${PREFIX}groupinfo
┃➤ ${PREFIX}kick 
┃➤ ${PREFIX}promote 
┃➤ ${PREFIX}demote
┃➤ ${PREFIX}add
┃➤ ${PREFIX}mute 
┃➤ ${PREFIX}unmute
┃➤ ${PREFIX}link 
┃➤ ${PREFIX}revoke
┃➤ ${PREFIX}tag
┃➤ ${PREFIX}tagall
┃➤ ${PREFIX}kickall
┃➤ ${PREFIX}kill
┃➤ ${PREFIX}vv
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 ⚙️ SETTINGS 〕━━⬣
┃➤ ${PREFIX}welcome on/off
┃➤ ${PREFIX}goodbye on/off
┃➤ ${PREFIX}autoreact 
┃➤ ${PREFIX}autostatus 
┃➤ ${PREFIX}antibadword 
┃➤ ${PREFIX}antilink
┃➤ ${PREFIX}antidelete 
┃➤ ${PREFIX}anticall
┃➤ ${PREFIX}settings
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🔐 TEMP NUMBERS 〕━━⬣
┃➤ ${PREFIX}countries
┃➤ ${PREFIX}numbers
┃➤ ${PREFIX}otp
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 🛠 TOOLS 〕━━⬣
┃➤ ${PREFIX}calc
┃➤ ${PREFIX}flip 
┃➤ ${PREFIX}roll 
┃➤ ${PREFIX}8ball
┃➤ ${PREFIX}joke
┃➤ ${PREFIX}quote 
┃➤ ${PREFIX}fact
┃➤ ${PREFIX}reverse 
┃➤ ${PREFIX}upper 
┃➤ ${PREFIX}lower
┃➤ ${PREFIX}id 
┃➤ ${PREFIX}whoami
┃➤ ${PREFIX}ping 
┃➤ ${PREFIX}alive 
┃➤ ${PREFIX}uptime
╰━━━━━━━━━━━━━━━━━━━━⬣

╭━━〔 👑 OWNER 〕━━⬣
┃➤ ${PREFIX}owner
┃➤ ${PREFIX}broadcast
┃➤ ${PREFIX}restart
┃➤ ${PREFIX}block 
┃➤ ${PREFIX}unblock
╰━━━━━━━━━━━━━━━━━━━━⬣

_"${BOT_NAME} By ${AUTHOR}"_`;
}

// ── Main Handler ──────────────────────────────────────────────────────────────
async function handleCommand(sock, msg, { startTime, settings }) {
  try {
    const jid = msg.key.remoteJid;
    const rawText = getMessageText(msg).trim();
    const isGroup = jid.endsWith("@g.us");

    if (settings.autoreact && !msg.key.fromMe && jid !== "status@broadcast") {
      await react(sock, msg, nextAutoReact());
    }

    if (!rawText.startsWith(PREFIX)) {
      if (rawText.includes("https://www.youtube.com/watch?v=")) {
        const url = rawText.match(/https?:\/\/\S+/i)?.[0];
        if (rawText.includes(`${PREFIX}song`)) return downloadMedia(sock, msg, url, "audio");
        if (rawText.includes(`${PREFIX}video`)) return downloadMedia(sock, msg, url, "video");
      }
      return;
    }

    const parts = rawText.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = parts.shift().toLowerCase();
    const text = parts.join(" ");

    switch (cmd) {
      // ── Menu ──
      case "menu":
      case "help": {
        const menu = buildMenu(msg.pushName || "User", getRuntime(startTime));
        try {
          const buf = await urlToBuffer(MENU_IMAGE);
          await sock.sendMessage(jid, { image: buf, caption: menu }, { quoted: msg });
        } catch { await reply(sock, msg, menu); }
        break;
      }

      // ── AI ──
      case "ai":
      case "gpt":
      case "ask":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <query>`);
        await handleAI(sock, msg, text, "ai");
        break;
      case "gemini":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}gemini <query>`);
        await handleAI(sock, msg, text, "ai", "gemini");
        break;
      case "deepseek":
      case "deep":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <query>`);
        await handleAI(sock, msg, text, "ai", "deepseek");
        break;
      case "image":
      case "imagine":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <prompt>`);
        await handleImageGeneration(sock, msg, text);
        break;
      case "summarize":
      case "rewrite":
      case "explain":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <text>`);
        await handleAI(sock, msg, text, cmd);
        break;
      case "suno":
        return reply(sock, msg, "❌ *Suno integration is not enabled:* Suno does not currently provide a public self-serve API. Use Suno's official website, or provide an approved provider's official API documentation before connecting it.");

      // ── Translate / voice ──
      case "tr":
      case "translate": {
        const [lang, ...rest] = parts;
        if (!lang || rest.length === 0) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <lang> <text>`);
        await handleTranslate(sock, msg, lang, rest.join(" "));
        break;
      }
      case "detect":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}detect <text>`);
        await handleDetectLang(sock, msg, text);
        break;
      case "tts":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}tts <text>`);
        await handleTTS(sock, msg, text);
        break;
      case "stt":
      case "transcribe":
        await handleTranscribe(sock, msg);
        break;
      case "vtr":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}vtr <lang> (reply to a voice note)`);
        await handleTranscribe(sock, msg, { translateTo: text });
        break;

      // ── Search ──
      case "google":
      case "bing":
      case "duckduckgo":
      case "yahoo":
      case "brave":
      case "search": {
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <query>`);
        const engines = {
          google: `https://www.google.com/search?q=${encodeURIComponent(text)}`,
          search: `https://www.google.com/search?q=${encodeURIComponent(text)}`,
          bing: `https://www.bing.com/search?q=${encodeURIComponent(text)}`,
          duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(text)}`,
          yahoo: `https://search.yahoo.com/search?p=${encodeURIComponent(text)}`,
          brave: `https://search.brave.com/search?q=${encodeURIComponent(text)}`,
        };
        reply(sock, msg, `🔎 *${cmd.toUpperCase()} search:* ${text}\n${engines[cmd]}`);
        break;
      }
      case "wiki":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}wiki <topic>`);
        try {
          const res = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text)}`, { timeout: 10000 });
          reply(sock, msg, `📖 *${res.data.title}*\n\n${res.data.extract || "No summary available."}`);
        } catch { reply(sock, msg, `❌ *No Wikipedia article found for:* ${text}`); }
        break;
      case "define":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}define <word>`);
        try {
          const res = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`, { timeout: 10000 });
          const entry = res.data[0];
          const def = entry.meanings[0]?.definitions[0]?.definition || "No definition found.";
          reply(sock, msg, `📚 *${entry.word}* (${entry.meanings[0]?.partOfSpeech || ""})\n\n${def}`);
        } catch { reply(sock, msg, `❌ *No definition found for:* ${text}`); }
        break;
      case "weather":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}weather <city>`);
        try {
          const res = await axios.get(`https://wttr.in/${encodeURIComponent(text)}?format=3`, { timeout: 10000 });
          reply(sock, msg, `🌤️ ${res.data}`);
        } catch { reply(sock, msg, `❌ *Couldn't fetch weather for:* ${text}`); }
        break;
      case "maps":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}maps <place>`);
        reply(sock, msg, `🗺️ *Map for:* ${text}\nhttps://www.google.com/maps/search/${encodeURIComponent(text)}`);
        break;
      case "news":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}news <query>`);
        reply(sock, msg, `📰 *News for:* ${text}\nhttps://news.google.com/search?q=${encodeURIComponent(text)}`);
        break;

      // ── Downloads ──
      case "yt":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}yt <url or search query>`);
        if (/^https?:\/\//i.test(text)) {
          await downloadMedia(sock, msg, text, "video");
        } else {
          await youtubeSearch(sock, msg, text);
        }
        break;
      case "play":
      case "song":
      case "mp3":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <query|url>`);
        if (text.startsWith("http")) await downloadMedia(sock, msg, text, "audio");
        else await youtubeSearch(sock, msg, text, "audio");
        break;
      case "video":
      case "mp4":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <query|url>`);
        if (text.startsWith("http")) await downloadMedia(sock, msg, text, "video");
        else await youtubeSearch(sock, msg, text, "video");
        break;
      case "tt":
      case "tiktok":
      case "ig":
      case "instagram":
      case "igstory":
      case "fb":
      case "facebook":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <url>`);
        if (!/^https?:\/\//i.test(text)) {
          return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <url>`);
        }
        await downloadMedia(sock, msg, text, "video");
        break;
      case "wallpaper":
      case "wallpaper4k":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} <query>`);
        if (!UNSPLASH_KEY) {
          reply(sock, msg, `🖼️ *Wallpaper search:* ${text}\nhttps://unsplash.com/s/photos/${encodeURIComponent(text)}\n\n_Set UNSPLASH_KEY to have images sent directly._`);
        } else {
          try {
            const res = await axios.get(`https://api.unsplash.com/photos/random?query=${encodeURIComponent(text)}&client_id=${UNSPLASH_KEY}`);
            const buf = await urlToBuffer(res.data.urls.full);
            await sock.sendMessage(jid, { image: buf, caption: wrapCaption(`🖼️ *${text}*`) }, { quoted: msg });
          } catch { reply(sock, msg, `❌ *Couldn't fetch a wallpaper for:* ${text}`); }
        }
        break;

      // ── Image editor ──
      case "crop":
        await runImageOp(sock, msg, "crop", parseKV(text));
        break;
      case "resize":
        await runImageOp(sock, msg, "resize", parseKV(text));
        break;
      case "rotate":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}rotate <angle> (reply to an image)`);
        await runImageOp(sock, msg, "rotate", { angle: Number(text) || 0 });
        break;
      case "flip":
        await runImageOp(sock, msg, "flip", { direction: text === "v" ? "vertical" : "horizontal" });
        break;
      case "filter": {
        const filterOps = ["grayscale", "sepia", "invert", "vignette", "pixelate", "mosaic", "posterize", "edgeDetect", "emboss", "noiseReduction"];
        const [fname, ...fargs] = parts;
        if (!filterOps.includes(fname)) return reply(sock, msg, `❓ *Usage:* ${PREFIX}filter <${filterOps.join("|")}>`);
        await runImageOp(sock, msg, fname, parseKV(fargs.join(" ")));
        break;
      }
      case "adjust": {
        const adjustOps = ["brightness", "contrast", "saturation", "hue", "exposure", "sharpen", "blur", "temperature", "tint", "opacity"];
        const [aname, aval] = parts;
        if (!adjustOps.includes(aname)) return reply(sock, msg, `❓ *Usage:* ${PREFIX}adjust <${adjustOps.join("|")}> <value>`);
        await runImageOp(sock, msg, aname, { value: Number(aval) || 0 });
        break;
      }
      case "blur":
        await runImageOp(sock, msg, "blur", { value: Number(text) || 5 });
        break;
      case "text":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}text <words> (reply to an image)`);
        await runImageOp(sock, msg, "text", { text, x: 20, y: 40, fontSize: 32, color: "#ffffff" });
        break;
      case "watermark":
        if (!text || !text.startsWith("http")) return reply(sock, msg, `❓ *Usage:* ${PREFIX}watermark <image url> (reply to base image)`);
        await runImageOp(sock, msg, "watermark", { imageUrl: text });
        break;
      case "imgedit": {
        const [opName, ...opArgs] = parts;
        if (!opName) return reply(sock, msg, `❓ *Usage:* ${PREFIX}imgedit <op> key=value... (reply to an image)\nOps: crop, rotate, straighten, flip, resize, brightness, saturation, hue, contrast, exposure, sharpen, blur, grayscale, sepia, invert, temperature, tint, opacity, pixelate, mosaic, posterize, edgeDetect, emboss, noiseReduction, vignette, text, rectangle, circle, line, arrow, watermark`);
        await runImageOp(sock, msg, opName, parseKV(opArgs.join(" ")));
        break;
      }

      // ── Media tools ──
      case "sticker":
      case "s": {
        const buf = await getQuotedOrDirectMedia(msg, "image");
        if (!buf) return reply(sock, msg, `❌ *Reply to an image with* \`${PREFIX}sticker\``);
        try {
          const webp = await sharp(buf).resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer();
          await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
        } catch (err) { reply(sock, msg, `❌ *Sticker failed:* ${err.message}`); }
        break;
      }
      case "toimg": {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const stickerMsg = quoted?.stickerMessage;
        if (!stickerMsg) return reply(sock, msg, `❌ *Reply to a sticker with* \`${PREFIX}toimg\``);
        try {
          const stream = await downloadContentFromMessage(stickerMsg, "sticker");
          let buffer = Buffer.from([]);
          for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
          const png = await sharp(buffer).png().toBuffer();
          await sock.sendMessage(jid, { image: png }, { quoted: msg });
        } catch (err) { reply(sock, msg, `❌ *Conversion failed:* ${err.message}`); }
        break;
      }
      case "compress":
        await runImageOp(sock, msg, "resize", { width: 800 }, {});
        break;
      case "enhance":
        await runImageOp(sock, msg, "sharpen", { value: 40 });
        break;
      case "removebg": {
        if (!REMOVEBG_KEY) return reply(sock, msg, "❌ *Not configured:* set `REMOVEBG_KEY` in your env (get one free at remove.bg) to enable this.");
        const buf = await getQuotedOrDirectMedia(msg, "image");
        if (!buf) return reply(sock, msg, `❌ *Reply to an image with* \`${PREFIX}removebg\``);
        try {
          const form = new FormData();
          form.append("image_file", buf, "input.jpg");
          form.append("size", "auto");
          const res = await axios.post("https://api.remove.bg/v1.0/removebg", form, {
            headers: { ...form.getHeaders(), "X-Api-Key": REMOVEBG_KEY },
            responseType: "arraybuffer",
          });
          await sock.sendMessage(jid, { image: Buffer.from(res.data) }, { quoted: msg });
        } catch (err) { reply(sock, msg, "❌ *Background removal failed.*"); }
        break;
      }

      // ── Video editor ──
      case "trim": {
        const [start, end] = parts;
        if (start === undefined || end === undefined) return reply(sock, msg, `❓ *Usage:* ${PREFIX}trim <start_sec> <end_sec> (reply to a video)`);
        await runVideoOp(sock, msg, "trim", { start: Number(start), end: Number(end) });
        break;
      }
      case "speed":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}speed <factor e.g. 1.5> (reply to a video)`);
        await runVideoOp(sock, msg, "speed", { factor: Number(text) });
        break;
      case "vidfilter": {
        const vFilterOps = ["grayscale", "sepia", "invert", "blur", "sharpen", "vignette"];
        if (!vFilterOps.includes(text)) return reply(sock, msg, `❓ *Usage:* ${PREFIX}vidfilter <${vFilterOps.join("|")}> (reply to a video)`);
        await runVideoOp(sock, msg, text);
        break;
      }
      case "mute":
        if (isGroup && !text) {
          const check = await requireGroupAdmin(sock, msg, jid);
          if (!check.ok) return reply(sock, msg, check.error);
          await sock.groupSettingUpdate(jid, "announcement");
          return reply(sock, msg, "🔇 *Group muted* — only admins can send messages.");
        }
        await runVideoOp(sock, msg, "mute");
        break;
      case "unmute":
        if (isGroup) {
          const check = await requireGroupAdmin(sock, msg, jid);
          if (!check.ok) return reply(sock, msg, check.error);
          await sock.groupSettingUpdate(jid, "not_announcement");
          return reply(sock, msg, "🔊 *Group unmuted* — everyone can send messages.");
        }
        break;
      case "volume":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}volume <level e.g. 2.0> (reply to a video)`);
        await runVideoOp(sock, msg, "volume", { level: Number(text) });
        break;
      case "videdit": {
        const [vOpName, ...vOpArgs] = parts;
        if (!vOpName) return reply(sock, msg, `❓ *Usage:* ${PREFIX}videdit <op> key=value... (reply to a video)\nOps: trim, crop, resize, rotate, flip, speed, brightness, contrast, saturation, hue, grayscale, sepia, invert, blur, sharpen, vignette, volume, mute, fadeIn, fadeOut, text, watermark, audioReplace, audioMix`);
        await runVideoOp(sock, msg, vOpName, parseKV(vOpArgs.join(" ")));
        break;
      }

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
          nums.slice(0, 10).forEach((n) => (nText += `• ${n.phoneNumber}\n`));
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
          sms.slice(0, 5).forEach((m) => (sText += `From: ${m.from}\nMsg: ${m.text}\nTime: ${m.time}\n\n`));
          reply(sock, msg, sText);
        } catch { reply(sock, msg, "❌ Error fetching OTP."); }
        break;

      // ── Group manager ──
      case "kick":
      case "promote":
      case "demote": {
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const check = await requireGroupAdmin(sock, msg, jid);
        if (!check.ok) return reply(sock, msg, check.error);
        const users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (users.length === 0) return reply(sock, msg, `❌ *Mention the user(s) to ${cmd}!*`);
        await sock.groupParticipantsUpdate(jid, users, cmd === "kick" ? "remove" : cmd);
        reply(sock, msg, `✅ *${cmd} completed for ${users.length} user(s).*`);
        break;
      }
      case "add": {
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const check = await requireGroupAdmin(sock, msg, jid);
        if (!check.ok) return reply(sock, msg, check.error);
        const num = text.replace(/[^0-9]/g, "");
        if (!num) return reply(sock, msg, `❓ *Usage:* ${PREFIX}add <phone number with country code>`);
        await sock.groupParticipantsUpdate(jid, [`${num}@s.whatsapp.net`], "add");
        reply(sock, msg, `✅ *Added* ${num}.`);
        break;
      }
      case "kickall": {
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const check = await requireGroupAdmin(sock, msg, jid);
        if (!check.ok) return reply(sock, msg, check.error);

        const botNum = sock.user?.id?.split(":")[0];
        const targets = check.meta.participants.filter(
          (p) => !p.admin && p.id.split("@")[0] !== botNum && p.id.split("@")[0] !== OWNER
        );

        if (targets.length === 0) return reply(sock, msg, "✅ *Nothing to do* — no removable (non-admin) members.");

        if (text.trim().toLowerCase() !== "confirm") {
          return reply(
            sock, msg,
            `⚠️ *This will remove ${targets.length} member(s) from the group*, one every ${KICKALL_DELAY_MS / 1000}s (admins, the bot, and the owner are skipped).\n\n` +
            `Run \`${PREFIX}kickall confirm\` to proceed.\n` +
            `Run \`${PREFIX}kill\` at any time to stop it mid-way.`
          );
        }

        if (activeKicks.has(jid)) return reply(sock, msg, `⚠️ *A kick process is already running in this group.* Use \`${PREFIX}kill\` to stop it first.`);

        const state = { cancelled: false, removed: 0, total: targets.length };
        activeKicks.set(jid, state);
        await reply(sock, msg, `🚀 *Starting removal of ${targets.length} member(s)...* Use \`${PREFIX}kill\` to stop.`);

        for (const p of targets) {
          if (state.cancelled) break;
          try {
            await sock.groupParticipantsUpdate(jid, [p.id], "remove");
            state.removed++;
          } catch (err) {
            console.error(`kickall: failed to remove ${p.id}:`, err.message);
          }
          if (state.cancelled) break;
          await new Promise((r) => setTimeout(r, KICKALL_DELAY_MS));
        }

        activeKicks.delete(jid);
        reply(sock, msg, state.cancelled
          ? `🛑 *Stopped.* Removed ${state.removed}/${state.total} before being killed.`
          : `✅ *Done.* Removed ${state.removed}/${state.total} member(s).`);
        break;
      }
      case "kill": {
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const check = await requireGroupAdmin(sock, msg, jid);
        if (!check.ok) return reply(sock, msg, check.error);
        const state = activeKicks.get(jid);
        if (!state) return reply(sock, msg, "ℹ️ *No kick process is running in this group.*");
        state.cancelled = true;
        reply(sock, msg, "🛑 *Stopping after the current removal...*");
        break;
      }
      case "link": {
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const check = await requireGroupAdmin(sock, msg, jid);
        if (!check.ok) return reply(sock, msg, check.error);
        const code = await sock.groupInviteCode(jid);
        reply(sock, msg, `🔗 *Group Link:* https://chat.whatsapp.com/${code}`);
        break;
      }
      case "revoke": {
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const check = await requireGroupAdmin(sock, msg, jid);
        if (!check.ok) return reply(sock, msg, check.error);
        await sock.groupRevokeInvite(jid);
        reply(sock, msg, "✅ *Group link revoked.*");
        break;
      }
      case "groupinfo":
      case "gcstatus": {
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const meta = await sock.groupMetadata(jid);
        reply(sock, msg, `📊 *GROUP INFO*\n📌 *Name:* ${meta.subject}\n👥 *Members:* ${meta.participants.length}\n📢 *Announce-only:* ${meta.announce ? "Yes" : "No"}\n🔒 *Locked settings:* ${meta.restrict ? "Yes" : "No"}\n📝 *Description:* ${meta.desc || "None"}\n🆔 *ID:* ${meta.id}`);
        break;
      }
      case "tag": {
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const tagMeta = await sock.groupMetadata(jid);
        const tagIds = tagMeta.participants.map((p) => p.id).filter(Boolean);
        const tagLines = tagIds.map((participantId) => `@${participantId.split("@")[0]}`).join("\n");
        const tagText = text ? `${text}\n\n${tagLines}` : `📢 *SUMMONING EVERYONE!*\n\n${tagLines}`;
        await sock.sendMessage(jid, { text: tagText, mentions: tagIds }, { quoted: msg });
        break;
      }
      case "tagall": {
        if (!isGroup) return reply(sock, msg, "❌ *Groups only!*");
        const meta = await sock.groupMetadata(jid);
        const participantIds = meta.participants.map((p) => p.id).filter(Boolean);
        const heading = text || "📢 *Everyone has been tagged.*";
        const chunks = [];
        let chunkText = heading;
        let chunkMentions = [];

        // WhatsApp only creates visible tags when each JID also has an @token
        // in the message text. The previous list-message payload supplied the
        // mentions array without those tokens, so nobody was actually tagged.
        for (const participantId of participantIds) {
          const token = `@${participantId.split("@")[0]}`;
          const nextText = chunkMentions.length ? `${chunkText}\n${token}` : `${chunkText}\n${token}`;
          if (chunkMentions.length && nextText.length > 3500) {
            chunks.push({ text: chunkText, mentions: chunkMentions });
            chunkText = "📢 *Everyone else has been tagged.*";
            chunkMentions = [];
          }
          chunkText = `${chunkText}\n${token}`;
          chunkMentions.push(participantId);
        }
        if (chunkMentions.length || !chunks.length) chunks.push({ text: chunkText, mentions: chunkMentions });

        for (const chunk of chunks) {
          await sock.sendMessage(jid, chunk, { quoted: msg });
        }
        break;
      }
      case "tourl": {
        if (!IMGBB_API_KEY || IMGBB_API_KEY === "YOUR_IMGBB_API_KEY_HERE") {
          return reply(sock, msg, "❌ *ImgBB is not configured.* Set `IMGBB_API_KEY` in the bot environment first.");
        }
        const image = await getQuotedOrDirectMedia(msg, "image");
        if (!image) return reply(sock, msg, `❓ *Usage:* Reply to an image with ${PREFIX}tourl`);
        try {
          const form = new FormData();
          form.append("image", image, { filename: "upload.jpg", contentType: "application/octet-stream" });
          const uploaded = await axios.post(IMGBB_UPLOAD_URL, form, {
            params: { key: IMGBB_API_KEY },
            headers: form.getHeaders(),
            maxContentLength: 34 * 1024 * 1024,
            maxBodyLength: 34 * 1024 * 1024,
            timeout: 60000,
          });
          const publicUrl = uploaded.data?.data?.url || uploaded.data?.data?.display_url;
          if (!uploaded.data?.success || !publicUrl) throw new Error(uploaded.data?.error?.message || "ImgBB upload failed");
          await reply(sock, msg, `✅ *Image uploaded successfully.*\n🔗 ${publicUrl}`);
        } catch (err) {
          await reply(sock, msg, `❌ *Image upload failed:* ${err.response?.data?.error?.message || err.message}`);
        }
        break;
      }
      case "vv": {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) return reply(sock, msg, `❌ *Reply to a view-once photo, video, or voice note with* \`${PREFIX}vv\``);
        // View-once media can arrive wrapped in a container, or with the
        // viewOnce flag set directly on the media message itself — handle both.
        const voMsg =
          quoted.viewOnceMessageV2?.message ||
          quoted.viewOnceMessage?.message ||
          quoted.viewOnceMessageV2Extension?.message ||
          quoted;
        const kind = voMsg.imageMessage ? "image" : voMsg.videoMessage ? "video" : voMsg.audioMessage ? "audio" : null;
        const target = voMsg.imageMessage || voMsg.videoMessage || voMsg.audioMessage;
        if (!kind || !target) return reply(sock, msg, `❌ *That's not a view-once photo, video, or voice note.*`);
        try {
          const stream = await downloadContentFromMessage(target, kind);
          let buffer = Buffer.from([]);
          for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
          if (kind === "image") await sock.sendMessage(jid, { image: buffer, caption: wrapCaption("👁️ Revealed") }, { quoted: msg });
          else if (kind === "video") await sock.sendMessage(jid, { video: buffer, mimetype: "video/mp4", caption: wrapCaption("👁️ Revealed") }, { quoted: msg });
          else await sock.sendMessage(jid, { audio: buffer, mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted: msg });
        } catch (err) { reply(sock, msg, `❌ *Couldn't reveal:* ${err.message}`); }
        break;
      }

      // ── Settings ──
      case "welcome":
      case "goodbye":
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
      case "settings": {
        let sText = "⚙️ *Current Settings:*\n\n";
        for (const key in settings) sText += `${settings[key] ? "✅" : "❌"} *${key.toUpperCase()}*\n`;
        reply(sock, msg, sText);
        break;
      }

      // ── Tools ──
      case "calc": {
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}calc 2+2`);
        if (!/^[0-9+\-*/().\s%]+$/.test(text)) return reply(sock, msg, "❌ *Only numbers and + - * / ( ) % are allowed.*");
        try {
          // eslint-disable-next-line no-new-func
          const result = Function(`"use strict"; return (${text})`)();
          reply(sock, msg, `📊 *Result:* ${result}`);
        } catch { reply(sock, msg, "❌ *Invalid expression.*"); }
        break;
      }
      case "flip":
        reply(sock, msg, `🪙 *${Math.random() < 0.5 ? "Heads" : "Tails"}*`);
        break;
      case "roll":
        reply(sock, msg, `🎲 *You rolled:* ${1 + Math.floor(Math.random() * 6)}`);
        break;
      case "8ball": {
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}8ball <question>`);
        const answers = ["Yes.", "No.", "Definitely.", "Ask again later.", "Unlikely.", "Absolutely!", "I doubt it.", "It is certain."];
        reply(sock, msg, `🎱 ${answers[Math.floor(Math.random() * answers.length)]}`);
        break;
      }
      case "joke":
        try {
          const res = await axios.get("https://official-joke-api.appspot.com/random_joke", { timeout: 10000 });
          reply(sock, msg, `😂 *Joke:*\n\n${res.data.setup}\n\n${res.data.punchline}`);
        } catch { reply(sock, msg, "❌ *Couldn't fetch a joke right now.*"); }
        break;
      case "quote":
        try {
          const res = await axios.get("https://api.quotable.io/random", { timeout: 10000 });
          reply(sock, msg, `💬 *"${res.data.content}"*\n— ${res.data.author}`);
        } catch { reply(sock, msg, "❌ *Couldn't fetch a quote right now.*"); }
        break;
      case "fact":
        try {
          const res = await axios.get("https://uselessfacts.jsph.pl/api/v2/facts/random", { timeout: 10000 });
          reply(sock, msg, `💡 *Fact:* ${res.data.text}`);
        } catch { reply(sock, msg, "❌ *Couldn't fetch a fact right now.*"); }
        break;
      case "reverse":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}reverse <text>`);
        reply(sock, msg, text.split("").reverse().join(""));
        break;
      case "upper":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}upper <text>`);
        reply(sock, msg, text.toUpperCase());
        break;
      case "lower":
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}lower <text>`);
        reply(sock, msg, text.toLowerCase());
        break;
      case "id":
        reply(sock, msg, `🆔 *Chat ID:* ${jid}`);
        break;
      case "whoami":
        reply(sock, msg, `👤 *Name:* ${msg.pushName || "Unknown"}\n📱 *Number:* ${(msg.key.participant || jid).split("@")[0]}`);
        break;
      case "ping": {
        const sentAt = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();
        reply(sock, msg, `🏓 *Pong!* ${Date.now() - sentAt}ms`);
        break;
      }
      case "alive":
        reply(sock, msg, `✅ *${BOT_NAME} is alive!*\n⏱️ *Uptime:* ${getRuntime(startTime)}\n⚙️ *Prefix:* ${PREFIX}`);
        break;
      case "uptime":
        reply(sock, msg, `⏱️ *Uptime:* ${getRuntime(startTime)}`);
        break;

      // ── Owner ──
      case "owner": {
        const ownerJid = `${OWNER}@s.whatsapp.net`;
        await sock.sendMessage(jid, {
          text: wrapCaption(`👑 *OWNER DETAILS*\n\n👤 *Name:* ${AUTHOR}\n📱 *Number:* +263 781 021 754\n🌐 *Site:* nexora.zone.id\n🛠️ *Role:* Developer and owner`),
          mentions: [ownerJid],
        }, { quoted: msg });
        break;
      }
      case "broadcast": {
        if ((msg.key.participant || jid).split("@")[0] !== OWNER && !msg.key.fromMe) return reply(sock, msg, "❌ *Owner only!*");
        if (!text) return reply(sock, msg, `❓ *Usage:* ${PREFIX}broadcast <message>`);
        try {
          const groups = await sock.groupFetchAllParticipating();
          const ids = Object.keys(groups);
          for (const gid of ids) {
            await sock.sendMessage(gid, { text: `📢 *Broadcast:*\n\n${text}` });
            await new Promise((r) => setTimeout(r, 1200));
          }
          reply(sock, msg, `✅ *Broadcast sent to ${ids.length} group(s).*`);
        } catch (err) { reply(sock, msg, `❌ *Broadcast failed:* ${err.message}`); }
        break;
      }
      case "restart":
        if ((msg.key.participant || jid).split("@")[0] !== OWNER && !msg.key.fromMe) return reply(sock, msg, "❌ *Owner only!*");
        await reply(sock, msg, "🔄 *Restarting bot...*");
        process.exit(0);
        break;
      case "block":
      case "unblock": {
        if ((msg.key.participant || jid).split("@")[0] !== OWNER && !msg.key.fromMe) return reply(sock, msg, "❌ *Owner only!*");
        const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
        if (!target) return reply(sock, msg, `❓ *Usage:* ${PREFIX}${cmd} @user`);
        await sock.updateBlockStatus(target, cmd === "block" ? "block" : "unblock");
        reply(sock, msg, `✅ *${target.split("@")[0]} ${cmd === "block" ? "blocked" : "unblocked"}.*`);
        break;
      }

      default:
        reply(sock, msg, `❓ *Unknown command:* \`${PREFIX}${cmd}\`\nSend \`${PREFIX}menu\` to see everything available.`);
        break;
    }
  } catch (err) {
    console.error("Handler error:", err.message);
  }
}

module.exports = { handleCommand };
