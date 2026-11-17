# ADR-169: Útvar jako centrum, volné texty na výběry, rychlé založení, kontrola dat po nasazení (v1.76)

## Rozhodnutí

1. **Útvar jako centrum**: `GET /org/units/:id/overview` – počty včetně podřízených útvarů (`unitSubtreeSql`,
   `unitPositionsSql` v `org/hierarchy.ts`): aktiva (odpovědný útvar), procesy (útvar nebo vlastník z útvaru), otevřená
   rizika a opatření vlastněná funkcemi útvaru, otevřené úkoly funkcí a jejich držitelů; jen evidence s oprávněním
   a zapnutým modulem. Filtr `unit` v seznamech procesů, rizik a opatření (aktiva `ownerUnitId` z ADR-167).
2. **Volné texty na výběry**: tým hodnoticího cyklu `team_position_ids` (funkce ze společnosti cyklu; text zůstává
   jako poznámka a nově je vidět v detailu); dodavatel AI systému `SuggestInput` nad evidencí dodavatelů – výběr doplní
   i vazbu; systémy kroku procesu nabízejí aktiva (výběr je přidá mezi aktiva kroku); umístění aktiva nabízí dosavadní
   lokality a místa z map a půdorysů (`GET /assets/locations`). Text zůstává tam, kde vazba neexistuje.
3. **Rychlé založení z výběru** (`onCreate` v `Combobox` / `ComboMulti`): útvar (`org:write`, nejvyšší úroveň
   společnosti), dodavatel ve výběrech dodavatelů (`suppliers:write`), aktivum ve výběru aktiv (`assets:write`, typ
   „ostatní“) – vždy přes běžné API (oprávnění, audit), podrobnosti se doplní v detailu.
4. **Kontrola dat po nasazení**: kontroly kvality `assets_unit_text` (oprava útvarem) a `assets_tags_uncatalogued`
   (oprava `normalize` = `canonicalTags`), souhrn v `verify.ts` (spouští `update.sh`).
