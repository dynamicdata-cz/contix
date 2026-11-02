# ADR-093: Zranitelnosti komponent produktů (OSV) a VEX

**Stav:** přijato (v0.98)

## Kontext
CRA vyžaduje identifikovat a řešit zranitelnosti komponent (příloha I část II) a hlásit aktivně zneužívané zranitelnosti (čl. 14). SBOM produktů už CONTIX eviduje (ADR-092); chybělo párování se zranitelnostmi a prohlášení o zasažení (VEX).

## Rozhodnutí
- Zdroj = **OSV** (otevřená databáze, schema 1.x). Globální tabulky `osv_records` (kompaktní záznam: aliasy, souhrn, závažnost, `affected` s výčtem verzí a rozsahy SEMVER / ECOSYSTEM) a `osv_packages` (index ekosystém + název). Jen **stahování** `<base>/<ekosystém>/all.zip` (výběr ekosystémů v nastavení `cra.osv`, plánovač jednou denně `maybeRefreshOsv`) nebo **ruční nahrání** ZIP / JSON – nic se neodesílá (žádné dotazy na API OSV s názvy balíčků).
- ZIP se čte po souborech (`osvRecordsFromZip`, fflate `Unzip`), záznamy > 5 MB se přeskočí; zápis jen `storeOsvRecords`.
- Párování jen `matchProducts` (lokálně): komponenta → `purlToOsv` (pkg:generic a typy bez OSV se nepárují) → kandidáti podle názvu → `osvAffects` (výčet verzí, rozsahy introduced / fixed / last_affected / limit, obecné `compareVersions`). Výsledek `cra_findings` (unikátní produkt + `component_ref` + ID; `component_ref` = purl nebo název@verze, protože import SBOM komponenty nahrazuje). Zmizelá shoda = `gone`, nic se nemaže (historie VEX).
- VEX = stav nálezu (`VEX_STATUSES`, OpenVEX), „nezasaženo“ vždy se zdůvodněním (`VEX_JUSTIFICATIONS`). Export jen `buildOpenVex` (OpenVEX 0.2.0) a `buildCycloneDxVex` (CycloneDX 1.5, mapování stavů a zdůvodnění).
- KEV / EPSS z `vuln_intel` (ADR-049) podle CVE v ID a aliasech (`cvesOf`) – KEV = mezera `vulns_kev` a návrh hlášení čl. 14 (jen předvyplní formulář).

## Důsledky
Porovnání verzí je obecné (ne plná sémantika PEP 440 / Maven / Debian) – shoda je orientační a potvrzuje ji člověk ve VEX. NVD / CPE (komponenty mimo balíčkové ekosystémy) a CSAF advisory zatím nejsou.
