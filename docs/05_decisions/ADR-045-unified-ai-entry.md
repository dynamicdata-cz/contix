# ADR-045: Jednotný AI vstup na Přehledu

**Stav:** přijato (v0.50.0)

## Kontext
AI v CONTIXu měla tři oddělené vstupy: Zeptat se AI (čtecí nástroje nad daty, ADR-021), Zeptej se dokumentace (ADR-028)
a dotazy nad záznamy (ADR-044). Uživatel nemá rozhodovat, kam se zeptat – chce jedno pole na úvodní stránce.

## Rozhodnutí
- Jeden endpoint `POST /api/ai/queries` (asynchronní, výsledek v `ai_queries`). Při založení dotazu se z požadavku vyhodnotí
  oprávnění (`docVisibility`, `recordAccessFor`, rozsah společností) a na pozadí se dohledají zdroje (`sourceRetriever`):
  nejvýš 4 úseky platné dokumentace (je-li zapnuté Zeptej se dokumentace) a 4 záznamy (jsou-li zapnuté vektory záznamů),
  s minimálním skóre (sémanticky 0,35, podle slov 0,25).
- Plán: model vidí katalog nástrojů a **jen názvy** nalezených zdrojů; rozhodne, zda stačí zdroje (`calls: []`), nebo spustí
  i čtecí nástroje. Bez nástrojů a bez zdrojů platí dosavadní krátká odpověď.
- Odpověď: model dostane výsledky nástrojů (bez sloupců se jmény) a texty zdrojů očíslované [n]; cituje je. Uloží se
  `ai_queries.sources` (bez textu); po odpovědi jen citované (`citedSources`), bez citací všechny – jen když nebyly tabulky.
- UI: `AiEntryCard` na Přehledu (pole, rychlé dotazy podle oprávnění a modulů, „Co je po termínu?“ zvýrazněné při
  povinnostech po termínu, odpověď s odkazy, přehled použitých tabulek, odkaz na Zeptat se AI); Zeptat se AI zobrazuje
  citace a zdroje stejně (`AiAnswerText`, `AiSourceList`). `AiStatusDto.recordSearch`.
- Vše běží na lokálním modelu (bge-m3 + chat model v Open WebUI); do modelu nejdou jména osob ani nečitelné dokumenty.

## Důsledky
- Nový zdroj = větev v `sourceRetriever` + `AiQuerySource.kind` + popisek; vždy s kontrolou oprávnění v okamžiku dotazu.
- Prahy skóre jsou heuristika pro bge-m3; při jiném embedding modelu je může být nutné upravit.
