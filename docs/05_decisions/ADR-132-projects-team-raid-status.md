# ADR-132: Projekty III – tým, úkoly, milníky, rizika a problémy, stav (RAG), změny, výstupy, portfolio (v1.35)

## Kontext

Projekty (ADR-128, 129) řídily fáze, brány, dokumenty a rozpočet, ale chyběla každodenní práce týmu, pravidelné hlášení
stavu vedení a řízené změny termínu a rozpočtu. Přehled projektů byl jen tabulka.

## Rozhodnutí

1. **Tým** `project_members` (uživatel, role, RACI). Manažer a sponzor zůstávají v `projects`.
2. **Úkoly projektu** `project_tasks` (Kanban `PROJECT_TASK_STATUSES`, řešitel = uživatel, fáze, termín, priorita, pořadí).
   Správce projektu (projects:write) mění vše; řešitel smí měnit jen stav a pořadí svého úkolu. Úprava jen přes
   `ProjectTaskPatch` (neposlaná pole se nepřepíšou). Obecné úkoly `tasks` se zdrojem `project` zůstávají v záložce Vazby.
3. **Milníky** `project_milestones` (v harmonogramu jako kosočtverce), **rizika a problémy** `project_issues`
   (úroveň jen `issueScore`: pravděpodobnost × dopad, problém = pravděpodobnost 3).
4. **Hlášení stavu** `project_status_reports` (RAG celkem / harmonogram / rozpočet / rozsah); návrh jen `suggestRag`
   z dat (nepersistuje se), manažer ho potvrdí nebo změní. Portfolio ukazuje poslední nahlášený stav, jinak návrh.
5. **Žádosti o změnu** `project_changes` (termín, rozpočet ±, rozsah); schvaluje stejný okruh jako bránu
   (`canApproveGate`) a nikdy žadatel; schválení v transakci upraví `projects.end_date` a `budget`.
6. **Výstupy**: stavová a závěrečná zpráva jen `projectReportHtml` (`projects/report.ts`, podmnožina HTML, escapováno,
   cs/en) → tisk nebo `htmlToDocx`; generování auditováno. **Poučení** `project_lessons`.
7. **Moje práce**: povinnosti `project_task` (řešitel) a `project_change` (sponzor) přes `projectWorkItems`.
8. Souhrny portfolia jen `portfolioInfo` (hromadně, při čtení). Migrace 0102.

## Důsledky

- Projekt má jedno místo pro práci týmu, stav pro vedení a auditovatelnou historii změn.
- Závislosti mezi úkoly a vytížení lidí zatím nejsou.
