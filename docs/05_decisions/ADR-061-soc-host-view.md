# ADR-061: Pohled SOC na hostitele

**Stav:** přijato (v0.66.0)

## Kontext
Analytik při vyšetřování potřebuje vidět vše o jednom stroji: dřívější alerty, jejich průběh v čase, zranitelnosti,
shody s IOC, navázané incidenty a rizika i zadané úkoly a zásahy. Data jsou rozprostřená v několika evidencích.

## Rozhodnutí
- Hostitel = aktivum (klíč `a:<id>`); alerty bez aktiva se seskupí podle krátkého jména agenta (`h:<jméno>`, malá písmena,
  bez domény – stejně jako `shortHost` v discovery). Klíče jen `hostKeyOf` / `parseHostKey` (`shared/socHosts.ts`).
- `GET /soc/hosts` (seznam za období nebo s otevřenými alerty, řazení podle otevřených a závažnosti `effLevelSql`)
  a `GET /soc/hosts/:key` (detail) v `soc/hosts.ts` – jen čtení, vše se počítá při čtení.
- Detail respektuje oprávnění: zranitelnosti jen `assets:read`, incidenty jen `incidents:read` a modul, rizika přes `linkedRisks`.
  Aktivita v čase `hostDaily` (dny UTC podle prvního výskytu alertu).
- UI: záložka SOC **Hostitelé**, stránka `/soc/hosts/$hostKey`, odkaz z detailu alertu a tlačítko na detailu aktiva.

## Důsledky
- Agent přejmenovaný mezi doménami se sloučí podle krátkého jména; dva různé stroje se stejným krátkým jménem bez aktiva
  se zobrazí společně – řešením je spárovat agenta s aktivem.
