# ADR-121: Vývoj rizik v čase a přehled skupiny (v1.24)

## Kontext

Analýza rizik z dat (ADR-114 až ADR-120) ukazuje aktuální stav. Vedení a přezkoumání ISMS potřebují vývoj v čase
a u skupiny společností porovnání dceřiných firem bez otevírání každé zvlášť.

## Rozhodnutí

1. Měsíční snímky trendů (ADR-042) rozšířeny o `risks_medium`, `risks_low`, `threat_coverage_pct`, `unassessed_threats`,
   `weak_capabilities`, `risks_over_appetite`, `kri_alerts`, `detection_blind`; hodnota null, když se daná oblast neměří.
2. Karta `TrendsCard` s těmito ukazateli na stránce Ochota riskovat a KRI.
3. Přehled skupiny `GET /risks/appetite/group` čte jen poslední `trend_snapshots` každé společnosti v rozsahu, kde má uživatel
   `risks:read` (žádný přepočet za všechny firmy při čtení), sloupce `GROUP_RISK_METRICS` a datum snímku.

## Důsledky

- Výkonné i pro velké skupiny (snímky počítá plánovač); stav je k datu snímku, ne okamžitý.
