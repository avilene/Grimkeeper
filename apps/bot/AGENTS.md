# apps/bot — Agent Guide

Discord bot for Grimkeeper. Uses **discordx** (decorator-based command framework) on top of **discord.js**.

## Quick orientation

```
src/
  index.ts                 Entry point — Discord client setup, interaction router
  bot-mode.ts              Feature flag: MINIMAL_MIN_PLAYERS constant
  access.ts                Permission checks (ADMIN_IDS, ALLOWED_ROLE_IDS, etc.)
  discord-client.ts        Singleton bot client reference
  error-reporter.ts        Sentry + Discord error channel reporting
  logger.ts                Pino structured logging
  dev.ts                   DEV_MODE helpers

  commands/                Slash command handlers (discordx @Discord / @Slash decorators)
    command-context.ts     ← central file: game lookup, engine event dispatch, Discord channel ops
    action-catalog.ts      Map of /st do autocomplete actions → handler functions
    alias.ts               /alias command
    help-content.ts        /game help + /st help content
    help-pagination.ts     Button pagination for help embeds
    role.ts                /role character lookup
    st-queue.ts            /st queue commands
    st-reminders.ts        /st reminder* + /reminder /listreminders /clearreminders
    interest.ts            /interest create (interest-check posts)
    stats.ts               /stats command
    whisper.ts             /whisper command
    … (others)

  interactions/            Button / modal / select-menu handlers (not slash commands)
    day-vote.ts            Nominate / vote button + modal
    lock-votes.ts          Lock votes button
    st-panel.ts            ST control panel buttons and user-selects
    st-queue.ts            ST queue button / modal / select handlers
    interest.ts            Interest check button / modal handlers
    buffet-draft.ts        Sushi Buffet pick + mulligan buttons
    interaction-dedup.ts   Idempotency: prevent double-processing an interaction
    interaction-response.ts Helpers for defer / reply / edit
    early-defer.ts         Defer interactions immediately before async work

  game-status.ts           Pinned town-status embed builder + upsert
  day-thread.ts            Day/night voting thread management
  town-setup.ts            /st setup-town logic
  town-surfaces.ts         Kib, log, voting, whisper-decl thread management
  reminder-scheduler.ts    Cron-style reminder firing loop
  reminder-message.ts      Reminder Discord message builder
  seating-chart.ts         Seat-order embed
  st-control-panel.ts      ST kib control panel embed + refresh
  st-queue-board.ts        ST queue panel in a dedicated thread
  interest-post.ts         Interest check embed + button builders
  backpacker.ts            Game save/restore helpers
  load-commands.ts         Dynamic import of all command modules at startup
  discord-noms-refresh-scheduler.ts  Polls DB for pending Discord nomination refreshes
```

## Build & test

```bash
# From repo root:
pnpm --filter bot test      # vitest unit tests
pnpm --filter bot build     # tsc compile check

# Dev server (watches + pino-pretty):
pnpm dev
```

Tests live next to their source files as `*.test.ts`.

## Common change patterns

### Adding a new slash command

1. Create a file in `src/commands/` (or add to an existing one).
2. Import `Discord`, `Slash`, `SlashGroup`, `SlashOption` etc. from `discordx`.
3. Decorate a class method with `@Slash(...)`. discordx auto-discovers it via `loadCommandModules()` (dynamic import glob in `load-commands.ts`).
4. If the command writes game state, call `appendGameEvent()` + `syncGameProjectionFromEngine()` via helpers in `command-context.ts`.
5. Add vitest tests for any pure logic you extract.

### Adding a new button / modal interaction

1. Add a handler function in the relevant file under `src/interactions/`.
2. Call your handler in `index.ts` inside the `interactionCreate` block (the big if-chain).
3. Define the `customId` pattern in `src/interaction-ids.ts` (if one already exists for the feature area).

### Emitting a new engine event from the bot

The canonical pattern (from `command-context.ts`):

```ts
const events = await getGameEvents(game.id);
const engine = new GameEngine(events);
engine.apply({ type: GameEventType.YourEvent, gameId: game.id, timestamp: new Date().toISOString(), /* … */ });
await appendGameEvent(game.id, GameEventType.YourEvent, payload);
await syncGameProjectionFromEngine(game.id, engine);
```

### Modifying access control

`src/access.ts` — reads `ADMIN_IDS`, `ALLOWED_ROLE_IDS`, `ADMIN_ROLE_IDS`, `REMINDER_ROLE_IDS` from env.  
`canUseBot()` is the top-level gate. Most commands call it early.

## Key dependencies

| Package | Role |
|---------|------|
| `discordx` | Decorator-based slash command + interaction framework |
| `discord.js` | Low-level Discord API client |
| `@grimkeeper/engine` | Game state machine (pure, no I/O) |
| `@grimkeeper/database` | Prisma client, event store, projection helpers |
| `pino` | Structured JSON logging |
| `@sentry/node` | Error reporting |

## Environment variables consumed by the bot

| Variable | Required | Notes |
|----------|----------|-------|
| `DISCORD_TOKEN` | ✅ | Bot token |
| `DISCORD_CLIENT_ID` | ✅ | Application ID |
| `DATABASE_URL` | ✅ | SQLite path (`file:./…`) |
| `ADMIN_IDS` | optional | Comma-separated Discord user IDs with full access |
| `ALLOWED_ROLE_IDS` | optional | Comma-separated role IDs; if both empty, everyone can use bot |
| `ADMIN_ROLE_IDS` | optional | Role IDs that can view private ST threads |
| `REMINDER_ROLE_IDS` | optional | Role IDs that can manage channel reminders |
| `REMINDER_PING_ROLE_ID` | optional | Role pinged when channel reminders fire |
| `ST_QUEUE_THREAD_ID` | optional | Thread ID for the live ST queue panel |
| `ARCHIVE_CATEGORY_ID` | optional | Category for archived town channels |
| `ERROR_CHANNEL_ID` | optional | Discord channel for error notifications |
| `DEV_MODE` | optional | `true` enables `/dev` commands |
| `SENTRY_DSN` | optional | Sentry project DSN for the bot |

## Patterns to be aware of

- **Interaction dedup**: `tryMarkInteractionOnce()` in `interaction-dedup.ts` prevents two bot replicas from handling the same interaction. Always keep scale at 1 replica in production.
- **Early defer**: `startEarlyDefer()` in `early-defer.ts` defers the interaction immediately. If it returns `"failed"`, the handler should return early without replying.
- **ST command fallback**: When discordx can't resolve a command (stale deploy), `tryStCommandFallback()` catches it and replies with a helpful message.
- **Bot mode**: `bot-mode.ts` currently exports `MINIMAL_MIN_PLAYERS = 0` — the bot runs in a single "minimal" mode. The `botMode: "minimal"` key in logs reflects this.
