const axios = require("axios");
const fs = require("fs");

const PREFIX = ".";
const BOT_NAME = "Shadow Bot";
const MENU_IMAGE = "https://files.catbox.moe/qvsvi2.jpg";
const OWNER = process.env.OWNER_NUMBER || "263716808196";

// ── Get plain text from any message type ─────────────────────────────────────
function getMessageText(msg) {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ""
  );
}

// ── Download URL to Buffer ────────────────────────────────────────────────────
async function urlToBuffer(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  return Buffer.from(res.data);
}

// ── Reply helper ──────────────────────────────────────────────────────────────
async function reply(sock, msg, text) {
  await sock.sendMessage(msg.key.remoteJid, { text: String(text) }, { quoted: msg });
}

// ── React helper ──────────────────────────────────────────────────────────────
async function react(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
  } catch (_) {}
}

// ── Is group ──────────────────────────────────────────────────────────────────
function isGroup(msg) {
  return msg.key.remoteJid.endsWith("@g.us");
}

// ── Group metadata ────────────────────────────────────────────────────────────
async function getGroupMeta(sock, jidG) {
  try { return await sock.groupMetadata(jidG); } catch { return null; }
}

// ── Is admin ──────────────────────────────────────────────────────────────────
async function isAdmin(sock, groupJid, participantJid) {
  const meta = await getGroupMeta(sock, groupJid);
  if (!meta) return false;
  return meta.participants.filter((p) => p.admin).map((p) => p.id).includes(participantJid);
}

// ── Stylish Menu Text ─────────────────────────────────────────────────────────
function buildMenu(pushName) {
  const time = new Date().toLocaleTimeString("en-US", { hour12: true });
  const date = new Date().toLocaleDateString("en-GB");
  return `╔═══════════════════════════╗
║  ⚡  *S H A D O W  B O T*  ⚡  ║
╚═══════════════════════════╝

👤 *User:* ${pushName}
🕐 *Time:* ${time}
📅 *Date:* ${date}
🤖 *Bot:* ${BOT_NAME}
🔣 *Prefix:* \`${PREFIX}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 *GROUP COMMANDS*
┣ \`${PREFIX}gcstatus\` — Post photo/video to status
┣ \`${PREFIX}kickall\`  — Kick all members
┣ \`${PREFIX}kick\`     — Kick tagged member
┣ \`${PREFIX}add\`      — Add member by number
┣ \`${PREFIX}promote\`  — Promote to admin
┣ \`${PREFIX}demote\`   — Demote from admin
┣ \`${PREFIX}mute\`     — Mute group
┣ \`${PREFIX}unmute\`   — Unmute group
┣ \`${PREFIX}link\`     — Get invite link
┣ \`${PREFIX}revoke\`   — Revoke invite link
┣ \`${PREFIX}groupinfo\`— Group information
┗ \`${PREFIX}tag\`      — Tag all members

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 *SEARCH COMMANDS*
┣ \`${PREFIX}image\`    — Search & send image
┣ \`${PREFIX}gif\`      — Search & send GIF
┗ \`${PREFIX}wiki\`     — Wikipedia search

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎮 *FUN & TOOLS*
┣ \`${PREFIX}sticker\`  — Image to sticker
┣ \`${PREFIX}weather\`  — Weather info
┣ \`${PREFIX}joke\`     — Random joke
┣ \`${PREFIX}quote\`    — Inspirational quote
┣ \`${PREFIX}flip\`     — Flip a coin
┣ \`${PREFIX}roll\`     — Roll a dice
┗ \`${PREFIX}calc\`     — Calculator

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚙️  *GENERAL*
┣ \`${PREFIX}menu\`     — Show this menu
┣ \`${PREFIX}ping\`     — Bot speed test
┣ \`${PREFIX}alive\`    — Bot status
┗ \`${PREFIX}owner\`    — Owner contact

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   _⚡ Powered by Shadow Bot ⚡_`;
}

