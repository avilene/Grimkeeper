# Build context: monorepo root (see docker-compose admin.build).
FROM node:24-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /app

# Deps layer: only files that affect pnpm-lock.yaml resolution.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY ops/docker.npmrc .npmrc
COPY apps/admin/package.json apps/admin/
COPY packages/database/package.json packages/database/
COPY packages/engine/package.json packages/engine/
RUN echo "pnpm install (admin workspace)..." \
  && pnpm install --frozen-lockfile --filter admin... --reporter=append-only

COPY tsconfig.base.json ./
COPY apps/admin apps/admin/
COPY packages packages/

ENV DATABASE_URL=file:./packages/database/prisma/dev.db
# Engine must build first — database imports `@grimkeeper/engine` types from dist/.
RUN pnpm --filter @grimkeeper/engine build \
  && pnpm --filter @grimkeeper/database build \
  && pnpm --filter admin build

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Next.js standalone (+ static assets + workspace native SQLite deps).
# Root node_modules is required so pnpm symlinks under packages/*/node_modules resolve
# (better-sqlite3 lives in node_modules/.pnpm/...).
COPY --from=build /app/apps/admin/.next/standalone ./
COPY --from=build /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/database/dist ./packages/database/dist
COPY --from=build /app/packages/database/package.json ./packages/database/package.json
COPY --from=build /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Ensure Node can resolve the workspace package by name from the admin app.
RUN mkdir -p ./node_modules/@grimkeeper \
  && ln -sfn ../../packages/database ./node_modules/@grimkeeper/database \
  && ln -sfn ../../packages/engine ./node_modules/@grimkeeper/engine \
  && test -f ./packages/database/node_modules/better-sqlite3/package.json \
  && test -e ./packages/database/node_modules/better-sqlite3/build/Release/better_sqlite3.node

COPY scripts/admin-entrypoint.sh ./scripts/admin-entrypoint.sh
RUN chmod +x ./scripts/admin-entrypoint.sh

VOLUME ["/app/data"]
ENV DATABASE_URL=file:/app/data/grimkeeper.db
ENV PORT=3847
ENV HOSTNAME=0.0.0.0

EXPOSE 3847
CMD ["./scripts/admin-entrypoint.sh"]
