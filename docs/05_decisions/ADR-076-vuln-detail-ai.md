# ADR-076: Detail zranitelnosti a AI rozbor s postupem odstranění

- Stav: přijato (v0.80)

## Rozhodnutí
- Stránka `/vulnerabilities/cve/:cveId` – data jen `GET /vulnerabilities/cve/:cveId` (výskyty v rozsahu uživatele, KEV/EPSS, priorita `vulnPriority`, termín `vulnDueSql`).
- Pevný postup bez AI: rodina OS `osFamilyOf`, příkaz `upgradeCommand` a ověření `verifyCommand` (`shared/vulnAdvice.ts`); název balíčku se do příkazu vloží jen po kontrole znaků (`SAFE_PKG`), jinak žádný příkaz.
- AI rozbor `POST …/advice` (ai:use): kontext `adviceContext` – CVE, CVSS, popis, KEV/EPSS, balíčky, verze, rodiny a názvy OS s počty; **nikdy názvy aktiv, hostitelů ani osob**. Odpověď JSON → `parseVulnAdvice` (odolné vůči textu okolo, odkazy jen http(s)). Uloží se do `vuln_advice` (společnost + CVE + jazyk), audit `vuln.advice_generated`. Jen návrh – nic se neaplikuje.
