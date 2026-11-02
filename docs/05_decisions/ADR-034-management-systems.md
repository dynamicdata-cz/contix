# ADR-034: Systémy řízení v DMS, ISO 9001 a pokrytí podle rámce

**Stav:** přijato (v0.33.0)

## Kontext
Správa dokumentace vznikla pro bezpečnostní dokumentaci dle § 6 vyhl. 409. Zákazníci chtějí v jednom DMS vést i dokumentaci
systému managementu kvality (ISO 9001), dalších systémů řízení a obecné vnitřní předpisy, a v holdingu mají společnosti v různých režimech.

## Rozhodnutí
- `policies.system` (enum `MANAGEMENT_SYSTEMS`: isms, qms, ems, ohs, privacy, bcm, general; výchozí isms). Mění jen správce dokumentace.
- Kontroly § 6 (`policyGaps`) uvádějí odkazy na vyhlášku jen u ISMS; oddíly vyhlášky se na kartě zobrazují jen u ISMS a podle režimu společnosti (409 / 410).
- Nový rámec `iso9001` (čísla kapitol + vlastní stručné popisky CONTIX, bez textu normy) v `shared/frameworks`.
- Pokrytí `GET /policies/coverage?framework=`: výchozí vyhláška podle režimu; oddíly dokumentu se počítají jen pro vyhlášku režimu,
  pro ostatní rámce přes navázané požadavky (`policy_requirements`).
- Import: sloupce „Systém řízení“ a „Požadavky“ (ID požadavků), oddíly z „Právní vazby“ podle režimu společnosti.
- Nový druh dokumentu „Formulář / šablona“ (`form`, prefix FO).

## Důsledky
Jedno DMS pro více systémů řízení se společným oběhem schvalování, seznámením a přezkumem; pokrytí lze sledovat proti libovolnému rámci.
