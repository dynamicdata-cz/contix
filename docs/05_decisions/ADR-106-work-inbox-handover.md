# ADR-106: Jedna fronta práce a předání funkčního místa

**Stav:** přijato (v1.10)

## Kontext

Uživatel hledal svou práci na dvou místech (Moje povinnosti a Akce a úkoly) a úkoly šlo měnit jen po jednom.
Při odchodu zaměstnance nebo reorganizaci bylo nutné přepisovat vlastníka záznam po záznamu; „Kde je použito“
ukazovalo jen procesy, rizika a dokumenty.

## Rozhodnutí

- **Moje práce** (`/my`): záložky Moje povinnosti | Úkoly a akce | Tým (`useTab`, `?tab=`). Přehled akcí je
  komponenta `ActionsBoard` (stránka Akce a úkoly i záložka, v záložce výchozí filtr Moje).
- **Hromadné změny úkolů** `POST /api/actions/tasks/bulk` {ids, status?, dueDate?, ownerPositionId?}: každý úkol se
  ověří zvlášť – stav smí měnit správce (`actions:write` ve společnosti úkolu) i držitel funkčního místa vlastníka,
  termín a vlastníka jen správce; vlastník musí být ze stejné společnosti. Nepovolené úkoly se přeskočí a vrátí
  v `skipped`; audit `task.bulk_updated`.
- **Stránka funkčního místa** `/organization/positions/:id` z `GET /api/org/positions/:id/detail`: držitelé, vše,
  co místo vlastní podle registru `USAGE` (`modules/org/positions.ts`, 28 druhů: tabulka, sloupec, popisek, odkaz,
  oprávnění ke čtení a zápisu, modul) a role RACI. Druh se ukáže jen se zapnutým modulem a oprávněním ke čtení
  ve společnosti místa.
- **Předání** `POST /api/org/positions/:id/handover` (`org:write` + oprávnění k zápisu u každého druhu): cílové
  místo ze stejné společnosti, jedna transakce, audit `org.position_handover` s počty a poznámkou.

## Důsledky

Nový sloupec s odkazem na funkční místo = položka v `USAGE` a `POSITION_USAGE_KINDS` / `POSITION_USAGE_LABELS`
(`@contix/shared` org.ts) – jinak ho stránka místa ani předání neuvidí. Starý endpoint `/positions/:id/usage`
zůstává pro kontrolu před smazáním.
