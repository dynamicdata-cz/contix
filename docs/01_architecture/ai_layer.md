# AI vrstva – doporučená architektura

AI v CONTIXu **není součástí core logiky natvrdo**. Je to samostatný modul (`modules/ai`), který volá stejné
služby jako UI a jehož výstupy jsou vždy **návrhy** ke schválení člověkem.

## Dva různé kontexty AI

1. **AI při vývoji** – Claude (Claude Code / Cowork) generuje a upravuje kód. Proto:
   - `AGENTS.md` v kořeni repa s pravidly projektu,
   - silné typování (TS strict, Zod, Drizzle) a testy (`bun test`) – AI dostává okamžitou zpětnou vazbu,
   - ADR a dokumentace v Markdownu – AI čte stejný kontext jako člověk.
2. **AI jako funkce produktu** – asistent uvnitř CONTIXu (níže).

## Funkce AI v produktu (návrh podle hodnoty)

| Funkce | Modul | Popis |
|---|---|---|
| Klasifikace aktiv | Asset | Návrh typu, kritičnosti a CIA podle názvu, OS, portů, softwaru, vazeb. |
| Detekce duplicit | Asset | Sémantická shoda záznamů, které heuristika (serial/MAC/hostname) nespojila. |
| Mapování import sloupců | Asset | Návrh mapování neznámého CSV/XLSX na pole CONTIXu. |
| Návrh vazeb | Process/Risk | "Tento proces pravděpodobně používá aktiva X, Y" / "k aktivu patří rizika …". |
| Mapování na normy | Control | Návrh, které kontroly pokrývají požadavky NIS2 / ISO 27001. |
| Sumarizace | Audit | Shrnutí zjištění, návrh nápravných opatření, reporty pro vedení. |
| Dotazy v přirozeném jazyce | vše | "Která kritická aktiva nemají vlastníka?" → dotaz přes API nástroje. |

## Stav implementace (v0.14)

- `modules/ai`: poskytovatel za rozhraním `createAiClient` – OpenAI-kompatibilní API (Open WebUI) a nativní Ollama;
  výchozí **lokální model `gpt-oss:20b`** (data neopouštějí organizaci). Nastavení v Administrace → AI asistent.
- Úlohy: návrh opatření pro zvládání rizika, mapování opatření na požadavky rámců. Detail: [modul AI](../03_modules/ai/overview.md),
  rozhodnutí [ADR-016](../05_decisions/ADR-016-ai-ops-soc2.md).
- `ai_suggestions` = návrh + auditní záznam (kontext, model, surová odpověď, rozhodnutí člověka).

## Technické řešení (cílový stav)

- **Model:** lokální model (Ollama) nebo Claude přes Anthropic API; abstrakce poskytovatele, aby šlo měnit poskytovatele.
- **Tool use:** AI nevolá SQL. Dostane sadu nástrojů (list_assets, get_asset, propose_classification…) definovaných Zod schématy z `@contix/shared` → převedené na JSON Schema.
- **MCP server (v0.20):** `POST /api/mcp` v API (ne samostatná aplikace) – read-only nástroje z katalogu `modules/ai/tools.ts`, osobní API tokeny uživatelů; stejný katalog používá i „Zeptat se AI“ (ADR-021).
- **Embeddingy:** `pgvector` v existující PostgreSQL (tabulka `embeddings` s odkazem na entitu) – pro vyhledávání v dokumentaci. Duplicity aktiv (v0.20) zatím řeší deterministická heuristika (ADR-021).
- **Asynchronní běh:** delší AI úlohy přes frontu (pg-boss), výsledky do tabulky `ai_suggestions` (entita, návrh, zdůvodnění, stav: navrženo/přijato/odmítnuto, kdo, kdy).

## Governance (AI Act / GDPR)

- Každý AI výstup se loguje (vstup, model, verze, výstup, rozhodnutí člověka) → auditní stopa.
- Human-in-the-loop: AI nikdy sama nemění řídicí atributy (kritičnost, vlastník, hodnocení rizik).
- Minimalizace dat: do modelu posílat jen potřebná pole; osobní údaje pseudonymizovat; volitelně "AI vypnuto" per tenant.
- Transparentnost v UI: návrhy AI jsou vizuálně odlišené a obsahují zdůvodnění.
- Vlastní vnitřní směrnice o používání AI se na CONTIX vztahuje také – modul AI má mít vlastní záznam v registru AI systémů.
