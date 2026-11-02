# ADR-086: Výstupy a hlášení podle rámce společnosti

**Stav:** přijato (v0.90)

## Kontext
Zpráva o hodnocení rizik, plán zvládání, přezkum ISMS a podklad pro hlášení incidentu citovaly natvrdo vyhlášku č. 409/2025 Sb. a zákon č. 264/2025 Sb. – i u finančního subjektu (DORA), společnosti s nižšími povinnostmi (410) nebo mimo Česko (NIS2, ISO/IEC 27001).

## Rozhodnutí
- `shared/reportBasis.ts`: `ReportBasis` (popisek rámce, právní základ a název dokumentu podle druhu, odkazy pro zprávu o rizicích a přezkum) pro cz409, cz410, dora, nis2, iso27001 a obecný rámec; výběr `reportBasisOf(profil)` (finanční subjekt → DORA, jinak hlavní rámec), SoA `reportBasisFor(rámec SoA)`.
- Základ se zmrazí do `SnapshotMeta.basis` (`metaOf`) – starší snímky bez něj se vykreslují jako vyhláška 409 (`LEGACY_REPORT_BASIS`). Render bere odkazy jen z basis (`refIn`), název verze `basis.titles[kind]`.
- Hlášení incidentu: `buildIncidentReport` – právní základ `incidentLegalBasis(regime)`, u DORA název podle druhu zprávy, adresát `recipientName` (orgán dohledu `doraAuthorityOf`), LEI z `companies.dora`, oddíl klasifikačních kritérií 2024/1772 a povinná pole `REQUIRED_DORA`; tiskový podklad se skládá z téhož návrhu.
- Zpráva pro vedení: `basisLabel` a u finančního subjektu KPI `dora_incidents`, `dora_third_parties` (`doraRegisterOf` za společnost), `dora_testing` (dokončená cvičení v období).
- Výběry rámce ve webu jen `FrameworkOptions` (sledované nahoře podle `/controls/frameworks`, bez oprávnění podle `baseFrameworks`).
