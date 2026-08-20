# ⚡ Shadow Bot — WhatsApp Multi-Device Bot

> A powerful WhatsApp bot using Baileys with **pairing code authentication** (no QR scan needed).

---

## 🚀 Quick Setup

### 1. Requirements
- **Node.js v18+** → [nodejs.org](https://nodejs.org)
- A WhatsApp account (not banned)

### 2. Install
```bash
# Clone / download the folder, then:
cd shadow-whatsapp-bot
npm install
```

### 3. Configure
```bash
cp .env.example .env
# Edit .env and set your OWNER_NUMBER
```

### 4. Run
```bash
node index.js
# or for auto-restart on crash:
npm run dev
```

### 5. Link via Pairing Code
1. The bot will ask: **"Enter your WhatsApp number"**
2. Type your number with country code (e.g. `2348012345678`)
3. The bot prints an **8-digit code** like `ABCD-1234`
4. Open WhatsApp → **Linked Devices** → **Link with Phone Number**
5. Enter the code — done! ✅

---

## 📋 All Commands (26 total)

| Command | Description |
|---|---|
| `.menu` | 🗂 Show stylish menu with image |
| `.ping` | 🏓 Check bot speed |
| `.alive` | ✅ Check bot is online |
| `.owner` | 👑 Show owner contact |
| `.image <query>` | 🔍 Search & send an image |
| `.gif <query>` | 🎥 Search & send a GIF |
| `.wiki <topic>` | 📚 Wikipedia summary |
| `.joke` | 😂 Random joke |
| `.quote` | 💭 Inspirational quote |
| `.flip` | 🪙 Flip a coin |
| `.roll [sides]` | 🎲 Roll a dice |
| `.calc <expr>` | 🧮 Calculate expression |
| `.weather <city>` | 🌤 Weather info |
| `.sticker` | 🖼 Reply to image → sticker |
| `.gcstatus` | 📢 Post image/video/text to status (admin) |
| `.kickall` | 💀 Kick all non-admin members (admin) |
| `.kick @user` | 👢 Kick tagged member (admin) |
| `.add <number>` | ➕ Add member to group (admin) |
| `.promote @user` | ⬆️ Promote to admin (admin) |
| `.demote @user` | ⬇️ Demote from admin (admin) |
| `.mute` | 🔇 Mute group (admin only messages) |
| `.unmute` | 🔊 Unmute group |
| `.link` | 🔗 Get group invite link |
| `.revoke` | ♻️ Revoke group invite link |
| `.groupinfo` | 📋 Show group details |
| `.tag [message]` | 📢 Tag all group members |

---

## 📢 .gcstatus Usage

```
# Post an image to status:
Reply to any image with: .gcstatus

# Post a video to status:
Reply to any video with: .gcstatus

# Post text to status:
.gcstatus Today is a great day! 🌟
```

---

## 🔑 Optional API Keys

For better image/GIF search, add free API keys to `.env`:

- **Unsplash** (images): [unsplash.com/developers](https://unsplash.com/developers)
- **Giphy** (GIFs): [developers.giphy.com](https://developers.giphy.com)

Without keys, the bot falls back to public endpoints automatically.

---

## ☁️ Deploy on Render

1. **Push this folder to a GitHub repo.**

2. **Create the service on Render:**
   - New → Web Service → connect your repo
   - Runtime: `Node`
   - Build command: `npm install`
   - Start command: `node index.js`
   - Plan: Free is fine (or use `render.yaml` — Render will detect it and offer "Apply" for a Blueprint deploy)

3. **Set environment variables** (Settings → Environment):
   - `OWNER_NUMBER` — your WhatsApp number with country code, digits only (e.g. `2348012345678`). **Required on Render** — there's no terminal to type it into, so the bot reads this instead of prompting.
   - `BOT_NAME`, `PREFIX`, `UNSPLASH_KEY`, `GIPHY_KEY` — optional, same as local `.env`
   - Don't set `PORT` — Render provides it automatically.

4. **Deploy.** Once it's live, open your Render service URL in a browser. That's the bot's status page: it shows `pairing` status and the pairing code, and updates automatically. Enter the code in WhatsApp → Linked Devices → Link with Phone Number within 60 seconds.

5. **Once connected**, the page shows `connected` and the linked account. The bot keeps running as long as the Render service is up.

### ⚠️ Things that are different from running locally
- **No persistent session on the free plan.** Render's free instances lose their filesystem on every restart, sleep, or redeploy — so `./session` (your login) is wiped and you'll need to re-enter a pairing code each time the service restarts. If you want the bot to stay linked across restarts, upgrade to a paid Render plan and attach a **persistent disk** mounted at `./session`.
- **Free web services spin down when idle** and take a few seconds to wake on the next request/message — expect a short delay after inactivity.
- The status page is unauthenticated by default. Since it only shows connection state and a short-lived pairing code, that's a reasonable tradeoff, but avoid sharing the URL publicly if you'd rather keep it private.

---

## ⚙️ Project Structure

```
shadow-whatsapp-bot/
├── index.js          ← Main entry, pairing code auth
├── src/
│   └── commands.js   ← All 26 commands
├── session/          ← Auto-created, stores auth session
├── package.json
├── .env.example
└── README.md
```

---

## ⚠️ Notes

- The bot must be an **admin** in a group to use group commands
- Session is saved in `./session/` — don't delete it while running
- If you get logged out, delete `./session/` and re-link

---

_Built with ❤️ using [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)_
