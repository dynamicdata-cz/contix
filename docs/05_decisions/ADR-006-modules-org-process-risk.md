# ADR-006: Modulární systém, organizace, procesy a rizika

- **Stav:** přijato
- **Datum:** 2026-09-30

## Kontext

CONTIX má sloužit různým organizacím – ne všechny chtějí všechny oblasti. Zároveň se procesy, rizika a aktiva musí
odkazovat na odpovědné osoby způsobem, který přežije personální změny.

## Rozhodnutí

1. **Moduly** jsou deklarované v `packages/shared/src/modules.ts` (klíč, název, závislosti). Zapnuté moduly jsou v nastavení
   `enabledModules`; vypnutý modul zmizí z menu a jeho API vrací **404** (`requireModule`). Data se nemažou.
   Stále jde o modulární monolit (jedna DB, jeden deploy) – ne mikroslužby.
2. **Odpovědnost vede na funkční místo** (`positions`), ne na uživatele. Uživatel funkční místo *obsazuje* (`position_holders`).
   RACI může odkazovat i na celý útvar.
3. **Kroky procesu jsou zdroj pravdy**, BPMN diagram je volitelná vizualizace/model toku. Diagram se umí z kroků vygenerovat
   a úlohy z diagramu převzít do kroků – synchronizace je vědomá (na tlačítko), ne automatická obousměrná.
4. **bpmn-js** (bpmn.io licence – nutný viditelný watermark) jako editor, líně načítaný.
5. **Metodika rizik dle vyhlášky č. 82/2018 Sb.** jako výchozí, konfigurovatelná; skóre se počítá z aktuální metodiky
   (neukládá se), aby změna metodiky nevyžadovala migraci.
6. PATCH schémata se odvozují funkcí `patchOf()` (odstraní výchozí hodnoty) – ochrana před přepsáním neposlaných polí.
7. Nová oprávnění se do existujících systémových rolí doplní jednorázově přes `PERMISSION_UPGRADES` (verze uložená
   v `perm.upgrades`), aby se nepřepsaly ruční úpravy rolí.

## Důsledky

- (+) Organizace si zapne jen to, co používá; menu je přehledné.
- (+) Personální změna = 1 úprava obsazení místa.
- (+) Diagram nezastíní popis – auditor čte kroky a RACI, analytik modeluje.
- (−) Diagram a kroky se mohou rozejít, pokud uživatel nepoužije generování/převzetí.
- (−) Bezpečnostní role na funkčním místě zatím nepřidělují oprávnění automaticky.
