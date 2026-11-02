# ADR-095: Import výstupů skenerů, reimport, deduplikace a triáž zranitelností (inspirace DefectDojo)

- Stav: přijato
- Datum: 2026-10-22
- Verze: 1.00

## Kontext
Evidence zranitelností dosud plnil jen Wazuh. Organizace ale používají i síťové skenery (Nessus, OpenVAS), skenery webových aplikací
(Burp, ZAP, Nuclei), SCA a skenery kontejnerů (Trivy, Grype) a SAST (SARIF). DefectDojo řeší import, reimport, deduplikaci a triáž,
nemá ale vazbu na aktiva, rizika, opatření, CRA ani lokální AI.

## Rozhodnutí
1. **Parsery** (`vulnerabilities/parsers.ts`, čisté funkce): Nessus, OpenVAS/GVM, Burp, ZAP, Nuclei, Trivy, Grype, SARIF, obecné CSV → `ScanFinding`;
   formát `detectScanner`; XML jen přes fast-xml-parser (bez externích entit), limit souboru a počtu nálezů. Nic se neodesílá.
2. **Import = test** (`vuln_scans`): náhled (`mode=preview`) nic nezapisuje; zápis `commitScan` v transakci. Nález se páruje podle
   aktiva + `finding_key` (SHA-256 ze skeneru, pravidla, endpointu a komponenty). Nález s více CVE nese **reprezentativní CVE**
   (KEV → EPSS → první), ostatní v `related_cves`; u existujícího řádku se nemění.
3. **Životní cyklus** jako u Wazuhu: znovu nalezený vyřešený se otevře, výjimka po termínu se otevře; s `closeMissing` se nálezy téhož
   skeneru na skenovaných aktivech, které v souboru chybí, uzavřou. Stav triáže reimport nepřepíše.
4. **Stavy triáže**: `false_positive`, `out_of_scope`, `duplicate` (+ `verified`, `triage_reason`, kdo a kdy) – mimo semafor a lhůty
   (počítají se jen `open`). Duplicita jen vůči nálezu na stejném aktivu. Automatická duplicita: nový nález se stejnou CVE na aktivu,
   kterou hlásí jiný zdroj.
5. **Priorita** (`vulnPriority` / `vulnPrioritySql`): nově P2 i pro kritickou / vysokou zranitelnost dosažitelnou z internetu
   (`assets.internet_facing` nebo nález z externího skenu `exposed`).
6. **AI triáž importu** (`vuln_scan_triage`, `ai/usecasesVuln.ts`): duplicity napříč skenery i bez společné CVE, falešně pozitivní,
   nálezy k ověření; aktiva jen jako A1, A2 s typem (bez názvů), ID ověřená proti kontextu, aplikace jen po rozhodnutí člověka.

## Nezahrnuto (další krok)
Import z CI/CD přes API token, metriky (MTTR, stárnutí, burn-down), známka produktu, Qualys a Dependency-Track, automatické zakládání
aktiv z nespárovaných hostitelů.

## Důsledky
Unikátní index `asset_vuln_uq` rozšířen o `finding_key` (Wazuh má prázdný klíč). Všechny dotazy „otevřené“ dál filtrují `status = 'open'`.
