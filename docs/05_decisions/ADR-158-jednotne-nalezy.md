# ADR-158: Jednotný model nálezů, nálezy serveru s životním cyklem, předání odpovědností (v1.65)

## Kontext

Nálezy vznikaly v osmi evidencích s vlastními stavy a závažností. Nálezy sběrače se počítaly jen při čtení
(bez stavu, úkolu a výjimky), semafor aktiva nevěděl o testech a sběrači, přesun aktiva nechal nálezy ve staré
společnosti, deaktivace uživatele nechala aktiva a úkoly bez odpovědného a ohlášení NÚKIB bralo režim z posouzení,
ne z regulatorního profilu.

## Rozhodnutí

1. **Nálezy serveru** `host_findings` (migrace 0120): klíč = sha256(kód + předmět) v rámci inventáře. `syncHostFindings`
   při novějším hlášení: upsert (opravený nebo prošlé přijetí → otevřený), chybějící otevřený → opravený + úkoly
   `host_finding` splněny. Vysoké otevřené nálezy aktiva s odpovědnou osobou dostanou úkol automaticky
   (`createHostFindingTasks`, stejný výběr osoby `technicalAssignee` a lhůty jako u testů). Změna stavu
   `PATCH /api/hosts/findings/:id` (`assets:write`), úkoly `POST /api/hosts/findings/tasks`. Výjimka `host_finding`
   (čtení `assets:read`, zápis `assets:write`, modul aktiva).
2. **Jednotný přehled** `GET /api/findings` jen čte zdroje – testy (`sectests:read`), sběrač (`assets:read`),
   zranitelnosti (`assets:read` + modul), audity (`audits:read`) – v rozsahu a oprávněních uživatele.
   Mapování závažnosti a stavů `unifiedSeverity` / `unifiedStatus` ve `shared/findings.ts`; audit: zásadní = vysoká,
   menší = střední, pozorování = nízká, doporučení = info. Bez filtru závažnosti zranitelnosti od střední, limit 1 500.
3. **Semafor**: `computeHealth` dostává `findings` (kritický test = červená, vysoký test a vysoký nález serveru =
   oranžová; důvody `test_finding`, `host_finding`). Přepočet po doběhnutí testu, po hlášení sběrače a po změně stavu
   nálezu serveru. Podnět k přehodnocení rizika `host_finding` (strana zranitelnosti).
4. **Přesun aktiva** (`transferRecords`): nálezy testů (bez kolize klíče), inventáře, nálezy serveru a úkoly obou druhů
   jdou s aktivem; funkční místo úkolu se vynuluje a odpovědní se přepočítají.
5. **Předání odpovědností uživatele** `GET /api/admin/users/:id/responsibilities`, `POST /handover` (`admin:users`, jen
   společnosti v rozsahu): aktiva (vlastník, garant, zástupce) a otevřené přidělené úkoly; poté `reassignFindingTasks` /
   `reassignHostFindingTasks`. Funkční místa se dál předávají v Organizaci.
6. **Ohlášení NÚKIB**: režim = regulatorní profil společnosti (jediný zdroj pravdy), služby z posledního zapsaného
   posouzení, `regimeMismatch` při rozdílu. Odpovědné místo ve sloupci `regulation_registrations.responsible_position_id`
   (převod z JSON v migraci) a v registru `USAGE` (`nukib_registration`).

## Důsledky

Nové zdroje nálezů se přidávají do `findings/routes.ts` (zdroj, oprávnění, mapování) a do semaforu, pokud mají aktivum.
Nálezy serveru starší verze se založí při prvním hlášení po aktualizaci.
