# Grimkeeper — Agent Guide

> Quick orientation for AI agents working in this repository.

## Monorepo structure

```
apps/
  bot/        Discord bot (discordx + discord.js)
  admin/      Next.js admin UI (App Router + shadcn/ui)
packages/
  engine/     Pure event-sourced game engine (no Discord, no DB deps)
  database/   Prisma client + SQLite projections + DB helpers
```

Package manager: **pnpm workspaces** (`pnpm-workspace.yaml`).  
Node requirement: **>=24**.

## Key commands (run from repo root)

| Purpose | Command |
|---------|---------|
| Install all deps | `pnpm install` |
| Run all tests | `pnpm test` |
| Build everything | `pnpm build` |
| Run bot in dev | `pnpm dev` |
| Run admin in dev | `pnpm admin:dev` |
| Push DB schema | `pnpm db:push` |
| Regen Prisma client | `pnpm db:generate` |

Filter to a single workspace:

```bash
pnpm --filter bot test
pnpm --filter @grimkeeper/engine test
pnpm --filter @grimkeeper/database build
pnpm --filter admin build
```

## Architecture data-flow

```
Discord slash command / button
  └─► apps/bot (discordx handler)
        └─► appendGameEvent()          ← packages/database
              └─► GameEngine.apply()   ← packages/engine
                    └─► syncGameProjectionFromEngine()  ← packages/database
```

**apps/admin** writes **directly** to Prisma projection tables (bypasses the engine).  
That is intentional but risky — prefer bot commands for normal play.

## Cross-cutting change checklist

### Adding a new engine event type
1. Add the constant to `packages/engine/src/event-types.ts`.
2. Add the event interface and handle it in `packages/engine/src/index.ts` (`GameEngine.apply()`).
3. Update `packages/database/src/sync-projection.ts` if the event affects a Prisma projection column.
4. Add/update the bot command or interaction that emits it (`apps/bot/src/commands/` or `apps/bot/src/interactions/`).
5. Update admin form or server action if the field is editable in the UI (`apps/admin/actions/`, `apps/admin/app/`).
6. Add engine tests in `packages/engine/src/*.test.ts`.

### Adding a new Prisma model or column
1. Edit `packages/database/prisma/schema.prisma`.
2. Run `pnpm db:push` (dev) or create a migration.
3. Run `pnpm db:generate` to regenerate the Prisma client.
4. Add DB helper functions in `packages/database/src/` and export from `packages/database/src/index.ts`.
5. Wire up any bot command that reads/writes the new data.
6. Add admin form/action if the field should be editable in the UI.

### Adding a new bot slash command
See `apps/bot/AGENTS.md`.

### Adding a new admin page or server action
See `apps/admin/AGENTS.md`.

## Environment variables

All variables live in a single `.env` at the repo root (both bot and admin read from it).  
See `.env.example` for the full list with comments.  
Required for the bot: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL`.  
Required additionally for admin: `DISCORD_CLIENT_SECRET`, `ADMIN_SESSION_SECRET`, `ADMIN_OAUTH_CALLBACK_URL`.

## Testing

- **packages/engine** and **packages/database** have vitest unit tests. Run with `pnpm test` or per-package.
- **apps/bot** also has vitest tests (`pnpm --filter bot test`).
- **apps/admin** has no test suite — validate with `pnpm --filter admin build`.
- No end-to-end test suite exists yet.

## Packages that change together

`apps/bot` and `apps/admin` both depend on `@grimkeeper/engine` and `@grimkeeper/database`.  
Any change to engine types or Prisma schema will **usually** require matching updates in both apps.  
Check `packages/engine/src/index.ts` exports and `packages/database/src/index.ts` exports when hunting for callers.
