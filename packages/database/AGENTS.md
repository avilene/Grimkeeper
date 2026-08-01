# packages/database — Agent Guide

Prisma client, SQLite event store, and projection helpers for Grimkeeper.

## Quick orientation

```
prisma/
  schema.prisma       Prisma schema (models: GameEvent, Game, Player, Reminder, …)
  migrations/         Migration history

src/
  client.ts           Prisma client singleton
  index.ts            Public API — re-exports + top-level game/event helpers
  sync-projection.ts  syncGameProjectionFromEngine() — replay events → update Prisma Game+Player rows
  record-completed-game.ts  Record a stats-only game (no live Discord game)
  player-stats.ts     Aggregate player role history, win rates, alignment breakdown
  storyteller-access.ts    Query which games a user STs (engine events + Discord role)
  reminders.ts        Reminder CRUD + claim-and-fire helpers
  player-alias.ts     Player alias upsert / resolve
  whispers.ts         Game whisper thread tracking
  st-queue.ts         ST queue boards, entries, and members
  guild-settings.ts   Per-guild config (archive category, etc.)
  discord-noms-refresh.ts  Async flag table: request Discord nomination refresh from bot
  logging.ts          Prisma query logging adapter
  backfill-winners.ts One-time backfill script helper
  migrate-votes.ts    One-time vote migration helper
```

## Build & test

```bash
# From repo root:
pnpm --filter @grimkeeper/database test    # vitest
pnpm --filter @grimkeeper/database build   # tsc compile check

# Schema changes:
pnpm db:push        # push schema changes to dev DB (no migration file)
pnpm db:generate    # regenerate Prisma client after schema change
```

Tests live next to source as `*.test.ts`.

## Key concepts

- **Event store**: `GameEvent` table stores every engine event as a JSON payload with a sequential `seq` per game.
- **Projection tables**: `Game` and `Player` tables are derived views — rebuilt by `syncGameProjectionFromEngine()` after every bot command. They exist for fast queries (admin UI, stats) without replaying the full event log.
- **`appendGameEvent()`**: the canonical write path. Inserts an event and returns it. Does **not** sync projections — callers must call `syncGameProjectionFromEngine()` separately.
- **`syncGameProjectionFromEngine(gameId, engine)`**: replays all events for a game and writes the result to the `Game` + `Player` projection tables. Called after every bot command that mutates game state.

## Common change patterns

### Adding a new Prisma model or column

1. Edit `prisma/schema.prisma`.
2. Run `pnpm db:push` (dev) or create a named migration for production.
3. Run `pnpm db:generate` to regenerate the client.
4. Export any new helper functions from `src/index.ts`.
5. Update `src/sync-projection.ts` if the column should be populated from engine state.

### Adding a new DB helper function

1. Add the function to the relevant file in `src/` (or create a new file).
2. Export it from `src/index.ts`.
3. Add vitest tests in a `*.test.ts` file next to the source.

### Updating sync-projection

`syncGameProjectionFromEngine()` in `src/sync-projection.ts`:
- Calls `engine.getState()` to read current game state.
- Upserts the `Game` row.
- Upserts each `Player` row.
- When you add a new engine event that changes game state, add the matching Prisma upsert logic here.

## Prisma client location

The generated client lives in `src/generated/prisma/`. It is checked in (or rebuilt by `pnpm db:generate`). Import types from `./generated/prisma/client.js` within this package; external packages import via `@grimkeeper/database`.

## What NOT to add here

- No Discord API calls
- No `process.env` reads beyond `DATABASE_URL` (already handled by Prisma)
- No engine logic — keep game rules in `@grimkeeper/engine`
