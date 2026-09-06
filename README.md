# Nexora Bot Mini 🤖

Multi-session WhatsApp bot built with Node.js, Express and Baileys.

## 3-session architecture

Each Render deployment supports **up to 3 WhatsApp sessions**. Each slot has separate authentication state and connection handling.

Open the deployment URL to use the built-in pairing site:

1. Select Session 1, 2, or 3.
2. Enter the WhatsApp number with country code.
3. Generate the pairing code.
4. In WhatsApp, open **Linked devices → Link a device → Link with phone number**.
5. Enter the code.

The pairing site also shows live connection state and QR codes when available.

## Render Free note

Render's Free web service has 512 MB RAM and 0.1 CPU. Free services can spin down after 15 minutes without inbound traffic, and their filesystem is ephemeral. That means local WhatsApp auth files can be lost after a restart, redeploy, or spin-down. For durable sessions, use external persistence or a paid Render persistent disk and set `SESSION_ROOT` to its mount path.

## Environment variables

- `OWNER_NUMBER` — owner number, digits only with country code.
- `DASHBOARD_TOKEN` — secret for protected admin endpoints.
- `BOT_NAME` — bot name.
- `AUTHOR` — developer name.
- `PREFIX` — command prefix.
- `SESSION_ROOT` — root directory for session folders.
- `NEXA_VDL_API_KEY`, `UNSPLASH_KEY`, `IMGBB_API_KEY`, `REMOVEBG_KEY`, `OPENAI_API_KEY` — optional API keys.

Never commit real secrets.

## Security / stability changes

- Pairing endpoint is rate-limited.
- Admin session endpoints require `DASHBOARD_TOKEN`.
- The old public destructive `/reset` endpoint is removed.
- Owner number is no longer hardcoded.
- Each session reconnects independently with exponential backoff.
- Memory-heavy message storage is capped per session.
- Baileys is pinned to the 6.7.x line instead of automatically jumping to the v7 RC line.

## Commands

See `src/commands.js`.
