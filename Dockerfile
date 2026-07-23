FROM node:24-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /app

# Deps layer: only files that affect pnpm-lock.yaml resolution.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY ops/docker.npmrc .npmrc
COPY apps/bot/package.json apps/bot/
COPY apps/admin/package.json apps/admin/
COPY packages/database/package.json packages/database/
COPY packages/engine/package.json packages/engine/
RUN echo "pnpm install (bot + admin workspace)..." \
  && pnpm install --frozen-lockfile --filter bot... --filter admin... --reporter=append-only

COPY tsconfig.base.json ./
COPY apps apps/
COPY packages packages/

ENV DATABASE_URL=file:./packages/database/prisma/dev.db
# Engine must build first — database imports `@grimkeeper/engine` types from dist/.
RUN pnpm --filter @grimkeeper/engine build \
  && pnpm --filter @grimkeeper/database build \
  && pnpm --filter bot build \
  && pnpm --filter admin build

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/bot/node_modules ./apps/bot/node_modules
COPY --from=build /app/apps/admin/node_modules ./apps/admin/node_modules
COPY --from=build /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=build /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=build /app/apps/bot/dist ./apps/bot/dist
COPY --from=build /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=build /app/apps/admin/dist ./apps/admin/dist
COPY --from=build /app/apps/admin/package.json ./apps/admin/package.json
COPY --from=build /app/packages/database/dist ./packages/database/dist
COPY --from=build /app/packages/database/package.json ./packages/database/package.json
COPY --from=build /app/packages/database/prisma.config.ts ./packages/database/prisma.config.ts
COPY --from=build /app/packages/database/prisma ./packages/database/prisma
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/package.json ./package.json

COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY scripts/wipe-db.sh ./scripts/wipe-db.sh
RUN chmod +x ./scripts/docker-entrypoint.sh ./scripts/wipe-db.sh

VOLUME ["/app/data"]
ENV DATABASE_URL=file:/app/data/grimkeeper.db
ENV GRIMKEEPER_SERVICE=bot

CMD ["./scripts/docker-entrypoint.sh"]
