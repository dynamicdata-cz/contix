# ADR-042: Trendy a historie shody

**Stav:** přijato (v0.47.0)

## Kontext
Přehled a Zpráva pro vedení ukazovaly jen aktuální stav. Vedení i auditor potřebují vidět, zda se stav zlepšuje
(míra shody, rizika, zranitelnosti, povinnosti po termínu, výjimky).

## Rozhodnutí
- Tabulka `trend_snapshots` (společnost × měsíc `YYYY-MM`, unikátní): hodnoty ukazatelů jako JSON (`TREND_METRICS`
  + `compliance:<rámec>`). **Jeden snímek za měsíc** – snímek běžného měsíce se přepisuje (poslední stav), uzavřené měsíce se nemění.
- Hodnoty počítá `computeTrendValues` ze stejných zdrojů jako Zpráva pro vedení (`managementReport`), plus otevřené kritické
  a vysoké zranitelnosti a výjimky (`loadExceptions`) – jedna definice čísel pro zprávu i trend.
- Plánovač (lease) obnoví snímek běžného měsíce, je-li starší než 12 h; `GET /api/trends` chybějící snímek běžného měsíce pořídí hned.
  Snímky starší než 5 let se mažou; snímky jsou odvozená data – mažou se se společností.
- UI: malé násobky (jeden ukazatel = jeden čárový graf, jedna osa), změna proti předchozímu měsíci šipkou a slovem
  (zlepšení / zhoršení podle směru ukazatele, `trendChange`), tooltip, přepnutí na tabulku. Přehled (6 ukazatelů),
  Zpráva pro vedení (12 ukazatelů) a tisk / Word zprávy (posledních 6 měsíců).

## Důsledky
- Historie začíná nasazením verze 0.47 (zpětně se nedopočítává).
- Nový ukazatel = `TREND_METRICS` + `TREND_DIRECTION` + `TREND_LABELS` + výpočet v `computeTrendValues`.
