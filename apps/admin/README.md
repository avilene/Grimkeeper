# Grimkeeper Admin UI

Next.js (App Router) + shadcn/ui admin for inspecting/editing live game projections and the ST queue.

**Risk:** game/player/queue edits write directly to Prisma projection tables. They do **not** append engine events. Prefer bot commands for normal play. After ST queue edits, run `/st queue refresh` in Discord.

## Features

- Discord OAuth via Auth.js (`identify` scope)
- Access limited to `ALLOWED_USER_IDS` (deny-by-default if empty)
- Games + players edit forms
- ST queue boards / entries / members moderation
- shadcn/ui (zinc dark) layout
- Sentry (`@sentry/nextjs`) via dedicated `ADMIN_SENTRY_DSN` / admin project
- Production source maps uploaded to Sentry during the admin Docker image build (when `SENTRY_AUTH_TOKEN` is set)

## Local setup

1. In the [Discord Developer Portal](https://discord.com/developers/applications) for the same app as the bot:
   - OAuth2 → add redirect: `http://localhost:3847/api/auth/callback/discord`
   - Copy **Client Secret**
2. Add to repo-root `.env`:

```bash
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
ADMIN_SESSION_SECRET=...       # long random string (also used as Auth.js secret)
# Optional: AUTH_SECRET=...    # overrides ADMIN_SESSION_SECRET for Auth.js
ADMIN_OAUTH_CALLBACK_URL=http://localhost:3847/api/auth/callback/discord
ALLOWED_USER_IDS=123,456
DATABASE_URL=file:./packages/database/prisma/dev.db
ADMIN_SENTRY_DSN=https://...@....ingest.sentry.io/...   # admin project DSN (not bot)
# ADMIN_PORT=3847
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

Admin has its own Docker image (`apps/admin/Dockerfile` → `ghcr.io/…/Grimkeeper-admin`) and shares the bot SQLite volume. Enable the compose profile:

1. **Discord Developer Portal** → OAuth2 → Redirects, add your public callback, e.g.
   - `https://admin.example.com/api/auth/callback/discord` (recommended, behind Caddy/nginx), or
   - `http://YOUR_DROPLET_IP:3847/api/auth/callback/discord` (quick / no TLS)
2. On the droplet `.env` (same file as the bot):

```bash
COMPOSE_PROFILES=admin
# Optional — defaults to GRIMKEEPER_IMAGE with -admin before the tag:
# ADMIN_IMAGE=ghcr.io/YOUR_GITHUB_USER/Grimkeeper-admin:latest

DISCORD_CLIENT_ID=...              # already required by the bot
DISCORD_CLIENT_SECRET=...          # Discord OAuth2 → Client Secret
ADMIN_SESSION_SECRET=...           # openssl rand -hex 32
ADMIN_OAUTH_CALLBACK_URL=https://admin.example.com/api/auth/callback/discord
# Or by droplet IP (include port if you expose 3847 directly):
# ADMIN_OAUTH_CALLBACK_URL=http://46.101.182.124:3847/api/auth/callback/discord
# Optional explicit Auth.js origin (defaults to origin of ADMIN_OAUTH_CALLBACK_URL):
# AUTH_URL=http://46.101.182.124:3847
ALLOWED_USER_IDS=YOUR_DISCORD_USER_ID
ADMIN_SENTRY_DSN=...                   # Sentry → Projects → admin → Client Keys
# Optional host bind / port (container always listens on 3847)
# ADMIN_HOST_PORT=3847
# ADMIN_BIND=0.0.0.0
```

3. Redeploy (pulls bot + admin images and recreates both):

```bash
pnpm docker:redeploy
# or: docker compose --profile admin up -d
```

4. Open the public URL and log in with Discord. Empty `ALLOWED_USER_IDS` denies everyone.

**Source maps (readable Sentry stack traces)**

1. Create a Sentry org auth token with `project:releases` + `org:read` (Organization Settings → Auth Tokens).
2. Add it as the GitHub Actions secret `SENTRY_AUTH_TOKEN`.
3. On push to `main`, the Docker workflow builds the admin image with `SENTRY_RELEASE=<git sha>` and uploads maps during `next build`. The same release is baked into the image so runtime events match.
4. Local/image builds without the token still succeed; they just skip upload.

**Notes**

- Keep **exactly one** bot replica (`docker compose ps` — scale must stay 1).
- CI rebuilds the admin image when `apps/admin/**` or shared packages change (same path-filter pattern as deploy-hook).
- OAuth callback path is **`/api/auth/callback/discord`** (Auth.js). Update Discord portal redirects if you used the old Express `/auth/callback`.
- Set `ADMIN_OAUTH_CALLBACK_URL` to the **public** URL (your domain or `http://DROPLET_IP:3847/api/auth/callback/discord`). The container binds to `0.0.0.0`; without this, Auth.js may redirect to `http://0.0.0.0:3847/...`.
- Prefer HTTPS + reverse proxy.
- To bind admin to localhost only (proxy on the host): `ADMIN_BIND=127.0.0.1`

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/login` | Login page |
| GET/POST | `/api/auth/*` | Auth.js Discord OAuth |
| GET | `/` | Redirects to `/games` |
| GET | `/games` | Game list (`?show=all` includes ended) |
| GET | `/games/[id]` | Game + players edit forms |
| GET | `/queues` | ST queue boards + entries (`?show=all` includes closed) |
| GET | `/queues/entries/[id]` | Queue entry + members edit forms |
| GET | `/healthz` | Liveness |

Mutations use Next.js server actions (POST from the forms above).

## TODOs

- [ ] Persistent Auth.js session store (current: JWT/cookie)
- [ ] Audit log of admin edits
- [ ] Optional: Discord panel refresh from admin
- [ ] Optional: append compensating engine events instead of raw projection writes
