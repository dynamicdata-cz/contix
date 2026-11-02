# ADR-001: Technologický stack – React + Bun (TypeScript end-to-end)

- **Stav:** přijato
- **Datum:** 2026-09-28
- **Nahrazuje:** technickou část zakládajícího dokumentu (Next.js + Python/FastAPI)

## Kontext

Zakládající dokument fixoval Next.js na frontendu a Python/FastAPI na backendu. Při zahájení vývoje bylo
rozhodnuto sjednotit stack na TypeScript s frontendem v Reactu a backendem na Bun. Projekt bude z velké části
vyvíjen s pomocí AI asistentů (Claude), takže záleží i na tom, jak dobře se v kódu orientuje AI.

## Rozhodnutí

| Vrstva | Volba |
|---|---|
| Runtime | **Bun 1.x** (runtime, package manager, test runner, bundler) |
| Backend framework | **Hono** – standardní Web API (Request/Response), middleware, RPC typy pro klienta |
| Validace / kontrakty | **Zod** v balíčku `packages/shared` – sdílí FE i BE |
| ORM / migrace | **Drizzle ORM + drizzle-kit** (PostgreSQL, driver `postgres.js`) |
| Databáze | **PostgreSQL 17 + pgvector** |
| Frontend | **React 19 + Vite + TypeScript** (SPA) |
| Routing / data | **TanStack Router + TanStack Query** |
| UI | **Tailwind CSS 4 + shadcn/ui** (komponenty se kopírují do repa) |
| Procesní mapy | **bpmn-js** (modul Process) |
| Auth | OIDC / OAuth 2.0 – Entra ID, Google (viz authentication.md) |
| Provoz | Docker / Podman, Docker Compose, **Caddy** jako reverse proxy + TLS |

## Proč

- **Jeden jazyk** – typy entit, validace a enumy jsou definované jednou (`@contix/shared`) a používá je API, formuláře i AI tool-calling. Méně chyb na hranici FE/BE.
- **AI-friendly** – TypeScript + Zod + Drizzle je silně typovaný, deklarativní a velmi rozšířený; AI asistenti v něm generují spolehlivý kód a typová kontrola odhalí chyby. Zod schémata lze přímo převést na JSON Schema pro AI nástroje (tool use / MCP).
- **Hono místo Elysia** – Hono běží na Bun, Node i Deno; kdyby Bun v provozu zklamal, přechod na Node je triviální. Elysia je rychlejší, ale váže nás na Bun.
- **Vite SPA místo Next.js** – CONTIX je interní aplikace za přihlášením, SEO ani SSR nepotřebuje. SPA + samostatné API = jednodušší provoz a jasné oddělení.
- **Drizzle** – SQL-like API, žádná "magie", migrace jako čitelné SQL soubory (vhodné pro audit a review).

## Důsledky

- (+) Rychlý vývoj, sdílené typy, jednoduchý toolchain (`bun install`, `bun test`, `bun run dev`).
- (+) Bun spouští TypeScript přímo, bez build kroku.
- (−) Python ekosystém (pandas, ML knihovny) není přímo k dispozici – pokud bude potřeba, vznikne samostatná služba (např. `apps/ai-worker` v Pythonu) za API.
- (−) Bun je mladší než Node – kompatibilitu hlídat v CI; Hono umožňuje fallback na Node.
- Riziko: TypeScript 7 (nativní kompilátor) je nový – při problémech s nástroji lze přejít na TS 5.x.
