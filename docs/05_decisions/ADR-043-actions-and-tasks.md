# ADR-043: Akce a úkoly – jednotný přehled

**Stav:** přijato (v0.48.0)

## Kontext
Nápravné akce vznikaly v několika modulech (akce plánu zvládání rizik, nápravná opatření ze zjištění auditů, úkoly ze změn
předpisů) a pro ostatní podněty (incident, dodavatel, změna, opatření…) nebylo kam úkol zapsat. Chyběl jeden seznam
„co je potřeba udělat, kdo za to odpovídá a co je po termínu“.

## Rozhodnutí
- Nová tabulka `tasks` (patří společnosti, pořadové číslo `seq` → `#12`): název, popis, odpovědné **funkční místo**, termín,
  priorita, stav (otevřeno / rozpracováno / splněno / zrušeno), datum a záznam o splnění; volitelně navázaná na záznam
  (`source_kind` + `source_id`: incident, dodavatel, změna, opatření, aktivum, proces, riziko, dokument, audit, činnost zpracování).
  Navázaný úkol přebírá společnost zdroje a při přesunu zdroje do jiné společnosti jde s ním.
- **Přehled se počítá při čtení** (`loadActionItems`): úkoly + `risk_treatment_actions` + `audit_findings` + `legal_tasks`
  se sjednoceným stavem; každý druh jen pro společnosti, kde má uživatel čtecí oprávnění dané evidence a modul je zapnutý
  (`ACTION_ACCESS`). Akce z jiných modulů se upravují u svého záznamu (odkaz) – přehled jejich workflow nenahrazuje.
- Oprávnění `actions:read` / `actions:write` (upgrade 0.48 pro systémové role). Držitel funkčního místa vlastníka smí u svého
  úkolu měnit jen **stav a záznam o splnění** (i bez `actions:write`); mazat smí jen správce.
- Povinnost `task` (úkoly s termínem) – Moje povinnosti držitele místa, týmový přehled a e-mailový souhrn.
- UI: stránka `/actions` (KPI, filtry, Moje, jen po termínu, CSV), karta **Úkoly** u incidentu, dodavatele, změny, opatření,
  aktiva a procesu (`TasksCard`), editor `TaskModal`; odkaz `/actions?task=<id>` otevře úkol (povinnosti, e-mail).

## Důsledky
- Nový druh akce v přehledu = `ACTION_KINDS` + `ACTION_ACCESS` + větev v `loadActionItems` (mapování stavu na `TASK_STATUSES`).
- Nový druh zdroje úkolu = `TASK_SOURCES` + `taskSourceLink` + popisek v `sourceLabels` + mapování v přesunu (`transferRecords`).
