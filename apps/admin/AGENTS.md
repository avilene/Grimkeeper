# apps/admin — Agent Guide

Next.js (App Router) admin UI for Grimkeeper. Uses **shadcn/ui** (zinc dark), **Auth.js** Discord OAuth, and **Prisma** for data access.

> **Important:** admin writes directly to Prisma projection tables — it does **not** append engine events. Changes made here can drift from the event log. Prefer bot commands for normal play.

## Quick orientation

```
app/                        Next.js App Router pages
  layout.tsx                Root layout (auth gate, sidebar nav)
  page.tsx                  Root redirect → /games or /stats based on role
  global-error.tsx          Sentry error boundary
  login/                    Login page
  games/
    page.tsx                Game list
    [id]/page.tsx           Game detail + player edit form
    record/page.tsx         Record a completed game (admin only)
  queues/
    page.tsx                ST queue boards list
    entries/[id]/page.tsx   Queue entry + members edit
  reminders/page.tsx        Global reminders list
  aliases/page.tsx          Player aliases
  guild-settings/
    page.tsx                Guild settings list
    [guildId]/page.tsx      Edit guild settings
  stats/page.tsx            Player stats (all signed-in users)
  healthz/page.tsx          Liveness endpoint
  api/                      Auth.js route handler

actions/                    Next.js server actions (mutations from forms)
  games.ts                  Create/update/delete game + player writes
  queues.ts                 Queue board/entry/member mutations
  reminders.ts              Reminder CRUD
  aliases.ts                Player alias upsert
  guild-settings.ts         Guild settings upsert
  auth.ts                   Sign-in / sign-out actions

lib/
  auth.ts                   Auth.js config (Discord provider, session/JWT helpers)
  access.ts                 Role-based access helpers (isAdmin, isStoryteller, etc.)
  db.ts                     Re-exports `prisma` client
  env.ts                    Validated env variable accessors
  session.ts                Auth.js session utilities
  discord-member.ts         Discord REST API helpers (fetch guild member roles)
  flash.ts                  Flash message cookie helpers
  action-result.ts          Typed server action return wrapper
  datetime.ts               Date formatting helpers
  sentry.ts                 Sentry server-side init
  utils.ts                  `cn()` className helper (clsx + tailwind-merge)

components/                 Shared UI components (shadcn/ui primitives + custom)
types/                      TypeScript type augmentations (next-auth session)
```

## Build & test

```bash
# From repo root:
pnpm --filter admin build   # next build (also validates TypeScript)

# Dev server:
pnpm admin:dev              # next dev on port 3847
```

Admin has no unit test suite. Use `pnpm --filter admin build` as the validation step.

## Common change patterns

### Adding a new admin page

1. Create `app/<route>/page.tsx` (server component).
2. Wrap with the auth gate — check `lib/access.ts` helpers (`requireAdmin()`, `requireStoryteller()`, etc.) at the top of the server component.
3. If the page has forms, create the matching server action(s) in `actions/<area>.ts`.
4. Add a nav link to `app/layout.tsx` if it should appear in the sidebar.

### Adding a new server action (mutation)

1. Add an `async function` with `"use server"` (or at the top of the actions file) in `actions/<area>.ts`.
2. Re-validate auth inside the action (`requireAdmin()` or similar) — never trust client-side auth alone.
3. Use `prisma` from `lib/db.ts` for DB writes.
4. Return an `ActionResult` from `lib/action-result.ts` for consistent error surfacing.
5. Call the action from the form using `useFormState` / `useActionState` or direct invocation.

> After queue writes, remind the user to run `/st queue refresh` in Discord to sync the bot panel.

### Adding a new editable field that also has a bot command

When a game field can be changed from both the admin UI and the bot:
- **Bot path**: emits an engine event → `syncGameProjectionFromEngine()` updates Prisma.
- **Admin path**: writes directly to the Prisma `Game` or `Player` table via `actions/games.ts`.

Both paths must write the same column(s). Check `packages/database/src/sync-projection.ts` to see what `syncGameProjectionFromEngine` touches, and mirror any new columns in the admin server action.

