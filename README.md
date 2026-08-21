# Nexora Bot Mini 🤖

Professional WhatsApp Multi-Device Bot with Management, Downloader, and Protection Tools. Built for speed, efficiency, and reliability.

> **Developed By:** [Boycoe-dev](https://github.com/boycoe7k)

---

## 🚀 Key Features

### 📥 Ultimate Downloader
Integrated with **Nexa VDL API** for seamless social media downloads:
- **YouTube**: `.yt` (Video), `.song` (Audio), `.vid` (Search & Video), `.yts` (Search).
- **TikTok**: `.tt` (No Watermark).
- **Instagram**: `.ig` (Reels/Videos).
- **Facebook**: `.fb` (Videos).

### 👑 Group Manager
Complete tools to manage your WhatsApp communities:
- **Anti-ViewOnce**: `.vv` - View deleted view-once messages.
- **Admin Tools**: `.kick`, `.add`, `.promote`, `.demote`, `.mute`, `.unmute`.
- **Group Info**: `.gcstatus`, `.groupinfo`, `.link`, `.revoke`.
- **Broadcasting**: `.tagall` / `.tag`.

### 🛡️ Protection (Settings)
Keep your account and groups safe:
- **Anti-Delete**: Automatically detects and recovers deleted messages.
- **Anti-Link**: Removes non-admins who share group links.
- **Anti-Call**: Automatically rejects incoming calls.
- **Auto-Status**: Automatically views all status updates.
- **Auto-React**: Interactive reactions to messages.

### 🌐 Web Dashboard
Modern, clean interface for linking:
- **Dynamic Pairing**: Enter your number on the web to get a pairing code instantly.
- **QR Code**: Fallback QR scanning for easy linking.
- **Status Monitor**: Real-time connection status tracking.

---

## 🛠️ Installation & Deployment

### 1. Clone the Repo
```bash
git clone https://github.com/boycoe7k/nexora-bot-mini.git
cd nexora-bot-mini
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Variables
Create a `.env` file or set these on your hosting provider:
- `OWNER_NUMBER`: Your phone number (e.g., `263716808196`).
- `API_KEY`: Your Nexa VDL API Key (e.g., `Nexora_YOUR_KEY`).
- `PORT`: Port for the web dashboard (default: `3000`).

### 4. Run the Bot
```bash
npm start
```

---

## 📝 Commands List
Type `.menu` in WhatsApp to see the full interactive menu.

---

## 🤝 Credits
- **Base:** [Baileys](https://github.com/WhiskeySockets/Baileys)
- **Developer:** [Boycoe-dev](https://github.com/boycoe7k)
- **API:** Nexa VDL API

---

*“Efficiency in every message.”*
