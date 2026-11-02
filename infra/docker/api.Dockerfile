# CONTIX API – Bun + Hono
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# hoisted: všechny závislosti v /app/node_modules (Bun 1.3+ jinak v workspace dává balíčky do node_modules
# jednotlivých aplikací, které se do runtime obrazu nekopírují → „Cannot find module drizzle-orm“)
RUN bun install --frozen-lockfile --production --linker=hoisted

FROM oven/bun:1 AS runtime
# nmap pro síťový discovery (lze vynechat, pokud sken poběží v samostatném collectoru)
RUN apt-get update && apt-get install -y --no-install-recommends nmap openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER bun
CMD ["sh", "-c", "bun src/db/migrate.ts && bun src/index.ts"]
