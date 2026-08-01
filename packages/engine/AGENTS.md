# packages/engine — Agent Guide

Pure event-sourced Blood on the Clocktower game engine. **No Discord dependency. No database dependency.** All inputs and outputs are plain TypeScript values.

## Quick orientation

```
src/
  index.ts          GameEngine class + all event interfaces + public API (large file ~3000 lines)
  command-kinds.ts  GameCommandKind enum — the named actions a storyteller can invoke
  event-types.ts    GameEventType enum — every event that can be stored
  buffet-draft.ts   Sushi Buffet role-draft logic (stateless functions + types)
  plugins/
    index.ts        Plugin registry
    trouble-brewing/  Character ability definitions for the Trouble Brewing edition
  scripts/
    index.ts        Script/edition helpers (StandardEdition, formatScriptRoleName, resolveStandardScript)
```

## Build & test

```bash
# From repo root:
pnpm --filter @grimkeeper/engine test   # vitest

# Or inside the package:
cd packages/engine
pnpm test
```

Tests live next to source as `*.test.ts` (e.g. `buffet-draft.test.ts`, `index.test.ts`).

## Key concepts

- **GameEngine**: constructed from an ordered array of `StoredGameEvent[]`. Calling `engine.apply(event)` transitions state **in memory only** — the caller is responsible for persisting the event via `appendGameEvent()` in `@grimkeeper/database`.
- **Event log is the source of truth**: projection tables in Prisma are derived. The engine never reads from the DB.
- **Immutable apply**: `engine.apply()` mutates the engine's internal state. To replay from scratch, construct a new `GameEngine(events)`.
- **Plugins**: character abilities (e.g. Trouble Brewing) are registered as plugins. They influence what actions are legal and how night-order resolves.

## Common change patterns

### Adding a new event type

1. Add the constant to `src/event-types.ts`.
2. Define the event interface in `src/index.ts` (extends `GameEventBase`).
3. Add a `case` branch in `GameEngine.apply()` inside `src/index.ts`.
4. Export the new interface from `src/index.ts`.
5. Update `packages/database/src/sync-projection.ts` if the event should update a Prisma projection column.
6. Add vitest tests in `src/index.test.ts` or a dedicated `*.test.ts`.

### Adding a new command kind

1. Add the constant to `src/command-kinds.ts`.
2. Add handler logic in `GameEngine.executeCommand()` inside `src/index.ts` (emits one or more events).
3. Wire up the bot command that calls it in `apps/bot/src/commands/`.

### Adding a character plugin

1. Create a directory under `src/plugins/` (see `trouble-brewing/` for reference).
2. Export the plugin from `src/plugins/index.ts`.
3. Register it in the plugin registry.

## Public API surface (exported from `src/index.ts`)

- `GameEngine` class — `constructor(events)`, `apply(event)`, `getState()`, `executeCommand(kind, args)`
- `GameEngineError` — thrown on illegal state transitions
- All event interfaces (`GameCreatedEvent`, `PlayerAddedEvent`, …)
- `GameEventType` (re-exported from `event-types.ts`)
- `GameCommandKind` (re-exported from `command-kinds.ts`)
- Buffet draft types and functions
- `isFakePlayer()`, `formatScriptRoleName()`, etc.

## What NOT to add here

- No Discord API calls
- No Prisma / database imports
- No `process.env` reads (the engine must be deterministic and environment-agnostic)
