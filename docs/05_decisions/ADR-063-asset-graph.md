# ADR-063: Graf vazeb aktiv s vrstvami a analýzou dopadu

**Stav:** přijato (v0.68.0)

## Kontext
Vazby primární ↔ podpůrné aktivum byly vidět jen jako seznam v detailu aktiva. Pro posouzení dopadu výpadku (BIA, § 8,
řízení změn, SOC) je potřeba vidět celý řetězec závislostí včetně technických vazeb mezi podpůrnými aktivy
(aplikace běží na serveru, server je v datovém centru, provoz jde přes firewall).

## Rozhodnutí
- Nová tabulka `asset_dependencies` (`from_id` závisí na `to_id`, druh `ASSET_DEP_KINDS`: běží na, využívá, síťově přes,
  umístěno v, zálohováno na; poznámka). Opačná závislost a závislost na sobě jsou odmítnuty. Zápis jen
  `POST/DELETE /assets/dependencies` (assets:write nebo vlastník jednoho z aktiv), audit. Sloučení aktiv ji přenese
  (obecné přesouvání cizích klíčů) a smaže smyčku.
- `GET /assets/graph` (`assets/graph.ts`): uzly = aktiva viditelných společností (bez vyřazených, nejvýše 1 500) a procesy
  (processes:read), hrany `supports` (asset_links), `depends` (asset_dependencies), `process` (process_assets) – vždy
  „zdroj závisí na cíli“. Překryvy podle oprávnění: zranitelnosti (vč. P1), otevřené alerty SOC (soc:read), rizika
  s nejvyšší úrovní (risks:read). Efektivní CIA jako v detailu (`effectiveCia`).
- Vrstvy `assetLayer` (procesy → primární → aplikace a data → infrastruktura → síť → lidé, dodavatelé a prostory),
  rozložení `layoutGraph` (pásy, zalomení dlouhých vrstev, barycentrické řazení – deterministické), analýza
  `impactOf` (co na uzlu závisí / na čem závisí) a `neighborhood` – vše v `shared/assetGraph.ts`, testováno.
- UI `/assets/graph`: SVG s přiblížením a posunem, vypínání vrstev a druhů vazeb, obarvení, hledání, detail uzlu,
  okolí 1–3 kroky, analýza dopadu, přidání / odebrání závislosti; v detailu aktiva karta technických závislostí.

## Důsledky
- Technické závislosti zatím nemění dědění CIA ani semafor (ty dál vycházejí z vazeb primární ↔ podpůrné).
- U velkých inventářů (stovky uzlů) je vhodné pracovat s okolím vybraného uzlu nebo vypnout vrstvy.
