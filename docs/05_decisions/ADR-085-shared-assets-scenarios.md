# ADR-085: Sdílená aktiva holdingu a scénář s více hrozbami a zranitelnostmi

**Stav:** přijato (v0.89)

## Kontext
Společné aktivum holdingu (ERP, datové centrum) bylo dosud vidět jen ve vlastní společnosti a v jejích dceřiných (výběr vazeb `withGroup`); sesterské společnosti ho nemohly použít v rizicích ani BIA. Rizikový scénář měl jen jednu hrozbu a jednu zranitelnost.

## Rozhodnutí
- `asset_companies (asset_id, company_id)`: aktivum zůstává ve vlastní společnosti (`assets.company_id`), sdílené společnosti ho vidí (`sharedInto`, `assetVisible`) v seznamu aktiv, ve výběrech vazeb a v detailu jen pro čtení (`ownedHere`, `canEdit`, `canShare`). Sdílení nastavuje jen vlastní společnost (`PUT /assets/:id/companies`, assets:write ve vlastní společnosti, cílové společnosti z `scope.accessible`).
- `risk_catalog_links (risk_id, catalog_id)`: další hrozby a zranitelnosti scénáře; hlavní zůstávají v `risks.threat_id` / `weakness_id` (zpětná kompatibilita, katalogové vazby, AI). API `moreThreatIds` / `moreWeaknessIds` (undefined = beze změny), DTO `moreThreatNames` / `moreWeaknessNames`. Návrh dopadu bere C/I/A ze všech hrozeb; registr rizik je vypisuje; filtr podle hrozby a kontrola použití položky katalogu zahrnují i další položky.
