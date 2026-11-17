# ADR-172: Hromadné úpravy procesů, dodavatelů a úkolů (v1.79)

## Kontext

Hromadné úpravy (ADR-168) pokrývaly aktiva, rizika a opatření. Procesy a dodavatelé se po importu nebo zavedení
struktury útvarů doplňovaly po jednom; u úkolů chyběla priorita a odpovědná osoba (v1.62).

## Rozhodnutí

- `POST /bulk/processes` (`processes:write`): vlastník (funkční místo), útvar, kritičnost, typ procesu, štítky
  (`object_tags`). Funkce i útvar musí patřit do společnosti procesu, jinak se záznam přeskočí s důvodem. Zvyšuje
  `version` procesu jako ruční úprava. Stav procesu se nemění – aktivuje ho schválení verze.
- `POST /bulk/suppliers` (`suppliers:write`): významný dodavatel, data mimo ČR, stav spolupráce, interval přezkumu
  (1–36 měsíců), datum posledního přezkumu, štítky.
- `POST /actions/tasks/bulk` doplněn o `priority` a `assigneeUserId` (jen správce úkolů, osoba musí být aktivní).
- Web: `BulkBar` s mapováním pole formuláře na klíč (`supplierStatus` → `status`) a převodem ano/ne a čísel;
  zaškrtávání v seznamu procesů (zobrazení Seznam) a dodavatelů.

## Důsledky

- Každý změněný záznam má vlastní auditní záznam (`process.bulk_updated`, `supplier.bulk_updated`).
