# ADR-059: Plánované hledání hrozeb

**Stav:** přijato (v0.64.0)

## Kontext
Wazuh vytváří alerty jen podle pravidel s dostatečnou úrovní; řada podezřelých vzorců (série neúspěšných přihlášení
z jedné adresy, kódovaný PowerShell, nové služby) se ve frontě SOC neobjeví. Analytik je umí najít dotazem, ale ruční
hledání se nedělá pravidelně.

## Rozhodnutí
- Tabulka `soc_hunts` (za společnost): název, hypotéza, dotaz `query_string` (Lucene), pole seskupení, práh, interval,
  „zpět o“, závažnost, techniky ATT&CK, zapnuto, šablona; `last_run` (poslední skutečný běh) a `window_end`.
- `runHunt` (`soc/hunts.ts`): dotaz do alertů Wazuh Indexeru (jen čtení, `size: 0`, agregace `terms` podle pole s
  `min_doc_count = práh`, nejvýše 50 skupin) nad oknem `window_end` → teď (první běh a po změně dotazu / pole
  „zpět o“). Skupina → alert `source = hunt`, `groupKey = hunt:<id>:<hodnota>`, úroveň podle `SEVERITY_LEVEL`,
  aktivum podle agenta; otevřený alert se stejným klíčem se jen navýší. Potlačení, expozice, korelace a upozornění
  stejně jako u ostatních zdrojů. Při chybě se okno neposouvá.
- Zkušební běh (`dryRun`) jen vrátí skupiny – nic neuloží a neposune okno.
- Plánovač `processHunts` v cyklu upozornění (po zdrojích hrozeb): hledání, kterým uplynul interval (`huntNextRun`).
- Knihovna `SOC_HUNT_TEMPLATES` (shared) pro alerty Wazuhu (Linux, Windows Security / Sysmon).
- Oprávnění: čtení `soc:read`, správa a spuštění `soc:write`; vše auditováno.

## Důsledky
- Dotazy závisí na polích dekodérů Wazuhu – šablony jsou výchozí bod, ladí se zkušebním během.
- Agregace `terms` vyžaduje pole typu keyword (v šabloně indexu Wazuhu jsou `data.*` a `agent.*` keyword).
