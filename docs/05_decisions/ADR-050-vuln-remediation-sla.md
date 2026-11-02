# ADR-050: Lhůty oprav zranitelností a semafor podle priority

**Stav:** přijato (v0.55.0)

## Kontext
Prioritizace (ADR-049) říká, co opravit nejdřív, ale ne do kdy, a nikoho na to neupozorní. Semafor aktiv vycházel jen
z počtu kritických / vysokých CVE, takže servery s tisíci CVE byly červené vždy a aktivně zneužívaná zranitelnost se
v tom ztratila.

## Rozhodnutí
- **Lhůty** podle priority (`VulnSla`, výchozí P1 7, P2 30, P3 90 dní, P4 bez lhůty), uložené u nastavení zdrojů hrozeb
  (`vuln.intel.sla`, admin:settings). Termín `vulnDue` / `vulnDueSql`: od prvního zjištění, u KEV nejdřív od data zařazení
  do katalogu (stará CVE nově v KEV dostane plnou lhůtu P1). Počítá se při čtení, nepersistuje.
- Výpis: `due`, `overdue`, filtr `overdue=1`; souhrn `overdue`.
- **Povinnost** `vuln_remediation` (`vulnRemediationItems`): jedna položka za aktivum s otevřenými P1 / P2 (nejbližší
  termín, počet po termínu); osobně vlastníkovi aktiva (`owner_user_id` – aktiva zatím nemají funkční místo), v týmovém
  přehledu všem s přístupem k aktivům. P3 povinnost nevytváří (tisíce položek by přehled zahltily).
- **Semafor**: `HealthPolicy.redOnP1` (výchozí zapnuto) – otevřená P1 = červená s důvodem `p1_cve`. Po uložení KEV / EPSS
  se semafor přepočítá (`recomputeHealth`).
- **Zpráva pro vedení**: `vulnRemediation` (P1, P2, KEV, po termínu, opraveno za období a podíl v termínu), ukazatel `vulns`,
  kapitola 4.1; **trendy** `vulns_p1`, `vulns_sla_overdue` (na nástěnce a ve zprávě).

## Důsledky
- Po prvním nasazení budou CVE s dávným prvním zjištěním hned po termínu – odpovídá to skutečnosti; lhůty lze upravit.
- Vlastnictví aktiva přes funkční místo by umožnilo povinnosti podle míst (možné rozšíření).
