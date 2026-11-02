# ADR-116: Analýza rizik z dat ve zprávě o hodnocení rizik (v1.19)

## Kontext

Scénáře z dat (ADR-114) a pokrytí katalogu hrozeb (ADR-115) jsou v CONTIXu vidět jen průběžně. Auditor ani NÚKIB ale
potřebují doložitelný stav k určitému dni ve schváleném dokumentu – zpráva o hodnocení rizik (§ 8 odst. 1 písm. e) vyhlášky
č. 409/2025 Sb.) je k tomu určená a už má verze, schválení, seznámení vedení a uchování (snímky `document_versions`).

## Rozhodnutí

1. Obsah části vzniká jen v `riskDataReport` (`risks/scenarios.ts`) – jen čtení, stejné výpočty jako na obrazovce
   (`capabilityDtos` / `measureCompany`, `threatCoverage`, `riskTriggers`), výsledek typu `RiskDataReport` (shared).
2. Snímek `risk_report` dostane volitelné pole `dataDriven`. Starší snímky ho nemají a vykreslují se beze změny.
   Část se nepřidá, když společnost nemá primární aktiva ani žádný návrh scénáře.
3. Vykreslení jen `dataDrivenSection` v `documents/render.ts` jako **část 7. Analýza rizik z dat**: 7.1 profil schopností,
   7.2 pokrytí katalogu (souhrn a primární aktiva s výčtem neposouzených hrozeb), 7.3 nerelevantní hrozby se zdůvodněním,
   7.4 scénáře a rozhodnutí, 7.5 přehodnocení rizik v hodnoceném období (`risk_reviews`), 7.6 otevřené podněty s termínem.
   Vše escapované, jen podmnožina HTML převoditelná do Wordu.
4. Ukazatele verze `threatCoverage` (% posouzených kombinací) a `unassessedThreats` v `metricsOf` – zobrazují se s rozdílem
   proti předchozí verzi.

## Důsledky

- Úplnost a podklady analýzy rizik jsou ve schváleném dokumentu zmrazené; pozdější změny dat verzi nemění.
- Žádná nová tabulka ani oprávnění (dokument se řídí `risks:read` / `risks:write`).
