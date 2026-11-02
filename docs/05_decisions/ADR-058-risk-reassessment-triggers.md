# ADR-058: Přehodnocení rizik z podnětů

**Stav:** přijato (v0.63.0)

## Kontext
Vyhláška č. 409/2025 Sb. (§ 8) vyžaduje hodnocení rizik pravidelně **a při významné změně, incidentu nebo zjištění**.
Data o incidentech, auditech, změnách, SOC, zranitelnostech, testech opatření a dodavatelích už CONTIX má, ale riziko
s nimi nebylo propojené – vlastník rizika se o podnětu nedozvěděl a rozhodnutí „hodnocení beze změny“ nebylo doložitelné.

## Rozhodnutí
- **Podněty** `riskTriggers(db, riskIds)` (`apps/api/src/modules/risks/triggers.ts`) – dávkově, při čtení, nepersistují se.
  Základ = `riskBaseline` = pozdější z `risks.assessed_at` a `risks.reviewed_at` (jinak založení rizika). Druhy:
  incident (`incident_risks` nebo aktiva rizika, ne „událost“), zjištění auditu (major / minor, `audit_findings.risk_id`),
  významná změna (schválená / zavedená, přes riziko nebo aktiva), SOC (eskalace, true positive, pokus o zneužití na aktivech),
  zranitelnosti P1 (`vulnPrioritySql = 1`, nové nebo nově v KEV), neúčinný / s výjimkami test navázaného opatření,
  prošlá výjimka zranitelnosti, vyhodnocený dotazník dodavatele s odpovědí „ne“. Uzavřená rizika se přeskočí.
- **Návrh** `suggestFromTriggers` (`shared/riskTriggers.ts`), jen metodika dle vyhlášky: hrozba +1 (incident, SOC),
  zranitelnost +1 (zranitelnosti, zjištění, testy, výjimky); u dvoufaktorové metody pravděpodobnost +1. Jen silný podnět
  nebo dva podněty stejné strany; strop stupnice. Změny a dodavatelé se jen zobrazí. Návrh se vkládá **jen do formuláře**.
- **Rozhodnutí** vlastníka (`canEdit`): změna hodnocení (PATCH, volitelně `reviewNote`) nebo **potvrzení beze změny**
  `POST /risks/:id/review` s povinným zdůvodněním. Obojí → tabulka `risk_reviews` (rozhodnutí, zdůvodnění, snímek podnětů,
  úroveň a skóre před / po, kdo, kdy), `risks.reviewed_at`, audit, v probíhajícím cyklu `markReassessed` / `markConfirmed`.
  Potvrzení se počítá jako pravidelné hodnocení (`reviewDue`, povinnost `risk_review`).
- **Povinnost** `risk_trigger` vlastníkovi rizika, termín = první podnět + 30 dní (`triggerDue`).
- Seznam rizik: počet podnětů `triggers` a filtr `triggers=1`; zpráva o přezkoumání ISMS: čekající rozhodnutí
  a počet změn / potvrzení za období (`IsmsReviewSnapshot.risks.reassessment`, u starších snímků chybí).

## Důsledky
- Výpočet podnětů je při každém načtení seznamu rizik (10 dotazů pro všechna rizika najednou) – při tisících rizik
  zvážit cache jako u `quantOf`.
- Nic se nemění automaticky; skóre rizika se dál nepersistuje.
