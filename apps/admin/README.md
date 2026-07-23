# Grimkeeper Admin UI (MVP)

Minimal web UI to inspect/edit live game projections.

**Risk:** game/player edits write directly to Prisma projection tables. They do **not** append engine events. Prefer bot commands for normal play.

## Features

- Discord OAuth (`identify` scope)
- Access limited to `ALLOWED_USER_IDS` (deny-by-default if empty)
- List/edit games and players (Discord IDs, seats, roles, threads, …)
- Errors/performance via **Sentry** (`SENTRY_DSN`) — not a built-in log explorer

## Setup

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
- [ ] Docker / compose service for droplet deploys
