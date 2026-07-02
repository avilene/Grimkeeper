# Grimkeeper

Discord-native storyteller assistant for Blood on the Clocktower.

## Architecture

```
Discord -> Adapter -> Engine -> Events -> Projections -> Persistence
```

- **apps/bot** — discordx adapter (slash commands)
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

## Storyteller commands

| Command | Description |
|---------|-------------|
| `/game create` | Start a new game in the current channel |
| `/game join` | Join the lobby |
| `/game start` | Deal roles and begin night 1 (min 5 players) |
| `/game night` | Advance to the next night |
| `/game day` | Advance to the next day |
| `/game end` | End the game and record the winner |
| `/game grim-reveal` | Show end-of-game role reveal |

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

## Roadmap

- Event-sourced game engine
- discordx adapter
- Prisma + SQLite
- Replay & Grim Reveal
- Character plugins
