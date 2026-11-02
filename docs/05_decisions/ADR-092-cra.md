# ADR-092: Cyber Resilience Act – produkty, SBOM a hlášení čl. 14

**Stav:** přijato (v0.97)

## Kontext
Nařízení (EU) 2024/2847 (CRA): hlášení aktivně zneužívaných zranitelností a závažných incidentů platí od 11. 9. 2026 (i pro produkty již na trhu; jednotná platforma ENISA – SRP), ustanovení o oznámených subjektech od 11. 6. 2026, ostatní povinnosti od 11. 12. 2027. Technický popis důležitých a kritických produktů: prováděcí nařízení (EU) 2025/2392.

## Rozhodnutí
- Modul `cra` (oprávnění `cra:read` / `cra:write`, upgrade 0.97). Evidence `cra_products` (company_id, přesun `cra_products` vč. hlášení), `cra_components` (SBOM), `cra_reports` (hlášení čl. 14).
- Kategorie `CRA_CATEGORIES` + položky příloh III/IV `CRA_CATEGORY_ITEMS`; přípustné postupy posuzování shody jen `craConformityOptions` (čl. 32).
- Požadavky jen katalog `CRA_REQUIREMENTS` (příloha I část I a II, povinnosti výrobce, dovozce, distributora a správce open source) filtrovaný rolí (`craRequirementsFor`); persistuje se jen stav `requirements`. Mezery `craProductGaps` při čtení.
- SBOM jen `parseSbom` (CycloneDX JSON, SPDX JSON; bez síťových dotazů, max. 5000 komponent); import nahradí seznam.
- Lhůty hlášení jen `craDeadlines` (24 h a 72 h od zjištění; závěrečná zpráva 14 dní od dostupnosti nápravy u zranitelnosti, 1 měsíc od oznámení u incidentu) – nepersistovat. Text pro SRP jen `buildCraReport` podle fáze (cs/en), nic se neodesílá. Podané hlášení nelze smazat; produkt s hlášeními také ne.
- Povinnosti `cra_report` (nejbližší nesplněná fáze) a `cra_support` (konec podpůrného období) v `collectObligations`.

## Důsledky
Párování komponent SBOM se zranitelnostmi (OSV/NVD) a export VEX zatím nejsou – CONTIX nemá offline databázi zranitelností pro softwarové balíčky produktu.
