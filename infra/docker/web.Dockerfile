# CONTIX Web – build React SPA, servíruje Caddy (zároveň reverse proxy na API)
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --linker=hoisted
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN cd apps/web && bunx vite build

FROM caddy:2-alpine
COPY infra/proxy/ /etc/caddy/
COPY --from=build /app/apps/web/dist /srv
