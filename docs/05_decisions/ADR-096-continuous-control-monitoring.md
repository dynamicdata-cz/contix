# ADR-096: Průběžné monitorování opatření (continuous control monitoring) pro SOC 2 Type II

- Stav: přijato
- Datum: 2026-10-23
- Verze: 1.01

## Kontext
Automatické testy opatření (ADR-031, ADR-064) zakládaly jednotlivé testy v delším intervalu. Pro SOC 2 Type II je potřeba doložit,
že opatření fungovalo po celé období – auditor chce populaci běhů, výjimky a výpadky monitorování.

## Rozhodnutí
1. **Monitor** (`control_monitors`) = druh kontroly (`CONTROL_MONITOR_KINDS`) + práh (`MonitorParams`, jen klíče druhu přes `monitorParamsOf`)
   + frekvence (denně / týdně / měsíčně), navázaný na opatření. Vyhodnocení jen `evaluateMonitor` (čistá funkce, `MONITOR_SPEC`).
2. **Běh** (`control_monitor_runs`) je neměnný záznam: výsledek pass / fail / error, hodnota, práh, populace, výjimky, souhrn,
   podrobnosti (max. 50). Chyba zdroje (nesynchronizovaný adresář, chybějící oprávnění Graph, žádná data) = `error`, nikdy `pass`.
   Monitor s historií nelze smazat, jen vypnout.
3. **Kolektory** (`controls/monitors.ts`) jen čtou data CONTIXu: MFA a hygiena účtů, privilegované účty (Identity), zranitelnosti po termínu
   a KEV, SCA, pokrytí agentem Wazuh, EOL, certifikáty TLS, SLA SOC. Jediné volání ven: Microsoft Secure Score
   (`fetchSecureScore`, Graph, SecurityEvents.Read.All, jen čtení) – nic se neodesílá kromě dotazu.
4. **Test za období** (`monitorPeriodTest`, souhrn `monitorPeriod`): každý běh = vzorek; nesplněné a chybové běhy = výjimky; méně než 90 %
   očekávaných běhů = výjimka „výpadek monitorování“. Výsledek dokončený test provozní účinnosti (`control_tests.monitor_id`) + CSV důkaz.
   Zakázka SOC 2 Type II: `POST /soc2/:id/monitor-tests` za období zprávy pro opatření namapovaná na kritéria v rozsahu, bez duplicit.
5. Podrobnosti běhu (jména účtů, aktiv) jen s oprávněním ke zdroji dat (`DETAIL_PERM`); výsledky vidí `controls:read`.
6. Plánovač `processMonitors` v cyklu upozornění; AI nástroj `control_monitors` (jen čtení).

## Nezahrnuto
Upozornění e-mailem na nesplněný monitor, další zdroje M365 (Intune compliance, Defender), účinnost opatření z monitoru automaticky.

## Důsledky
Nové tabulky `control_monitors`, `control_monitor_runs`, sloupec `control_tests.monitor_id` (migrace 0079).
