# ADR-066: Cvičení a tabletop scénáře

**Stav:** přijato (v0.71.0)

## Kontext
§ 15 vyhl. č. 409/2025 Sb. vyžaduje plány kontinuity a reakce testovat. Dosud šel do plánu ručně zapsat jen výsledek
testu – bez scénáře, průběhu, cílů a návazných opatření, tedy bez podkladu, který auditor očekává.

## Rozhodnutí
- Tabulky `exercises` (scénář, cíle, vstupy s časem od zahájení, účastníci, facilitátor = funkční místo, stav
  planned → running → completed / cancelled, záznam průběhu `log`, výsledek) a `exercise_plans` (testované plány,
  odkaz na vzniklý `plan_tests`). Označení `CV-<seq>`.
- Knihovna `EXERCISE_TEMPLATES` (cs / en): ransomware, výpadek cloudového dodavatele, výpadek napájení, únik osobních
  údajů, BEC.
- Řídí facilitátor (držitel místa) nebo `bia:write`; čtení `bia:read`, modul kontinuity. Záznam průběhu jen ve stavu running.
- Dokončení `POST /exercises/:id/complete`: výsledek, RTO, splnění cílů, zjištění, poučení → test do každého navázaného
  plánu (`plan_tests`), nápravná opatření → úkoly (`tasks.source_kind = exercise`); dokončené cvičení je neměnné.
- Záznam pro audit `exerciseRecordHtml` (tisk i Word přes `htmlToDocx`). Povinnost `exercise` facilitátorovi k termínu.

## Důsledky
- Test plánu ze cvičení se objeví v historii testů plánu a posune termín dalšího testu.
