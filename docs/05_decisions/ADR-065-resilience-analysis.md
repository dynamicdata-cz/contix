# ADR-065: Analýza odolnosti – BIA po grafu závislostí a jediné body selhání

**Stav:** přijato (v0.70.0)

## Kontext
BIA stanoví RTO / RPO procesu, ale požadavek se nepřenášel na servery, aplikace a síť, na kterých proces závisí.
Graf vazeb aktiv (ADR-063) umožňuje řetězec projít a najít slabá místa.

## Rozhodnutí
- `analyzeResilience` (`shared/resilience.ts`, čistá funkce, testovaná): každý uzel předá požadavky všemu, na čem
  tranzitivně závisí – nejpřísnější RTO / RPO procesů s BIA a nejvyšší kritičnost závislých aktiv. Nálezy:
  `spof` (neredundantní, RTO ≤ 24 h, nebo ≥ 3 závislé uzly s kritičností vysoká+), `criticality_gap`, `no_plan`
  (RTO ≤ 72 h bez plánu; plán procesu kryje jeho aktiva), `plan_rto` (cílové RTO plánu delší), `unhealthy`
  (RTO ≤ 24 h a červený semafor / P1), `bia_no_assets`. Závažnost podle RTO (≤ 4 h kritická, ≤ 24 h vysoká).
- Nový sloupec `assets.redundant` (formulář aktiva) – redundantní aktivum není SPOF.
- API `GET /assets/resilience` a `GET /assets/resilience/process/:id` (`resilienceFor` v `assets/graph.ts`); BIA a plány
  jen s modulem kontinuity a oprávněními `bia:read` + `processes:read`. Počítá se při čtení.
- UI: stránka Analýza odolnosti, překryv „Odolnost“ v grafu vazeb, karta v detailu BIA s převzetím do pole Závislosti
  (jen do formuláře – uloží uživatel).

## Důsledky
- Kvalita závisí na úplnosti vazeb (proces → aktiva, technické závislosti); `bia_no_assets` na mezery upozorňuje.
