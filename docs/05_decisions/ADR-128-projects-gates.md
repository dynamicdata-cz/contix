# ADR-128: Projekty s fázemi, branami a požadovanými dokumenty (v1.31)

## Kontext

Bezpečnost se má řešit od začátku projektů (§ 13 vyhl. 409/2025 – bezpečnost při akvizici, vývoji a údržbě;
ISO 27001 A.5.8 bezpečnost v řízení projektů). Zákazníci potřebují jednoduché řízení projektů, kde nelze pokračovat
do další fáze bez dokumentů – zejména bezpečnostních.

## Rozhodnutí

1. Modul `projects`, oprávnění `projects:read` / `projects:write`; tabulky `projects`, `project_phases`,
   `project_docs` (soubor v DB, nebo odkaz) – migrace 0098.
2. Fáze a dokumenty ze šablony `PROJECT_TEMPLATES` (IT projekt, bezpečnostní projekt, pořízení); bezpečnostní
   dokumenty označené `security`. Vlastní dokumenty jen nepovinné; povinný nelze smazat, jen „netýká se“ s důvodem.
3. Čtyři oči: dokument schvaluje jiný uživatel než předkladatel; bránu schvaluje sponzor (stačí `projects:read`),
   bez sponzora `projects:write` kromě manažera; sponzor ≠ manažer.
4. Brána jen bez blokujících povinných dokumentů (`gateBlockers`); schválením začne další fáze; uzavření projektu až
   po všech branách. Uzavřený / zrušený projekt je jen ke čtení.
5. Povinnost `project_gate` v Moje práce; úkoly se zdrojem `project`; vše auditováno.

## Důsledky

- Jednoduchý stage-gate proces bez Ganttu a zdrojů; harmonogram jen termíny fází.
- Šablony jsou zatím vestavěné; vlastní šablony organizace mohou přijít později.
