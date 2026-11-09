# Multi-stage build for the SimplyAI services (api, worker, web, migrate).
#   docker build -f docker/Dockerfile --target api -t simplyai-api .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && apt-get clean
WORKDIR /app

FROM base AS build
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_WS_URL=http://localhost:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:packages && pnpm --filter @simplyai/api build && pnpm --filter @simplyai/worker build
RUN NODE_ENV=production pnpm --filter @simplyai/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
RUN useradd --system --uid 1001 simplyai && mkdir -p /app/storage && chown -R simplyai /app/storage
USER simplyai
ENTRYPOINT ["/usr/bin/tini", "--"]

FROM runtime AS api
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

FROM runtime AS worker
CMD ["node", "apps/worker/dist/main.js"]

FROM runtime AS web
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["node_modules/.bin/next", "start", "-p", "3000"]

FROM runtime AS migrate
WORKDIR /app/packages/db
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/seed/run.js"]
