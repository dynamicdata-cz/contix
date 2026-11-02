# ADR-003: AI jako samostatná vrstva s human-in-the-loop

- **Stav:** přijato; první implementace v0.14 – viz [ADR-016](ADR-016-ai-ops-soc2.md) (lokální model jako výchozí)
- **Datum:** 2026-09-28

## Rozhodnutí

- AI je modul `ai` nad existujícími službami; core logika na AI nezávisí.
- Přístup k datům výhradně přes typované nástroje (Zod → JSON Schema), ne přes volné SQL.
- Výstupy AI = návrhy v `ai_suggestions`, které schvaluje člověk; vše se loguje.
- Primární poskytovatel Claude (Anthropic API) za rozhraním `AiProvider`; embeddingy v `pgvector`.
- CONTIX vystaví MCP server pro napojení na Claude / Cowork.

## Proč

Soulad s AI Act (transparentnost, lidský dohled, záznamy), auditovatelnost pro GRC a možnost AI vypnout
nebo vyměnit poskytovatele bez zásahu do jádra.

Detail: [ai_layer.md](../01_architecture/ai_layer.md).
