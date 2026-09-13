FROM node:24.20.0-bookworm-slim AS builder
WORKDIR /app
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/pnpm/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PATH=/pnpm:$PATH \
    HOME=/home/node
ARG NEXT_PUBLIC_BASE_PATH=
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
RUN mkdir -p /pnpm \
    && corepack enable \
    && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/date-utils/package.json ./packages/date-utils/
COPY packages/meta/package.json ./packages/meta/
COPY packages/analytics/package.json ./packages/analytics/

RUN package_manager=$(node -p "require('./package.json').packageManager") \
    && corepack prepare "$package_manager" --activate \
    && pnpm install --frozen-lockfile --filter "@mf-dashboard/web..." --ignore-scripts \
    && pnpm rebuild --pending --filter "@mf-dashboard/web..."

COPY . .

# Runtime dashboard pages wait for an incoming request before reading the mounted DB.
RUN cd apps/web && ./node_modules/.bin/next build

FROM node:24.20.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=8765 \
    HOME=/home/node

RUN mkdir -p /app/data \
    && chown node:node /app/data

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public

USER node

EXPOSE 8765
CMD ["node", "apps/web/server.js"]
