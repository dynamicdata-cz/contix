# ADR-047: SOC II – případy, lhůty SLA, potlačení falešných poplachů, statistika pravidel

**Stav:** přijato (v0.52.0)

## Kontext
Fronta SOC (ADR-046) pracuje s jednotlivými alerty. Analytik ale potřebuje vidět související alerty jako jeden případ,
mít hlídané lhůty převzetí a vyřešení (s upozorněním) a umět utlumit opakované falešné poplachy a poznat pravidla,
která je produkují.

## Rozhodnutí
- **Případy** `soc_cases` (kód `SOC-<seq>`), alert odkazuje `alert_suggestions.case_id`. Korelace `correlateAlerts`
  (po Wazuh synchronizaci a založení ručního alertu, zapínací `autoCases`, okno `correlationHours`): otevřený alert bez případu
  se připojí k otevřenému případu se stejným klíčem (hostitel = agent / aktivum, zdrojová IP) a aktivitou v okně; jinak ≥ 2 alerty
  se stejným klíčem tvoří nový automatický případ. Ruční případ z vybraných alertů, přidání / odebrání alertů.
- **Závažnost případu** se nepersistuje: `caseSeverity` = nejvyšší závažnost alertů, o stupeň výš při řetězci útoku podle
  **hlavní taktiky** každého alertu (nejranější v matici – technika s více taktikami sama řetězec netvoří): přihlašovací údaje +
  přístup / eskalace / laterální pohyb / exfiltrace / dopad; dopad nebo exfiltrace s další taktikou; ≥ 3 hlavní taktiky.
- Převzetí případu převezme jeho nepřevzaté alerty; uzavření uzavře otevřené alerty se stejným verdiktem; eskalace = jeden
  incident (`escalateAlert` pro první alert s názvem a technikami případu, ostatní se připojí k témuž incidentu).
- **Lhůty** `socSla` (počítá se při čtení) z nastavení `soc.settings` (převzetí v minutách, vyřešení v hodinách podle závažnosti);
  alert v případu se řídí případem. Povinnost `soc_sla` (`socSlaItems`) v týmovém přehledu, u přiděleného analytika
  v Moje povinnosti; po vypršení okamžité upozornění analytikům SOC (`soc:write`) e-mailem / Teams přes stávající `once`
  (bez duplicit, plánovač každých 15 minut).
- **Potlačení** `soc_suppressions`: pravidlo Wazuh povinné, hostitel a IP volitelné, platnost nejvýše rok (`validUntil`),
  zrušení místo mazání. Uplatní se v `syncAlerts` před založením alertu (`suppressGroup`, počítají se zásahy). Potlačení je
  druh výjimky `soc_suppression` (Výjimky, upozornění před koncem platnosti). Lze ho založit i při uzavření alertu
  jako falešný poplach / neškodný.
- **Statistika pravidel** `/soc/rule-stats` (agregace při čtení): alerty, události, eskalace, verdikty, podíl falešných
  poplachů, zásahy potlačení, doporučení `ruleAdvice` (doladit ≥ 80 % z ≥ 3 rozhodnutých, prověřit ≥ 50 %, užitečné při eskalaci).
- Wazuh skupina `authentication_failed` se mapuje na T1110.

## Důsledky
- Nový klíč korelace = `correlationKeys`; nové pravidlo řetězce = `caseSeverity` + popisek `SOC_LABELS.chain`.
- Lhůty jsou orientační (granularita plánovače 15 min); časy převzetí a vyřešení zůstávají v datech pro metriky.
- Rozšíření: vlastní playbooky, AI shrnutí případu, korelace podle uživatelského účtu, Teams výstraha jen pro kritické.
