# Grimkeeper

Discord-native storyteller assistant for Blood on the Clocktower.

## Architecture

```
Discord -> Adapter -> Engine -> Events -> Projections -> Persistence
```

- **apps/bot** — discordx adapter (slash commands)
- **apps/admin** — optional Next.js + Discord-OAuth admin UI for game/queue projections (see `apps/admin/README.md`)
- **packages/engine** — event-sourced game engine + character plugins
- **packages/database** — Prisma + SQLite event store

## Local development

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Copy environment variables:
   ```bash
   cp .env.example .env
   ```

3. Create a [Discord application](https://discord.com/developers/applications), add a bot, and set:
   - `DISCORD_TOKEN` — bot token
   - `DISCORD_CLIENT_ID` — application ID
   - optional access control:
     - `ALLOWED_USER_IDS` — comma-separated Discord user IDs allowed to use commands
     - `ALLOWED_ROLE_IDS` — comma-separated Discord role IDs allowed to use commands

4. Push the database schema:
   ```bash
   pnpm db:push
   ```

5. Start the bot:
   ```bash
   pnpm dev
   ```

6. Invite the bot to your server with the `applications.commands` scope.

If both `ALLOWED_USER_IDS` and `ALLOWED_ROLE_IDS` are empty, everyone in the guild can use bot commands.

## Commands

Player day play uses top-level slash commands. Storytellers use `/st …`. Guides: **`/game help`**, **`/st help`** (optional `search:`).

| Command | Description |
|---------|-------------|
| `/game setup` | Create a game with existing ST / player / kib roles |
| `/game help` | Player command guide (`search:` filters by name/description) |
| `/nominate` | Nominate a player |
| `/defend` | Add defense on an open nomination against you |
| `/vote` | Vote on an open nomination |
| `/roster` | Show seat order and alive/dead |
| `/role` | Look up a BotC character (`name:` fuzzy search) |
| `/st setup-town` | Set roster + seats from ordered @mentions |
| `/st broadcast` | Send the same message to every player ST thread (from kib) |
| `/st do` | Autocomplete ST actions (resolve, execute, next-phase, …) |
| `/st panel` | Pin/refresh kib control panel |
| `/st help` | Storyteller command guide (`search:` filters by name/description) |
| `/st guide setup` / `day` / `night` | Phase checklists |
| `/st remind` / `/st set-reminders` | Scheduled pings |

## Deploy to Railway

1. Connect this repo to [Railway](https://railway.app).
2. Set environment variables:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DATABASE_URL=file:/app/data/grimkeeper.db`
3. Attach a persistent volume mounted at `/app/data`.
4. Deploy using the included `Dockerfile` and `railway.toml`.

On first deploy, run `pnpm db:push` against the mounted database (Railway one-off command or local exec into the container).

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Mount a volume at `/app/data` for SQLite persistence (configured in `docker-compose.yml`).

### Admin UI on the droplet

Enable the `admin` compose profile (separate `Grimkeeper-admin` image + shared SQLite volume). Full steps: [`apps/admin/README.md`](apps/admin/README.md#production-droplet).

```bash
# In .env on the droplet:
# COMPOSE_PROFILES=admin
# ADMIN_IMAGE=ghcr.io/YOUR_GITHUB_USER/Grimkeeper-admin:latest  # optional; derived from GRIMKEEPER_IMAGE
# DISCORD_CLIENT_SECRET=...
# ADMIN_SESSION_SECRET=...
# ADMIN_OAUTH_CALLBACK_URL=https://admin.example.com/api/auth/callback/discord
# ALLOWED_USER_IDS=your_discord_user_id

pnpm docker:redeploy
```

## Grafana Cloud Logs (Free Tier)

This repository includes a `promtail` service that ships container logs to Grafana Cloud Loki.

1. Create a free Grafana Cloud account and Loki stack.
2. Get the **Loki push URL and User** (not the stack/datasource name):
   - In Grafana: **Connections** → **Data sources** → your **Loki** source → **Send logs**
   - Copy **URL** → `GRAFANA_CLOUD_LOKI_URL` (must end with `/loki/api/v1/push`)
   - Copy **User** → `GRAFANA_CLOUD_LOKI_USERNAME` (usually a **numeric** ID like `1265432`, **not** `grafanacloud-…-logs`)
3. Create an **Access Policy token** with `logs:write`:
   - At [grafana.com](https://grafana.com): **Security** → **Access Policies** → create policy scoped to your stack with **logs:write**
   - Create a token on that policy (starts with `glc_`) → `GRAFANA_CLOUD_LOKI_API_KEY`
   - Do **not** use a Grafana Service Account token or stack API key here — Promtail needs basic auth with the Loki User + access policy token.
4. Set all three in `.env`, then redeploy:
   ```bash
   sh scripts/docker.sh redeploy
   ```
5. Verify auth (on the server, substitute your values):
   ```bash
   curl -u 'USER:glc_...' -H 'Content-Type: application/json' \
     -X POST 'https://logs-prod-XXX.grafana.net/loki/api/v1/push' \
     --data-raw '{"streams":[{"stream":{"app":"test"},"values":[["'$(date +%s)000000000'","hello"]]}]}'
   ```
   A silent `200` or empty body means success; `401` means wrong User or token.
6. In Grafana **Explore**, query:
   ```
   {job="grimkeeper-bot"}
   ```

   Bot logs are JSON. After redeploying Promtail, filter by extracted labels:
   ```
   {job="grimkeeper-bot", msg="game.event"}
   {job="grimkeeper-bot", level="error"}
   ```

   For fields not promoted to labels (e.g. `event`, `gameId`, `phase`), parse in the query:
   ```
   {job="grimkeeper-bot", msg="game.event"} | json | event="NightStarted"
   {job="grimkeeper-bot"} | json | gameId="<uuid>"
   ```

   Third-party output (discordx boot, Prisma, Node warnings) is normalized as JSON with `msg` values like `external`, `prisma`, or `node.warning`:
   ```
   {job="grimkeeper-bot", msg="external"}
   {job="grimkeeper-bot", msg="prisma"}
   ```

   Seeing the raw JSON in the log line column is normal — use **| json** or the label filters above to search by field.

## Roadmap

- Event-sourced game engine
- discordx adapter
- Prisma + SQLite
- Replay & Grim Reveal
- Character plugins
