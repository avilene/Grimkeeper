# Grimkeeper Admin UI (MVP)

Minimal web UI to inspect/edit live game projections.

**Risk:** game/player edits write directly to Prisma projection tables. They do **not** append engine events. Prefer bot commands for normal play.

## Features

- Discord OAuth (`identify` scope)
- Access limited to `ALLOWED_USER_IDS` (deny-by-default if empty)
- List/edit games and players (Discord IDs, seats, roles, threads, …)
- Errors/performance via **Sentry** (`SENTRY_DSN`) — not a built-in log explorer

## Local setup

1. In the [Discord Developer Portal](https://discord.com/developers/applications) for the same app as the bot:
   - OAuth2 → add redirect: `http://localhost:3847/auth/callback`
   - Copy **Client Secret**
2. Add to repo-root `.env`:

```bash
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
ADMIN_SESSION_SECRET=...       # long random string
ADMIN_OAUTH_CALLBACK_URL=http://localhost:3847/auth/callback
ALLOWED_USER_IDS=123,456
DATABASE_URL=file:./packages/database/prisma/dev.db
SENTRY_DSN=https://...@....ingest.de.sentry.io/...
# ADMIN_PORT=3847
# ADMIN_COOKIE_SECURE=true
```

3. Apply schema and run:

```bash
pnpm install
pnpm db:push
pnpm --filter @grimkeeper/database build
pnpm admin:dev
```

Open http://localhost:3847

## Production (droplet)

Admin shares the bot Docker image and the SQLite volume. Enable the compose profile:

1. **Discord Developer Portal** → OAuth2 → Redirects, add your public callback, e.g.
   - `https://admin.example.com/auth/callback` (recommended, behind Caddy/nginx), or
   - `http://YOUR_DROPLET_IP:3847/auth/callback` (quick / no TLS)
2. On the droplet `.env` (same file as the bot):

```bash
COMPOSE_PROFILES=admin

DISCORD_CLIENT_ID=...              # already required by the bot
DISCORD_CLIENT_SECRET=...          # Discord OAuth2 → Client Secret
ADMIN_SESSION_SECRET=...           # openssl rand -hex 32
ADMIN_OAUTH_CALLBACK_URL=https://admin.example.com/auth/callback
ALLOWED_USER_IDS=YOUR_DISCORD_USER_ID
# Optional host bind / port (container always listens on 3847)
# ADMIN_HOST_PORT=3847
# ADMIN_BIND=0.0.0.0
# ADMIN_COOKIE_SECURE=true         # auto-on when callback URL is https://
# SENTRY_DSN=...                   # optional; same as bot is fine
```

3. Redeploy (pulls the image and recreates **bot + admin**):

```bash
pnpm docker:redeploy
# or: docker compose --profile admin up -d
```

4. Open the public URL and log in with Discord. Empty `ALLOWED_USER_IDS` denies everyone.

**Notes**

- Keep **exactly one** bot replica (`docker compose ps` — scale must stay 1).
- Prefer HTTPS + reverse proxy; if you terminate TLS elsewhere, leave `ADMIN_COOKIE_SECURE` unset (auto-detects `https://` callbacks) or set it to `true`.
- To bind admin to localhost only (proxy on the host): `ADMIN_BIND=127.0.0.1`

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/login` | Login page |
| GET | `/auth/discord` | Start Discord OAuth |
| GET | `/auth/callback` | OAuth callback |
| GET | `/logout` | Clear session |
| GET | `/` | Game list (`?show=all` includes ended) |
| GET | `/games/:id` | Game + players edit forms |
| POST | `/games/:id` | Save game fields |
| POST | `/games/:id/players/:playerId` | Save player fields |
| GET | `/healthz` | Liveness |

## TODOs

- [ ] Persistent session store (current: in-memory `express-session`)
- [ ] CSRF tokens on POST forms
- [ ] Audit log of admin edits
- [ ] Optional: append compensating engine events instead of raw projection writes
