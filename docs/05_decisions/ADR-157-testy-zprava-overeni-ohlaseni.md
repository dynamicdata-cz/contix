# ADR-157: Zpráva z testů, ověření opravy, pravidelné testy, ohlášení NÚKIB (v1.63)

## Kontext

Bezpečnostní testy (ADR-153) a úkoly z nálezů (ADR-155) neuzavíraly cyklus: oprava se ověřovala ručně, testy se
spouštěly jen ručně a výsledky nebylo možné předat zákazníkovi. Po určení regulace (ADR-156) chyběla evidence ohlášení.

## Rozhodnutí

1. **Zpráva** `GET /api/security-tests/report.html|docx` (`sectests:read`, `batchIds` nebo období, `all`, `evidence`):
   obsah jen `secTestReport` (podmnožina HTML pro `htmlToDocx`, vzhled společnosti přes `printPage` / `htmlToDocx`),
   data jen ze společností, kde uživatel smí číst; AI texty z uložených rozborů a shrnutí.
2. **Ověření opravy**: přechod úkolu `sectest_finding` do „splněno“ (PATCH i hromadně) volá `onFindingTaskDone` – běh
   `sec_test_runs.retest_finding_id` (migrace 0118) na cíl / port nálezu, sonda původního běhu nebo první aktivní sonda
   společnosti, vždy přes `scopeProblem`; úkol → „rozpracováno“. Po běhu `afterRetest`: nález opraven → `closeFindingTasks`,
   trvá / chyba → úkol „otevřeno“ s poznámkou. Bez sondy / rozsahu zůstane splněno s poznámkou.
3. **Pravidelné testy** `sec_test_schedules` (migrace 0118): plán = parametry sady + interval; spuštění jen `runSchedule`
   → `createBatch` (rozsah se kontroluje při každém spuštění), `sec_test_batches.schedule_id`; plánovač
   `processSecTestSchedules` s lease. Rozdíl sady (nové / opravené) jen `batchDiffs` při čtení.
4. **Opatření a rizika**: `sec_test_findings.control_id` (ručně `PATCH /findings/:id/control`, ze společnosti nálezu, nebo
   první opatření z AI rozboru); podnět `sectest` v `riskTriggers` (otevřené střední+ nálezy na aktivech rizika nebo
   u jeho opatření, novější než základ hodnocení; kritické / vysoké = silný), strana zranitelnosti v `suggestFromTriggers`.
5. **Ohlášení NÚKIB** `regulation_registrations` (migrace 0118): údaje `RegistrationData`, režim a služby z posledního
   posouzení zapsaného do profilu; snímek při zaznamenání ohlášení, změny jen `registrationChanges` (při čtení),
   počátek lhůty `changed_at` (`touchRegistration` po uložení údajů a zápisu posouzení). Lhůty `NUKIB_NOTICE_DAYS` (60)
   a `NUKIB_CHANGE_DAYS` (30) podle § 6 zákona – ověřit při novele. Povinnost `nukib_notice` (funkční místo z údajů).
   Nic se neodesílá; podklad jen `registrationHtml`.

## Důsledky

- Uzavření úkolu osobou neznamená opravu – rozhoduje opakovaný test (nebo ruční označení nálezu).
- Plány běží jen se sondou; neplatný rozsah se projeví chybou plánu (`last_error`), ne tichým přeskočením.
- Rozsah údajů ohlášení odpovídá veřejně popsanému formuláři; při změně formuláře NÚKIB upravit `RegistrationData`.

## Doplnění v1.64 – přijaté nálezy jako výjimky

Přijetí rizika u nálezu (`status = accepted`) vyžaduje zdůvodnění (`note`, min. 5 znaků) a ukládá `accepted_by_id`,
`accepted_at`, volitelně `accepted_until` (migrace 0119). Výjimka druhu `sectest_finding` v `loadExceptions`
(`EXCEPTION_ACCESS` = `sectests:read`, zápis kompenzačních opatření `sectests:run`), upozornění `exception_expiry`.
Po termínu platnosti upsert v `completeRun` nález znovu otevře.
