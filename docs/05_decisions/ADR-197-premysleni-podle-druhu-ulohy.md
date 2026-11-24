# ADR-197: Přemýšlení AI modelu podle druhu úlohy

Stav: **přijato** (v1.103.0) – navazuje na v1.102.2 (obecné vypnutí přemýšlení) a ADR-016 (abstrakce poskytovatele).

## Kontext

Modely s uvažováním (např. qwen3.5:35b-a3b na lokální Ollamě) odpovídají s přemýšlením řádově pomaleji. Verze 1.102.2
umožnila přemýšlení vypnout pro všechny dotazy najednou. V pilotním provozu je ale rozdíl mezi úlohami, kde uživatel
na odpověď čeká (dotaz, dokumentace), a analýzami, kde je kvalita důležitější než rychlost.

## Rozhodnutí

1. Dva druhy úloh (`AiTaskKind`): **`interactive`** – dotaz v přirozeném jazyce, Zeptej se dokumentace, odpověď nad
   záznamy, otázka SOC poradci; **`analysis`** – návrhy k záznamům (use cases), plán nápravy nálezů, rozbor
   zranitelnosti, rozbor a triáž alertu SOC, shrnutí bezpečnostních testů, vytěžení přehledu NÚKIB z PDF.
2. Nastavení `thinkingByTask` (`inherit` | `default` | `off` | `on`) pro každý druh; `inherit` = obecné nastavení
   `thinking`. Výsledek počítá sdílená funkce `effectiveThinking`.
3. `clientFor(s, config, fetch, kind)` – druh určuje volající. Volání bez druhu (test spojení, seznam modelů,
   embedding) používají obecné nastavení.

## Důsledky

- Bez migrace: chybějící `thinkingByTask` v uloženém nastavení = `inherit`, chování se po aktualizaci nemění.
- Nová místa volání modelu musí zvolit druh úlohy; jinak platí obecné nastavení.
