# CONTIX – produktová vize

> Verze 0.2 · 28. 9. 2026 · nahrazuje technickou část zakládajícího dokumentu (viz [ADR-001](../05_decisions/ADR-001-tech-stack.md))

## Vize v jedné větě

**CONTIX propojuje procesy, aktiva, dokumentaci, rizika a kontroly do jedné moderní webové GRC platformy – s AI jako asistentem, ne jako černou skříňkou.**

## Rozšířená vize

CONTIX je webová GRC platforma pro řízení procesů, rizik, kontrol, auditů a aktiv. Propojuje procesní mapy,
odpovědnosti, dokumentaci a regulatorní požadavky (NIS2 / ZKB, ISO 27001, GDPR, AI Act, SOC 2) do jednoho řízeného celku.

CONTIX umožní:

- evidovat **aktiva** – ručně, automaticky (Wazuh, síťový sken) i importem z jiných nástrojů,
- evidovat **procesy** a jejich hierarchii, vytvářet procesní mapy (BPMN) a detailní kroky,
- ke každému procesu i kroku přiřazovat vlastníky, role, dokumentaci, systémy, aktiva, rizika a kontroly,
- budovat návazné GRC moduly **Risk, Control, Audit**,
- využít **AI** pro klasifikaci aktiv, návrhy vazeb, deduplikaci, sumarizaci a analytiku – vždy s lidským schválením.

## Co se oproti zakládajícímu dokumentu mění

| Oblast | Původně | Nově | Proč |
|---|---|---|---|
| Frontend | Next.js | **React + Vite (SPA)** | Interní aplikace za přihlášením nepotřebuje SSR; jeden serverový runtime méně. |
| Backend | Python / FastAPI | **Bun + Hono (TypeScript)** | Jeden jazyk v celém monorepu, sdílené typy a validace FE↔BE, rychlý start. |
| ORM / migrace | SQLAlchemy + Alembic | **Drizzle ORM + drizzle-kit** | Typově bezpečné SQL, migrace jako čisté SQL soubory v repu. |
| Validace | Pydantic | **Zod** (sdílený balíček `@contix/shared`) | Jedno schéma pro API, formuláře i AI tool-calling. |
| DB | PostgreSQL | **PostgreSQL 17 + pgvector** | pgvector připravuje sémantické vyhledávání pro AI bez další DB. |
| První modul | Process | **Asset** | Aktiva jsou základ pro rizika a kontroly; lze je rychle naplnit daty (Wazuh). |

Beze změny: modulární monolit, privátní monorepo, OIDC (Entra ID, Google), Docker/Podman, Caddy, Markdown + ADR v repu.

## Strategické principy

1. **Modulární monolit** – jeden deployment, jasné hranice modulů (`apps/api/src/modules/*`). Rozdělení na služby jen když to bude nutné.
2. **Zlatý záznam** – každé aktivum existuje jednou, i když ho známe z více zdrojů; zdroje se evidují v `asset_sources`.
3. **Stroj doplňuje fakta, člověk rozhoduje** – konektory aktualizují technické atributy; kritičnost, vlastníka, CIA, životní cyklus určuje člověk.
4. **AI-ready, ne AI-dependent** – AI je samostatná vrstva nad API (viz [ai_layer.md](../01_architecture/ai_layer.md)); aplikace funguje i bez ní.
5. **Bezpečnost od návrhu** – read-only účty ke zdrojům, allow-list pro skenování, auditní stopa běhů, žádná tajemství v repu.

## Moduly a pořadí

| # | Modul | Stav |
|---|---|---|
| 0 | **Administrace** – uživatelé, role, skupiny, SSO (Entra ID / AD), MFA, audit | ✅ v0.2 |
| 1 | **Asset** – primární/podpůrná aktiva, inventář, discovery, import | ✅ v0.2 |
| 1b | **Zranitelnosti a zastaralost** – CVE z Wazuhu, EOL, semafor, výjimky | ✅ v0.4 |
| 2 | Process – procesní karta, hierarchie, BPMN | návrh |
| 3 | Risk – registr rizik, hodnocení, vazba na aktiva a procesy | plán |
| 4 | Control – katalog kontrol, mapování na normy (ISO 27001, NIS2) | plán |
| 5 | Audit – plánování, zjištění, nápravná opatření | plán |
| 6 | AI asistent – klasifikace, návrhy vazeb, MCP server | plán |

Detailní plán: [roadmap.md](roadmap.md).
