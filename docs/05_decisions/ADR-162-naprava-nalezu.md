# ADR-162: Náprava nálezů, odpovědnost a souhrn garantům (v1.69)

## Kontext

Jednotný přehled nálezů (ADR-158) ukazoval stav, ale ne nápravu v čase – vedení ani auditor neviděli dobu opravy
a plnění lhůt; garanti aktiv neměli „své“ nálezy na jednom místě; Zpráva pro vedení měla jen dílčí souhrn testů.

## Rozhodnutí

1. **Náprava** jen `findingsRemediation` (`findings/metrics.ts`, SQL agregace při čtení, nic se nepersistuje):
   otevřené / po termínu / opravené v období / průměrná doba (zjištění → oprava) / podíl v termínu, po zdroji a závažnosti
   (`unifiedSeverity`). Termín: testy a servery `SECTEST_TASK_DUE_DAYS` od zjištění (stejně jako úkol), zranitelnosti
   `vulnDueSql`, audit `due_date`. API `GET /api/findings/remediation` (aktivní společnost, jinak rozsah uživatele).
2. **Zpráva pro vedení**: `ManagementReport.findings` + ukazatel `findings` + oddíl v `renderManagementReport`; trendy
   `findings_critical_high`, `findings_ontime_pct`, `findings_fix_days` z téže zprávy.
3. **Odpovědnost** `who=mine|team` (`responsibility`): osoby a funkce uživatele, u týmu podřízené útvary jeho vedoucích
   funkcí (`orgSnapshot`); filtr přes garanta / zástupce / vlastníka aktiva, řešitele nebo funkci úkolu, funkci zjištění.
4. **Týdenní souhrn garantům** (`findings/digest.ts`): v pondělí s denním souhrnem (`runNotifications`, vynucený běh
   vždy), jen počty a názvy aktiv, záznam `notification_log` (jednou za den a příjemce).
5. **Přesun rozsahu testů** (`sectest_scopes` v `transferRecords`): plány jdou s rozsahem, schválení se ruší (upozornění).
6. **Logo ve výstupech**: bez vlastního vzhledu `contixbar` (PNG `CONTIX_LOGO_PNG`) v tisku i Wordu; ikony a manifest webu.
