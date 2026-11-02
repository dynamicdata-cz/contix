# ADR-074: Sledované rámce, režim společnosti a navigace

- Stav: přijato (v0.79)

## Kontext
Přehled a Opatření a shoda ukazovaly míru shody všech rámců (409, 410, ISO 27001, DORA, NIS2, SOC 2, ISO 9001), i když se na společnost nevztahují. Nová dceřiná společnost dostávala natvrdo režim vyšších povinností (409) a řada obrazovek měla výchozí rámec „cz409“ bez ohledu na režim.

## Rozhodnutí
- Rámce v rozsahu jen `frameworksInScope(regime, selected, assessed)` (`shared/frameworks`): zákon + vyhláška podle režimu (`decreeFor`) vždy, další rámce podle `settings.frameworks` (přepsatelné ve společnosti `overrides.frameworks`); `null` = automaticky rámce s posouzením, namapovaným opatřením nebo důkazem.
- `GET /controls/frameworks` vrací `inScope`; Přehled zobrazuje jen rámce v rozsahu, Opatření a shoda řadí rámce v rozsahu dopředu, ostatní jako „nesledováno“.
- Výchozí vyhláška ve webu jen přes `useDecree()` (`lib/regime.ts`), nikdy natvrdo `cz409`. Nová společnost přebírá režim nadřazené.
- Hodnota `null` v nastavení = výchozí (záznam v `app_settings` se smaže).
- Drobečková navigace `Breadcrumbs` (`components/breadcrumbs.tsx`) nad obsahem: cesta podle známých stránek + „Detail“, tlačítko Zpět (historie aplikace, jinak o úroveň výš).
- Systémové role pro provoz SOC a správu: `soc_l1`, `soc_l2`, `it_admin`, `privacy_officer` (vytvoří se při startu, existující role se stejným klíčem se nemění).
