# ADR-033: Hromadný import řídicí dokumentace

**Stav:** přijato (v0.32.0)

## Kontext
Organizace přecházející na CONTIX mají hotovou sadu řídicí dokumentace (desítky až stovky dokumentů) s mapou metadat.
Ruční zakládání dokumentu po dokumentu je pracné a chybové.

## Rozhodnutí
- Vstup = ZIP: tabulka metadat (CSV / XLSX, sloupce podle mapy metadat – názvy bez ohledu na diakritiku) + soubory dokumentů.
  Tabulku vybírá `readImportZip` (přednost má tabulka se sloupcem „Soubor“), soubory se párují podle sloupce „Soubor“
  (i s jinou kořenovou složkou), jinak podle označení na začátku názvu souboru.
- Dvoufázově: `mode=preview` (nic nezapisuje) → `mode=commit` se stejným archivem a volbami (mapování rolí na funkční místa,
  cílová složka, podsložky podle druhu, seznámení). Role se navrhují podle shody názvu funkčního místa.
- Založení: dokument ve stavu „V přípravě“, návrh verze (číslo z tabulky, výchozí 1.0) se souborem; oddíly vyhlášky z „Právní vazby“
  (paragrafy zákona se ignorují), interval přezkumu z textu, nadřazený dokument podle označení (v importu nebo existující).
  Existující označení se přeskočí (žádné přepisování). Každý dokument = audit `policy.imported`, souhrn `policy.import_finished`.
- Převod souborů do PDF/textu neběží hned pro každý soubor (`storeFile(…, processNow=false)`), ale postupně přes `processPendingFiles`.
- Limit archivu 100 MB, rozbalení přes `safeUnzip`, soubor dokumentu max. 25 MB, max. 1000 řádků.

## Důsledky
Celou sadu (např. 90 dokumentů dle vyhl. 409/2025) lze založit jedním importem; schvalování zůstává v běžném oběhu.