// ── MAIN COMMAND HANDLER ──────────────────────────────────────────────────────
async function handleCommand(sock, msg) {
  try {
    const jid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const pushName = msg.pushName || "User";
    const body = getMessageText(msg).trim();

    // Must start with prefix
    if (!body.startsWith(PREFIX)) return;

    const parts = body.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = parts.shift().toLowerCase();
    const args = parts;
    const text = args.join(" ");

    console.log(`[CMD] ${pushName} (${sender}): ${PREFIX}${cmd} ${text}`);

    // React to show bot received it
    await react(sock, msg, "⚡");

    // ═══════════════════════════════════════════
    // GENERAL COMMANDS
    // ═══════════════════════════════════════════

    if (cmd === "menu") {
      const menuText = buildMenu(pushName);
      try {
        const imgBuffer = await urlToBuffer(MENU_IMAGE);
        await sock.sendMessage(jid, {
          image: imgBuffer,
          caption: menuText,
          mimetype: "image/jpeg",
        }, { quoted: msg });
      } catch (e) {
        // Fallback to text only if image fails
        console.log("Menu image failed, sending text:", e.message);
        await reply(sock, msg, menuText);
      }
      return;
    }

    if (cmd === "ping") {
      const start = Date.now();
      await sock.sendMessage(jid, { text: "🏓 Pinging..." }, { quoted: msg });
      await reply(sock, msg, `✅ *Pong!*\n⚡ Speed: *${Date.now() - start}ms*`);
      return;
    }

    if (cmd === "alive") {
      const upSecs = Math.floor(process.uptime());
      const mins = Math.floor(upSecs / 60);
      const secs = upSecs % 60;
      await reply(sock, msg,
        `╔══════════════════╗\n` +
        `║  ⚡ *SHADOW BOT* ⚡  ║\n` +
        `╚══════════════════╝\n` +
        `✅ *Status:* Online\n` +
        `⏰ *Uptime:* ${mins}m ${secs}s\n` +
        `🤖 *Bot:* ${BOT_NAME}\n` +
        `🔧 *Version:* 1.0.0`
      );
      return;
    }

    if (cmd === "owner") {
      await reply(sock, msg, `👑 *Bot Owner*\n📱 wa.me/${OWNER}\n🤖 Bot: ${BOT_NAME}`);
      return;
    }

    // ═══════════════════════════════════════════
    // SEARCH COMMANDS
    // ═══════════════════════════════════════════

    if (cmd === "image" || cmd === "img") {
      if (!text) return reply(sock, msg, "❌ Usage: .image <search term>");
      try {
        const imgUrl = `https://source.unsplash.com/800x600/?${encodeURIComponent(text)}&t=${Date.now()}`;
        const buf = await urlToBuffer(imgUrl);
        await sock.sendMessage(jid, {
          image: buf,
          caption: `🔍 *Result for:* ${text}`,
          mimetype: "image/jpeg",
        }, { quoted: msg });
      } catch (e) {
        await reply(sock, msg, `❌ Image search failed: ${e.message}`);
      }
      return;
    }

    if (cmd === "wiki") {
      if (!text) return reply(sock, msg, "❌ Usage: .wiki <topic>");
      try {
        const res = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text)}`);
        const { title, extract } = res.data;
        const summary = extract?.length > 900 ? extract.slice(0, 900) + "..." : extract;
        await reply(sock, msg, `📚 *${title}*\n\n${summary || "No info found."}`);
      } catch {
        await reply(sock, msg, "❌ Wikipedia article not found.");
      }
      return;
    }

    if (cmd === "weather") {
      if (!text) return reply(sock, msg, "❌ Usage: .weather <city>");
      try {
        const res = await axios.get(`https://wttr.in/${encodeURIComponent(text)}?format=%l:+%C+%t,+Humidity:+%h,+Wind:+%w`, { timeout: 10000 });
        await reply(sock, msg, `🌤️ *Weather — ${text}*\n\n${res.data}`);
      } catch {
        await reply(sock, msg, "❌ Weather not found.");
      }
      return;
    }

    // ═══════════════════════════════════════════
    // FUN COMMANDS
    // ═══════════════════════════════════════════

    if (cmd === "joke") {
      try {
        const res = await axios.get("https://official-joke-api.appspot.com/random_joke", { timeout: 8000 });
        await reply(sock, msg, `😂 *Joke Time!*\n\n❓ ${res.data.setup}\n\n💥 ${res.data.punchline}`);
      } catch {
        await reply(sock, msg, `😂 *Joke!*\n\n❓ Why don't scientists trust atoms?\n\n💥 Because they make up everything!`);
      }
      return;
    }

    if (cmd === "quote") {
      try {
        const res = await axios.get("https://api.quotable.io/random", { timeout: 8000 });
        await reply(sock, msg, `💭 *"${res.data.content}"*\n\n— _${res.data.author}_`);
      } catch {
        await reply(sock, msg, `💭 *"The secret of getting ahead is getting started."*\n\n— _Mark Twain_`);
      }
      return;
    }

    if (cmd === "flip") {
      await reply(sock, msg, Math.random() < 0.5 ? "🪙 *Heads!*" : "🪙 *Tails!*");
      return;
    }

    if (cmd === "roll") {
      const sides = parseInt(args[0]) || 6;
      const result = Math.floor(Math.random() * sides) + 1;
      await reply(sock, msg, `🎲 You rolled *${result}* out of ${sides}`);
      return;
    }

    if (cmd === "calc") {
      if (!text) return reply(sock, msg, "❌ Usage: .calc 5+5");
      try {
        const result = Function(`"use strict"; return (${text})`)();
        await reply(sock, msg, `🧮 *${text}* = *${result}*`);
      } catch {
        await reply(sock, msg, "❌ Invalid expression.");
      }
      return;
    }

    // ═══════════════════════════════════════════
    // GROUP COMMANDS
    // ═══════════════════════════════════════════

    const groupOnlyCmds = ["kick","kickall","add","promote","demote","mute","unmute","link","revoke","groupinfo","tag","gcstatus","sticker"];

    if (groupOnlyCmds.includes(cmd) && !isGroup(msg)) {
      await reply(sock, msg, "❌ This command only works in groups.");
      return;
    }

    if (cmd === "groupinfo") {
      const meta = await getGroupMeta(sock, jid);
      if (!meta) return reply(sock, msg, "❌ Could not get group info.");
      const admins = meta.participants.filter((p) => p.admin).length;
      await reply(sock, msg,
        `╔══════════════════╗\n` +
        `║  📋 *GROUP INFO*   ║\n` +
        `╚══════════════════╝\n` +
        `📌 *Name:* ${meta.subject}\n` +
        `👥 *Members:* ${meta.participants.length}\n` +
        `👑 *Admins:* ${admins}\n` +
        `📝 *Desc:* ${meta.desc || "None"}`
      );
      return;
    }

    if (cmd === "tag") {
      if (!await isAdmin(sock, jid, sender)) return reply(sock, msg, "❌ Admins only.");
      const meta = await getGroupMeta(sock, jid);
      if (!meta) return reply(sock, msg, "❌ Could not get group.");
      const mentions = meta.participants.map((p) => p.id);
      const tagText = (text ? `📢 *${text}*\n\n` : "📢 *Attention everyone!*\n\n") +
        mentions.map((m) => `@${m.split("@")[0]}`).join(" ");
      await sock.sendMessage(jid, { text: tagText, mentions }, { quoted: msg });
      return;
    }

    if (cmd === "link") {
      if (!await isAdmin(sock, jid, sender)) return reply(sock, msg, "❌ Admins only.");
      try {
        const code = await sock.groupInviteCode(jid);
        await reply(sock, msg, `🔗 *Invite Link*\nhttps://chat.whatsapp.com/${code}`);
      } catch {
        await reply(sock, msg, "❌ Could not get invite link.");
      }
      return;
    }

    if (cmd === "revoke") {
      if (!await isAdmin(sock, jid, sender)) return reply(sock, msg, "❌ Admins only.");
      await sock.groupRevokeInvite(jid);
      await reply(sock, msg, "✅ Invite link revoked!");
      return;
    }

    if (cmd === "kick") {
      if (!await isAdmin(sock, jid, sender)) return reply(sock, msg, "❌ Admins only.");
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      if (!mentioned.length) return reply(sock, msg, "❌ Tag someone: .kick @user");
      await sock.groupParticipantsUpdate(jid, mentioned, "remove");
      await reply(sock, msg, `✅ Kicked ${mentioned.length} member(s).`);
      return;
    }

    if (cmd === "kickall") {
      if (!await isAdmin(sock, jid, sender)) return reply(sock, msg, "❌ Admins only.");
      const meta = await getGroupMeta(sock, jid);
      if (!meta) return reply(sock, msg, "❌ Could not get group.");
      const botId = sock.user.id.split(":")[0] + "@s.whatsapp.net";
      const members = meta.participants
        .filter((p) => !p.admin && p.id !== botId && p.id !== sender)
        .map((p) => p.id);
      if (!members.length) return reply(sock, msg, "ℹ️ No members to kick.");
      await reply(sock, msg, `⚠️ Kicking *${members.length}* members...`);
      for (let i = 0; i < members.length; i += 5) {
        await sock.groupParticipantsUpdate(jid, members.slice(i, i + 5), "remove");
        await new Promise((r) => setTimeout(r, 1500));
      }
      await reply(sock, msg, `✅ Kicked *${members.length}* members!`);
      return;
    }

    if (cmd === "add") {
      if (!await isAdmin(sock, jid, sender)) return reply(sock, msg, "❌ Admins only.");
      if (!text) return reply(sock, msg, "❌ Usage: .add 263712345678");
      const addJid = text.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
      await sock.groupParticipantsUpdate(jid, [addJid], "add");
      await reply(sock, msg, `✅ Added ${text}!`);
      return;
    }

    if (cmd === "promote") {
      if (!await isAdmin(sock, jid, sender)) return reply(sock, msg, "❌ Admins only.");
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      if (!mentioned.length) return reply(sock, msg, "❌ Tag someone: .promote @user");
      await sock.groupParticipantsUpdate(jid, mentioned, "promote");
      await reply(sock, msg, "✅ Promoted to admin!");
      return;
    }

    if (cmd === "demote") {
      if (!await isAdmin(sock, jid, sender)) return reply(sock, msg, "❌ Admins only.");
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      if (!mentioned.length) return reply(sock, msg, "❌ Tag someone: .demote @user");
      await sock.groupParticipantsUpdate(jid, mentioned, "demote");
      await reply(sock, msg, "✅ Demoted from admin!");
      return;
    }

    if (cmd === "mute") {
      if (!await isAdmin(sock, jid, sender)) return reply(sock, msg, "❌ Admins only.");
      await sock.groupSettingUpdate(jid, "announcement");
      await reply(sock, msg, "🔇 Group muted! Only admins can send messages.");
      return;
    }

    if (cmd === "unmute") {
      if (!await isAdmin(sock, jid, sender)) return reply(sock, msg, "❌ Admins only.");
      await sock.groupSettingUpdate(jid, "not_announcement");
      await reply(sock, msg, "🔊 Group unmuted! Everyone can send messages.");
      return;
    }

    if (cmd === "gcstatus") {
      if (!await isAdmin(sock, jid, sender)) return reply(sock, msg, "❌ Admins only.");
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const quoted = ctx?.quotedMessage;
      const caption = text || "Posted by Shadow Bot ⚡";

      if (quoted?.imageMessage) {
        try {
          const imgUrl = quoted.imageMessage.url;
          const buf = await urlToBuffer(imgUrl);
          await sock.sendMessage("status@broadcast", { image: buf, caption });
          await reply(sock, msg, "✅ Image posted to status!");
        } catch (e) {
          await reply(sock, msg, `❌ Failed: ${e.message}`);
        }
      } else if (quoted?.videoMessage) {
        try {
          const vidUrl = quoted.videoMessage.url;
          const buf = await urlToBuffer(vidUrl);
          await sock.sendMessage("status@broadcast", { video: buf, caption });
          await reply(sock, msg, "✅ Video posted to status!");
        } catch (e) {
          await reply(sock, msg, `❌ Failed: ${e.message}`);
        }
      } else if (text) {
        await sock.sendMessage("status@broadcast", { text: `${text}\n\n— ${BOT_NAME}` });
        await reply(sock, msg, "✅ Text posted to status!");
      } else {
        await reply(sock, msg,
          `📢 *GC Status Usage:*\n\n` +
          `• Reply to an *image* with \`.gcstatus\`\n` +
          `• Reply to a *video* with \`.gcstatus\`\n` +
          `• \`.gcstatus your text\` for text status`
        );
      }
      return;
    }

    if (cmd === "sticker" || cmd === "s") {
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const imgMsg = ctx?.quotedMessage?.imageMessage || msg.message?.imageMessage;
      if (!imgMsg) return reply(sock, msg, "❌ Reply to an image with .sticker");
      await reply(sock, msg, "⏳ Creating sticker...");
      try {
        const buf = await urlToBuffer(imgMsg.url);
        await sock.sendMessage(jid, { sticker: buf }, { quoted: msg });
      } catch (e) {
        await reply(sock, msg, `❌ Sticker failed: ${e.message}`);
      }
      return;
    }

    // Unknown command — do nothing silently

  } catch (err) {
    console.error("handleCommand error:", err.message);
  }
}

module.exports = { handleCommand };
