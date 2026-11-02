# Technická architektura

## Přehled

```
┌──────────────────────┐        ┌───────────────────────────────────────────────┐
│  Prohlížeč (React)   │  HTTPS │  Caddy (TLS, statické soubory, reverse proxy) │
└──────────┬───────────┘ ─────▶ └───────────┬───────────────────────────────────┘
           │ /api/*                          │
           ▼                                 ▼
┌──────────────────────────────────────────────────────────────┐
│  CONTIX API  (Bun + Hono) – modulární monolit                │
│  modules/assets · discovery · (process · risk · control ·    │
│  audit · ai)                                                 │
└───────┬──────────────────────┬───────────────────────────────┘
        │ Drizzle              │ konektory
        ▼                      ▼
┌──────────────┐   ┌─────────────────────────────────────────────┐
│ PostgreSQL   │   │ Wazuh Server API · nmap collector · importy │
│ + pgvector   │   │ (později: GLPI, Snipe-IT, Lansweeper, …)    │
└──────────────┘   └─────────────────────────────────────────────┘
```

## Struktura monorepa

```
contix/
├── apps/
│   ├── api/                  Bun + Hono API
│   │   ├── src/
│   │   │   ├── app.ts        složení modulů, middleware, error handling
│   │   │   ├── config.ts     konfigurace z ENV (validovaná Zodem)
│   │   │   ├── auth/         přihlášení, MFA, OIDC, session, oprávnění
│   │   │   ├── db/           schema.ts, client, migrate, seed
│   │   │   └── modules/
│   │   │       ├── admin/        uživatelé, role, skupiny, nastavení, audit log
│   │       ├── assets/       CRUD, třídy, vazby, filtrování, statistiky
│   │   │       └── discovery/    konektory, reconciliation, běhy
│   │   ├── drizzle/          SQL migrace (generuje drizzle-kit)
│   │   └── test/             unit + integrační testy (bun test)
│   └── web/                  React + Vite SPA
│       └── src/ (pages, components/ui, lib/api.ts)
├── packages/
│   └── shared/               Zod schémata, enumy, DTO, české popisky
├── docs/                     vize, architektura, datový model, moduly, ADR
├── infra/                    Dockerfile, Caddyfile, skripty
├── docker-compose.yml
└── AGENTS.md                 pravidla a kontext projektu (lidé i AI asistenti)
```

## Pravidla modulů

- Každý modul = složka v `apps/api/src/modules/<modul>/` s vlastním `routes.ts`; mountuje se v `app.ts`.
- Moduly spolu komunikují přes funkce/služby, ne přes HTTP. Cizí tabulky jiného modulu se nečtou napřímo, pokud to lze obejít službou.
- Veřejný kontrakt (vstupy/výstupy API) patří do `packages/shared`.
- Enumy jsou v `shared` jako `const` pole → používá je Zod, Drizzle (`pgEnum`) i UI.

## API konvence

- Prefix `/api`, JSON, názvy polí v camelCase, DB sloupce snake_case.
- Validace přes `@hono/zod-validator` → chyba 400 s popisem.
- Chyby: `{ "error": "zpráva" }`, HTTP kódy 400/401/403/404/409/413/500.
- Stránkování: `limit` + `offset`, odpověď `{ items, total, limit, offset }`.
- Dlouhé operace (discovery) vrací `202 { runId }` a stav se čte z `/api/discovery/runs/:id`.

## Provoz

| Prostředí | Jak |
|---|---|
| Vývoj | `docker compose up -d db` + `bun run dev` (API :3000, web :5173 s proxy na API) |
| Test/produkce | `docker compose --profile full up -d --build` (Caddy :8080 → web + API) |
| Alternativa | Podman / podman-compose se stejnými soubory |

Budoucí rozšíření: fronta úloh v PostgreSQL (pg-boss) pro discovery a AI úlohy, OpenTelemetry pro observabilitu,
zálohy DB (pg_dump / WAL archivace).
