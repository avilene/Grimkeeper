# Upgrading from `prisma db push` to `prisma migrate`

The database package has switched from `prisma db push` to `prisma migrate` for automatic,
tracked schema migrations. The initial migration (`20260731063241_init`) captures the full
current schema (including the vote restructure from `choice`/`privateChoice` to `choice`/`isPrivate`).

## New installations

Fresh deployments automatically apply all migrations via `prisma migrate deploy` on startup.
No manual steps needed.

## Upgrading an existing deployment (previously managed by `db push`)

If your database was managed by `prisma db push` and already has the old Vote schema
(`choice` / `privateChoice` / `privateReason` columns), follow these steps **once**:

### 1. Migrate existing private vote data

Before applying the new schema, run the data migration script to preserve any private
ballot rows stored in the old `privateChoice` column:

```sh
pnpm --filter @grimkeeper/database db:migrate-votes
```

This reads existing `privateChoice` values and creates new `isPrivate = true` vote rows.
It is safe to run multiple times (idempotent).

### 2. Apply the new schema

If you haven't yet switched to migrations, apply the schema now (one-time use of `db push`
is fine for this step):

```sh
pnpm --filter @grimkeeper/database db:push
```

### 3. Baseline the database

Tell Prisma that the `init` migration has already been applied (since the schema was
previously managed by `db push`, not migrate):

```sh
cd packages/database
npx prisma migrate resolve --applied "20260731063241_init"
```

### 4. Verify

```sh
pnpm --filter @grimkeeper/database db:migrate:status
```

You should see the init migration listed as **Applied**.

From this point on, use `prisma migrate dev` (dev) and `prisma migrate deploy` (production)
for all future schema changes. The docker entrypoint runs `prisma migrate deploy` automatically
on each container startup.
