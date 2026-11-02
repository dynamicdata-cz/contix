# ADR-120: Ochota riskovat a klíčové ukazatele rizik (v1.23)

## Kontext

Vyhláška (§ 8) i ISO 27001 (6.1.2 kritéria akceptace) vyžadují kritéria přijatelnosti rizik a jejich schválení vedením.
CONTIX měl jen jednu hranici akceptovatelnosti v metodice. Vedení navíc potřebuje sledovat několik ukazatelů, které
předem signalizují růst rizika (KRI), a CONTIX je z velké části umí spočítat z dat.

## Rozhodnutí

1. **Ochota riskovat** po kategoriích (důvěrnost, integrita, dostupnost, dodavatelé) v `risk_appetite` s vyjádřením vedení;
   schválení `risk_appetite_approvals` (kdo, kdy), změna po schválení se označí.
2. **Rizika nad ochotou** – kategorie rizika `riskCategories` (CIA hrozeb rizika včetně dalších hrozeb scénáře, dodavatel =
   `supplier_risks` nebo hrozby H11 / H19), překročení `appetiteBreach` (rozhoduje nejpřísnější stanovená kategorie). Počítá se při čtení.
3. **KRI** – katalog `KRI_KEYS` / `KRI_META` (jednotka, směr, schopnost, výchozí prahy); hodnoty z `measureCompany` /
   `capabilityDtos`, `threatCoverage` a `riskTriggers` (`refreshKris`); persistuje se jen nastavení a okamžik prvního překročení
   (`kri_settings.breached_since`), denně `processKriRefresh` v plánovači.
4. **Podnět `kri`** (ADR-058) – překročený KRI se schopností, kterou zmírňuje šablona přijatého / navázaného scénáře rizika,
   a okamžik překročení po základu rizika. Jen zobrazení (nemění `suggestFromTriggers`).
5. **Výstupy** – `appetiteSection` ve zprávě o hodnocení rizik (část 8) a ve zprávě o přezkoumání ISMS.

## Důsledky

- Vedení schvaluje měřitelná kritéria a vidí, kde je organizace nad nimi; odchylky se promítnou do přehodnocení rizik.
- Žádné automatické změny rizik; e-mailová upozornění na KRI zatím ne (podnět a přehled).
