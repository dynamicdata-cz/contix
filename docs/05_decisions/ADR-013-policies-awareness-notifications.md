# ADR-013: Dokumentace (§ 6), povědomí (§ 10) a upozornění na lhůty

**Stav:** přijato · 2. 10. 2026

## Kontext

SoA u § 6 a § 10 neměla oporu v evidenci; lhůty (incidenty, akce, přezkumy) byly vidět jen po přihlášení.

## Rozhodnutí

1. Moduly `policies` a `awareness` s vlastními oprávněními; nové oprávnění `obligations:self` (všechny systémové role)
   pro osobní povinnosti bez přístupu k evidenci.
2. Okruh dotčených osob je deklarativní (`Audience`: útvary vč. podřízených, funkční místa, bezpečnostní role, vedení,
   všichni) a vyhodnocuje se při čtení – personální změny se projeví bez úprav dokumentů a školení.
3. Seznámení se váže na schválenou verzi; nová verze vyžaduje nové seznámení.
4. Povinnosti se nepersistují (stejně jako lhůty incidentů); persistuje se jen deník odeslaných upozornění kvůli deduplikaci.
5. Plánovač běží v procesu API (jedna instance). Při více instancích je deduplikace bezpečná díky unikátnímu indexu,
   denní souhrn se ale musí řídit jedinou instancí (budoucí: zámek přes `pg_try_advisory_lock`).
6. SMTP přes `nodemailer`; Teams přes webhook s allow-listem domén Microsoftu (ochrana proti SSRF / úniku dat).

## Důsledky

- Výpočet okruhu je O(počet dokumentů × okruh); pro tisíce uživatelů bude potřeba cache.
- Integrace s e-learningem (SCORM/LMS) je možná přes API zápisu absolvování.
