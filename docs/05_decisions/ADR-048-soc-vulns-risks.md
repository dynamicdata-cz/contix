# ADR-048: SOC III – alerty × zranitelnosti, rizika a zpráva pro vedení

**Stav:** přijato (v0.53.0)

## Kontext
SOC (ADR-046/047) pracoval s alerty odděleně od evidence zranitelností a registru rizik. Pokus o zneužití
na aktivu se známou otevřenou zranitelností je přitom výrazně nebezpečnější a opakované útoky na aktiva rizika
jsou podkladem pro přehodnocení pravděpodobnosti. Vedení potřebuje souhrn SOC ve zprávě.

## Rozhodnutí
- **Expozice** `alert_suggestions.exposure` (jsonb) počítá jen `refreshExposure` (po Wazuh synchronizaci, při ručním alertu,
  v plánovači – zranitelnosti se mění): `cve_match` (alert zmiňuje CVE otevřenou na aktivu – popis, název, vzorek včetně
  `data.vulnerability.cve`), `exploit_technique` (technika z `EXPLOIT_TECHNIQUES` + vysoká / kritická zranitelnost),
  `vulnerable_asset` (jen informace). Bez aktiva se nepočítá.
- **Závažnost** = `effectiveLevel(ruleLevel, exposure)`: při zneužití +3 úrovně = o jeden stupeň (stupně jsou po 3), max. 15.
  V SQL stejný výraz `effLevelSql` (filtr, řazení, souhrny, AI nástroj); lhůty a závažnost případu z efektivní úrovně.
  Původní `rule_level` se nemění (statistika pravidel).
- **Rizika**: detail alertu i případu vrací `risks` = rizika navázaná na jejich aktiva (`linkedRisks`, jen `risks:read`
  a zapnutý modul). `GET /soc/risk-signals/:riskId` (soc:read + risks:read) = alerty na aktivech rizika za 90 dní,
  skutečné útoky, pokusy o zneužití, taktiky, `reassess` – UI jen doporučí přehodnocení, riziko se nemění.
- **Zpráva pro vedení**: sekce `soc` (`socReportStats` – alerty za období, eskalace, verdikty, podíl falešných poplachů,
  medián doby do převzetí, položky po lhůtě, pokusy o zneužití, nejčastější taktiky) + ukazatel `soc`; v HTML / Wordu
  kapitola 5.1.
- AI rozbor alertu dostává popis vazby na zranitelnosti (bez jmen osob).

## Důsledky
- Kdekoli se z alertu odvozuje závažnost, použít `effectiveLevel` / `effLevelSql`.
- Nová technika zneužití = `EXPLOIT_TECHNIQUES`.
