FROM node:24-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /app

# Deps layer: only files that affect pnpm-lock.yaml resolution.
# Docker reuses this layer until one of these files changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY ops/docker.npmrc .npmrc
COPY apps/bot/package.json apps/bot/
COPY packages/database/package.json packages/database/
COPY packages/engine/package.json packages/engine/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps apps/
COPY packages packages/

ENV DATABASE_URL=file:./packages/database/prisma/dev.db
RUN pnpm build

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/bot/node_modules ./apps/bot/node_modules
COPY --from=build /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=build /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=build /app/apps/bot/dist ./apps/bot/dist
COPY --from=build /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=build /app/packages/database/dist ./packages/database/dist
COPY --from=build /app/packages/database/package.json ./packages/database/package.json
COPY --from=build /app/packages/database/prisma.config.ts ./packages/database/prisma.config.ts
COPY --from=build /app/packages/database/prisma ./packages/database/prisma
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/package.json ./package.json

COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh

VOLUME ["/app/data"]
ENV DATABASE_URL=file:/app/data/grimkeeper.db

CMD ["./scripts/docker-entrypoint.sh"]