### Modifying access control

`lib/access.ts` — three role tiers:
- **Admin**: Discord user ID in `ADMIN_IDS`.
- **Storyteller**: user holds the game's `Game.stRoleId` Discord role, **or** is listed as an engine storyteller in the event log.
- **Player**: any authenticated user (can access `/stats`).

Role checks use the Discord bot token (`DISCORD_TOKEN`) to fetch guild member roles via `lib/discord-member.ts`.

## Key dependencies

| Package | Role |
|---------|------|
| `next` (App Router) | Framework |
| `next-auth` (Auth.js v5 beta) | Discord OAuth session management |
| `@grimkeeper/database` | Prisma client + projection helpers |
| `@grimkeeper/engine` | Game state types (read-only in admin) |
| `@radix-ui/*` | Accessible UI primitives |
| `tailwindcss` + `class-variance-authority` | Styling |
| `@sentry/nextjs` | Error reporting (separate DSN from the bot) |

## Environment variables consumed by admin

| Variable | Required | Notes |
|----------|----------|-------|
| `DISCORD_CLIENT_ID` | ✅ | Shared with bot |
| `DISCORD_CLIENT_SECRET` | ✅ | Discord OAuth2 client secret |
| `ADMIN_SESSION_SECRET` | ✅ | Auth.js JWT secret (also `AUTH_SECRET`) |
| `ADMIN_OAUTH_CALLBACK_URL` | ✅ | Public callback URL for Discord OAuth |
| `DATABASE_URL` | ✅ | SQLite path (shared with bot) |
| `DISCORD_TOKEN` | ✅ | Bot token — used to fetch guild member roles for ST checks |
| `ADMIN_IDS` | optional | Comma-separated Discord user IDs with full admin access |
| `AUTH_URL` | optional | Explicit origin; defaults to origin of `ADMIN_OAUTH_CALLBACK_URL` |
| `ADMIN_SENTRY_DSN` | optional | Sentry project DSN (separate from bot DSN) |
| `ADMIN_HOST_PORT` | optional | Host port for Docker (default 3847) |
| `ADMIN_BIND` | optional | Bind address (default 0.0.0.0) |
| `ADMIN_COOKIE_SECURE` | optional | `true` when serving over HTTPS |

## Auth flow

1. User visits any protected page → redirected to `/login`.
2. `/login` → Auth.js `/api/auth/signin/discord` → Discord OAuth.
3. Discord redirects to `ADMIN_OAUTH_CALLBACK_URL` → Auth.js sets a JWT cookie.
4. `lib/access.ts` checks `ADMIN_IDS` or Discord role membership for elevated permissions.

**Anyone with a Discord account can sign in.** `ADMIN_IDS` controls who gets admin tools.

## Routes reference

| Method | Path | Auth required | Admin only |
|--------|------|--------------|------------|
| GET | `/login` | no | — |
| GET/POST | `/api/auth/*` | no | — |
| GET | `/` | yes | no |
| GET | `/stats` | yes | no |
| GET | `/games` | yes | no (ST sees own games) |
| GET | `/games/[id]` | yes | no (ST for that game) |
| GET | `/games/record` | yes | yes |
| GET | `/queues` | yes | yes |
| GET | `/queues/entries/[id]` | yes | yes |
| GET | `/reminders` | yes | yes |
| GET | `/aliases` | yes | yes |
| GET | `/guild-settings` | yes | yes |
| GET | `/guild-settings/[guildId]` | yes | yes |
| GET | `/healthz` | no | — |

Mutations are handled by Next.js server actions (POST from forms in the pages above).

## Notes

- Keep **exactly one** bot replica running alongside admin (`docker compose ps`).
- After editing ST queue data in admin, run `/st queue refresh` in Discord to sync the bot panel.
- The Prisma client is generated into `packages/database/src/generated/` — run `pnpm db:generate` after schema changes, then rebuild admin.
- Source maps are uploaded to Sentry during Docker/`next build` when `SENTRY_AUTH_TOKEN` is set (GitHub Actions secret).
