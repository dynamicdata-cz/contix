# ADR-007: Katalog opatření, SoA, metodika rizik dle vyhl. 409/2025 a BIA

- **Stav:** přijato
- **Datum:** 2026-09-30

## Kontext

Od 1. 11. 2025 platí zákon č. 264/2025 Sb. a vyhlášky č. 409/2025 Sb. (vyšší povinnosti) a 410/2025 Sb. (nižší povinnosti).
Uživatel chce katalog opatření namapovaný na ZKB/vyhlášky, ISO/IEC 27001:2022 a DORA, prohlášení o aplikovatelnosti s mírou
shody, plán zvládání rizik, matice 3×3/4×4/5×5 a BIA – s důsledným dodržením vyhlášek.

## Rozhodnutí

1. **Požadavky předpisů jsou data v kódu** (`packages/shared/src/frameworks`), ne v DB: verzují se s aplikací, mají stabilní
   ID a v DB se ukládá jen posouzení (`requirement_assessments`) a mapování (`control_requirements`). Plné znění vyhlášek
   je převzato z e-Sbírky (úřední dílo); ISO jen struktura bez textu (autorské právo); DORA úřední názvy článků.
2. **Metodika rizik dle přílohy č. 4:** výchozí funkce aktivum × hrozba × zranitelnost ve 4 úrovních; jiný počet úrovní
   (3/5) a dvoufaktorová funkce jsou povoleny s převodní tabulkou na úrovně vyhlášky a s vedením úrovně hrozby i zranitelnosti.
   Riziko si ukládá počet úrovní a datum hodnocení; skóre se dál nepersistuje.
3. **Míra shody se odvozuje z opatření**, ruční posouzení ji může přebít; neaplikování vyžaduje odůvodnění.
4. **Plán zvládání rizik** = akce u rizik se strukturou § 8 odst. 1 písm. g); vazba na opatření propojuje rizika a SoA.
5. **BIA** používá oblasti z přílohy č. 1 tab. č. 4 a navazuje na hodnocení dostupnosti aktiv (tab. č. 3).
6. Nové moduly se u existujících instalací zapnou jednorázově (`MODULE_UPGRADES`), nová oprávnění přes `PERMISSION_UPGRADES`.

## Důsledky

- (+) Auditovatelná vazba požadavek → opatření → riziko → akce; exporty pro NÚKIB/audit.
- (+) Změna metodiky nevyžaduje migraci dat; stará hodnocení jsou označena k přehodnocení.
- (−) Při novele vyhlášek je nutné aktualizovat data a zkontrolovat ID požadavků (posouzení jsou navázána na ID).
- (−) Mapování na ISO/DORA je orientační odhad – vyžaduje odbornou revizi u konkrétní organizace.
- (−) Verzování SoA (uchování přehledů 4 roky dle vyhl. 410) zatím řeší exporty.
