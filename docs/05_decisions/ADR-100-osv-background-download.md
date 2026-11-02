# ADR-100: Stahování databáze OSV na pozadí

**Stav:** přijato (v1.04.1)

## Kontext

„Stáhnout nyní“ v CRA → Databáze OSV stahovalo a ukládalo ekosystémy uvnitř HTTP požadavku. PyPI nebo npm trvají
minuty (stažení all.zip, rozbalení, zápis stovek tisíc záznamů), takže požadavek ukončil server (Bun `idleTimeout`
10 s) nebo reverzní proxy. Uživatel viděl prázdnou chybu a nevěděl, jestli stažení proběhlo.

## Rozhodnutí

- `POST /api/cra/osv/refresh` jen spustí úlohu (`startOsvRefresh`) a vrátí **202**; souběžné spuštění = **409**.
- Souběh ručního spuštění, plánovače (`maybeRefreshOsv`) a více instancí hlídá lease `cra.osv.refresh` (TTL 3 h).
- Stav v nastavení `cra.osv`: `runningSince` (platí jen s platnou lease – pád serveru nenechá stav viset),
  `lastResult` (záznamy, shody, chyby po ekosystémech), `lastRunAt`, `lastError`.
- Audit `cra.osv_refreshed` se zapíše po dokončení s uživatelem, který stahování spustil.
- Web se během běhu dotazuje na stav (3 s) a po dokončení obnoví nálezy produktů.
- Klient API: přerušené spojení nebo odpověď bez textu nikdy nevrací prázdnou chybu (`err.network`, `HTTP <kód>`).

## Důsledky

Stahování může běžet libovolně dlouho, uživatel může stránku opustit. Nic se neodesílá – stále jen GET bucketu OSV.
