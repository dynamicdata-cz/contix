# Modul CRA (v0.97)

Produkty s digitálními prvky podle nařízení (EU) 2024/2847 – viz ADR-092.

- **Produkty** (`/cra`): role organizace, kategorie (výchozí / důležitý I, II / kritický) a položka přílohy III / IV, postup posuzování shody, normy, oznámený subjekt, EU prohlášení, CE, podpůrné období, kontakt a CVD.
- **Požadavky**: příloha I část I a II a povinnosti podle role se stavem a dokladem.
- **SBOM**: import CycloneDX / SPDX JSON, ruční komponenty.
- **Hlášení čl. 14**: lhůty 24 h / 72 h / závěrečná zpráva, text pro platformu ENISA (cs/en), povinnosti v Mých povinnostech.
- **Dovozce a distributor (v1.16, ADR-113)**: kontrola dokladů výrobce (CE, EU prohlášení o shodě, příloha II, údaje dovozce; u dovozce technická dokumentace a posouzení shody) se stavem, poznámkou, odkazem a soubory; mezery `supply_checks_open`, `no_manufacturer_support`, `no_vuln_source`.
- **Oznámení výrobců CSAF 2.0** (`/cra?tab=advisories`): nahrání souboru, párování podle CPE / výrobce + název + verze (rozsahy `vers:`), nálezy `source = csaf` se stavem výrobce (`vendor_status`); vlastní VEX se novou revizí nepřepíše.
- **CPE a NVD**: CPE 2.3 u produktu; dohledání v NVD jen na pokyn a jen je-li zapnuto (Administrace – `cra.nvd`, výchozí vypnuto; odchází jen CPE).
