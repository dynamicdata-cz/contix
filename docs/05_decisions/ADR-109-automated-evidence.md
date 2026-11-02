# ADR-109: Automatické důkazy – monitory nad daty GRC, externí kontroly, úkol při nesplnění

**Stav:** přijato (v1.13)

## Kontext

Průběžné monitorování (ADR-096) četlo jen technické zdroje (identity, zranitelnosti, Wazuh, TLS, SOC). Důkazy
pro organizační opatření (školení, seznámení s dokumenty, dodržování lhůt) a pro věci mimo CONTIX (zálohy, kontroly
konfigurace, testy obnovy) se dál sbíraly ručně a nesplnění nikoho automaticky neúkolovalo.

## Rozhodnutí

- **Nové druhy monitorů** (`CONTROL_MONITOR_KINDS` + `MONITOR_SPEC` + větev v `collectMonitor`):
  `training_completion` (podíl splněných povinných školení z `loadCourses`), `policy_ack` (podíl potvrzených
  seznámení z `loadPolicies`), `obligations_overdue` (povinnosti po termínu z `collectObligations`, volitelně jen
  `obligationKinds`), `external_check`.
- **Externí kontrola**: výsledek posílá skript na `POST /api/public/monitors/result` s `Authorization: Bearer <token>`
  (`MonitorPushInput`: `result` a/nebo `value` proti toleranci, `summary`, `details`). Token monitoru se vydá
  `POST /monitors/:id/token` (zobrazí se jednou, v DB jen SHA-256 `token_hash`, nový zneplatní starý); jen druh
  `external_check` a zapnutý monitor; bez cookies a CSRF; audit `control_monitor.result_pushed`. Ručně spustit nelze;
  plánovač zapíše běh `error`, když výsledek nedorazí do intervalu + 2 h (od posledního výsledku nebo založení).
- **Úkol při nesplnění** (`auto_task`): běh `fail` / `error` založí úkol (`tasks.source_kind = control`) vlastníkovi
  opatření s termínem 7 dní; `open_task_id` brání duplicitám, dokud úkol není hotový nebo zrušený. Zápis běhu
  (plánovač, ruční běh i externí výsledek) jen přes `recordRun`.

## Důsledky

Migrace 0086 (`auto_task`, `open_task_id`, `token_hash`). Běhy zůstávají neměnné a skládají se do testů za období
beze změny (ADR-096) – externí kontroly a monitory GRC tak slouží i pro SOC 2 Type II.
