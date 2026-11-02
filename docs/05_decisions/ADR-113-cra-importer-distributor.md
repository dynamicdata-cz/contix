# ADR-113: CRA pro dovozce a distributory – doklady výrobce, oznámení CSAF, CPE a NVD (v1.16)

## Kontext

Organizace, které produkty s digitálními prvky dovážejí nebo distribuují (čl. 19 a 20 nařízení (EU) 2024/2847), nemají SBOM
výrobce – je součástí jeho technické dokumentace a výrobce ho zpřístupňovat nemusí. Jejich povinnosti jsou ověřovací
(CE, EU prohlášení o shodě, informace a pokyny podle přílohy II, údaje dovozce) a reakce na zranitelnosti (informovat výrobce,
nedodávat neshodný produkt, při závažném riziku informovat orgán dozoru). Informace o zranitelnostech potřebují i bez SBOM.

## Rozhodnutí

1. **Kontrola dokladů** = katalog `CRA_SUPPLY_CHECKS` (`shared/craSupply.ts`) podle role (dovozce / distributor), stav
   `missing | ok | na`, poznámka, odkaz (jen http/https), datum a kdo ověřil v `cra_products.supply_checks` (jsonb, jen stav –
   texty jsou v katalogu). Soubory dokladů v `cra_product_files` (SHA-256, limit 25 MB, stažení jen jako příloha se sandbox CSP).
   Neověřené povinné doklady = mezera `supply_checks_open`; SBOM-lokace je nepovinná.
2. **Konec podpory výrobce** se u dovozce / distributora eviduje v `support_until` (mezera `no_manufacturer_support`,
   `support_ending`); povinnost „konec podpůrného období“ (`cra_support`) platí pro všechny role.
3. **Oznámení výrobců CSAF 2.0**: jen nahrání souboru (nic se nestahuje ani neodesílá); zpracování jen `parseCsaf`
   (větve vendor / product_name / product_version / product_version_range, full_product_names, relationships, skupiny,
   product_status, flags = zdůvodnění VEX, remediations, CVSS); ukládá se zpracovaný obsah v `cra_advisories` (unikátně
   společnost + namespace + tracking ID, starší revize novější nepřepíše – 409).
4. **Párování** jen `csafFindingsFor` / `csafProductMatches`: přednostně CPE (výrobce + produkt, verze přesně nebo zástupně),
   jinak výrobce + název + verze (rozsah `vers:` přes `inVersRange`); u produktu více položek → nejhorší stav. Zápis jen
   `matchAdvisories` (`cra/supply.ts`) po nahrání oznámení a po změně CPE / názvu / verze / výrobce produktu: nálezy
   `source = csaf`, `component_ref = csaf:<namespace>/<tracking id>`, stav výrobce `vendor_status`. **Vlastní posouzení VEX
   se nepřepíše**, pokud se od posledního stavu výrobce liší; neplatné shody = `gone` (nemazat).
5. **NVD** jen na pokyn uživatele a jen je-li výslovně zapnuto (`app_settings` `cra.nvd`, mění `admin:settings`, výchozí
   vypnuto) – do NVD odchází jen řetězec CPE (`cpeQuery`, verze produktu doplní zástupný znak), max. 5 stránek; nálezy
   `source = nvd` ve stavu „prošetřuje se“, CVE, které NVD už nevrací, = `gone`.
6. Mezera `no_vuln_source`, pokud produkt dovozce / distributora nemá SBOM, CPE ani oznámení výrobce.
7. Přesun produktu do jiné společnosti přenese i `cra_findings` (nálezy z oznámení zdrojové společnosti zmizí).

## Důsledky

- Distributor má evidenci ověření dokladů pro orgán dozoru a zranitelnosti produktů bez SBOM; posouzení VEX zůstává jeho.
- Párování podle názvu je orientační – CPE je spolehlivější; UI to u oznámení bez shody vysvětlí.
- KEV / EPSS se u nálezů z CSAF a NVD vyhodnocují stejně jako u komponent (podle CVE).
