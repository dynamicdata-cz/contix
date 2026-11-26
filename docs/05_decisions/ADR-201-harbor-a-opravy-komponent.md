# ADR-201: Harbor a opravy zranitelností komponent (CRA)

Stav: **přijato** (v1.107.0) – navazuje na ADR-093 (OSV a VEX), ADR-113 (CSAF / NVD) a ADR-101 (vazby CRA).

## Kontext

Výrobce (CRA čl. 13, příloha I část II) má zranitelnosti komponent bez zbytečného odkladu odstraňovat. Nálezy
produktu dosud říkaly, *co* je zasažené, ale ne *čím* to opravit. Zákazníci provozují vlastní registr Harbor, který
obrazy skenuje (Trivy) a zná opravené verze – nálezy se ale do CONTIXu přenášely ručně.

## Rozhodnutí

1. `cra_findings` dostaly `fixed_version` a `fix_links`; `osv_records` ukládají `references` (FIX, ADVISORY, PACKAGE…).
   Při párování OSV se spočítá nejnižší opravená verze rozsahu, do kterého verze komponenty patří (`osvFixedVersion`).
2. Příkaz aktualizace (`craUpgradeCommand`) se skládá podle ekosystému (purl / typ balíčku z Harboru) jen z
   bezpečných znaků – název a verze pocházejí z cizích dat.
3. **Harbor**: nastavení `cra.harbor` (URL, robotický účet, heslo AES-GCM, ověření TLS, interval); produkt má
   `harbor_ref` a `harbor_state`. Synchronizace čte jen `GET …/artifacts/{ref}?with_scan_overview=true` a
   `GET …/artifacts/{ref}/additions/vulnerabilities` (report `application/vnd.security.vulnerability.report; version=1.1`).
   Nálezy mají zdroj `harbor` a komponentu `harbor:<typ>:<balíček>@<verze>`; co v novém skenu chybí, je `gone`.
4. **Návrh VEX** (`vexSuggestion`) se počítá, neukládá: zmizelý nález v šetření / zasažený → „opraveno“; známá oprava
   u nálezu v šetření → „zasaženo“ s akcí. Přijetí (`POST /api/cra/:id/vex/suggestions`) nastaví stav a popis akce.
5. SBOM z Harboru (SPDX) se zatím nahrává ručně stávajícím importem SBOM – API pro stažení SBOM se mezi verzemi Harboru liší.

## Důsledky

- Opravená verze u OSV nálezů se doplní při příštím párování; odkazy (`references`) až po novém stažení databáze OSV.
- CONTIX do Harboru nic nezapisuje a nespouští sken – výsledky přebírá po skenu při nahrání obrazu.
