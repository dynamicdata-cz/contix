# ADR-167: Kontrola vazeb – odpovědný útvar aktiva, štítky z katalogu, výběry s vyhledáváním (v1.74)

## Kontext

Kontrola vazeb mezi evidencemi ukázala tři druhy mezer:
1. **Vazba zapsaná textem**: odpovědný útvar aktiva byl volný text (`owner_name`) – nedal se vybrat ze struktury,
   filtrovat ani zobrazit u útvaru.
2. **Dvě cesty ke štítkům**: aktivum drží štítky v `assets.tags`, ale formulář je bral jako text oddělený čárkou –
   nové štítky nevznikaly v katalogu (stránka Štítky je neznala), překlepy vytvářely „Nis2“ vedle „NIS2“, detail
   aktiva neukazoval barvy katalogu a seznam aktiv štítky vůbec.
3. **Výběry bez vyhledávání**: funkce, útvary, osoby, opatření a další vazby byly nativní seznamy (u stovek položek
   nepoužitelné), výběr aktiva se rozbalil až po napsání dvou znaků.
Navíc tabulky s cizím klíčem na aktivum (certifikáty TLS, oprávnění z žádostí o přístup, návrhy rizik ze scénářů)
se v detailu aktiva neobjevovaly.

## Rozhodnutí

1. `assets.owner_unit_id` (FK na `org_units`, set null) – výběr `UnitSelect` jen ze společnosti aktiva (server ověří),
   text `owner_name` zůstává jako starší údaj; jednoznačná shoda názvu se přiřadí migrací i při založení / importu
   (`unitByName`). Seznam: filtr `ownerUnitId` včetně podřízených útvarů (rekurzivní CTE), `ownerUnitName`;
   Organizace: `assetCount` u útvaru s odkazem do seznamu.
2. Štítky aktiva vždy přes katalog: `canonicalTags` (POST / PATCH aktiva) založí chybějící a zapíše pravopis katalogu;
   formulář `TagInput`, detail `TagBar` (jako ostatní evidence), seznam štítky u názvu + filtr `tag`.
3. Výběry s vyhledáváním `components/combobox.tsx` (`Combobox`, `ComboMulti`): rozbalení klikem, filtrování bez
   diakritiky, skupiny, odsazení stromu a doplněk, klávesnice (šipky, Enter, Esc), `role="combobox"` / `listbox`.
   Nasazeno ve sdílených `UnitSelect`, `PositionSelect`, `PartyPicker`, `IdMultiSelect`, `AssetPicker` (rozbalení bez
   psaní, skupiny podle typu, hostname / IP) a nových `UserSelect` / `UserMultiSelect` – tím ve všech formulářích,
   které je používají. Odebrání čipu je `span role=button` (v `<label>` by klik na popisek aktivoval tlačítko).
4. Zpětné vazby aktiva: nové druhy `tls_endpoint`, `access_resource`, `scenario_proposal` (`BACKLINKS_FOR.asset`).

## Důsledky

- Testy e2e vybírají přes pomocné `choose` / `chooseFirst` (nativní select i výběr s vyhledáváním).
- Zbývající volné texty, které jsou záměrné nebo mají vazbu jinde: systémy kroku procesu (aktiva kroku mají vlastní
  výběr), tým hodnoticího cyklu, dodavatel AI systému (vazba na dodavatele je zvlášť), umístění aktiva (mapy
  a půdorysy mají vlastní umístění).
