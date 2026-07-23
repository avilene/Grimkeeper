# Grimkeeper Admin UI (MVP)

Minimal web UI to inspect/edit live game projections and browse game + app logs.

**Risk:** game/player edits write directly to Prisma projection tables. They do **not** append engine events. Prefer bot commands for normal play.

## Features

- Discord OAuth (`identify` scope)
- Access limited to `ALLOWED_USER_IDS` (deny-by-default if empty)
- List/edit games and players (Discord IDs, seats, roles, threads, …)
- **Log explorer**
  - `/logs` — `GameEvent` store (filter by game id, type, time range)
  - `/logs/app` — `AppLog` sink for bot `warn`/`error` (filter by game id, level, time)

### What is stored where

| Source | In DB? | In admin UI? |
|--------|--------|--------------|
| Engine game events | Yes (`GameEvent`) | `/logs` |
| Bot warn/error (optional sink) | Yes (`AppLog`) when `APP_LOG_TO_DB` is on | `/logs/app` |
| Bot info/debug pino lines | No (stdout) | No — use `docker compose logs` / Grafana |
| Discord ST audit log thread | Discord only | No |

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
# ADMIN_PORT=3847
# ADMIN_COOKIE_SECURE=true
# APP_LOG_TO_DB=false          # disable bot warn/error DB sink
```

3. Apply schema (adds `AppLog` + event indexes) and run:

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
| GET | `/logs` | Game event explorer |
| GET | `/logs/app` | App log explorer |
| GET | `/healthz` | Liveness |

## TODOs

- [ ] Persistent session store (current: in-memory `express-session`)
- [ ] CSRF tokens on POST forms
- [ ] Audit log of admin edits
- [ ] AppLog retention / pruning
- [ ] Optional: append compensating engine events instead of raw projection writes
- [ ] Docker / compose service for droplet deploys
