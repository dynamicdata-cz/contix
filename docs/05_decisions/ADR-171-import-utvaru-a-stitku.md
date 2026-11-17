# ADR-171: Import útvarů a štítků (v1.78)

## Kontext

Po v1.74 (útvar aktiva ze struktury, ADR-167) zůstala aktiva v instalacích bez útvaru – ruční nebo hromadné přiřazení
je u stovek aktiv pracné, přitom inventury v Excelu sloupec s útvarem obvykle mají. Import ho ale mapoval jen do
textového pole a štítky uměl jen u aktiv.

## Rozhodnutí

- Pole importu aktiv `ownerUnitId` (typ `unit`) se stejným párováním jako import funkčních míst: název nebo kód útvaru
  společnosti (normalizace bez diakritiky), neznámý útvar se při zápisu založí jednou přes API útvarů a náhled to hlásí.
  Založení nového útvaru je obecné pro jakékoli pole typu `unit` (`_units` nese i klíč pole).
- Textové pole přejmenováno na *Správce (text)*; synonymum se starým popiskem zachová načítání dřívějších šablon,
  „útvar“ nově míří na útvar ze struktury.
- Rizika, procesy, opatření a dodavatelé: sloupec *Štítky* (`IMPORT_TAG_ENTITY`). Štítky nejsou součástí schématu
  záznamu (katalog `object_tags`), proto se po úspěšném uložení zapíší přes `PUT /tags/of/:type/:id` se stejnou relací –
  platí oprávnění i založení chybějících štítků v katalogu. Vyplněný sloupec štítky nahradí (import mění jen vyplněné sloupce).

## Důsledky

- Útvary aktiv lze doplnit opakovaným importem existující inventury (párování podle sériového čísla, hostname nebo názvu).
- Chyba zápisu štítků se objeví mezi chybami řádku, záznam samotný zůstane uložen.
