# ADR-087: Informační servis regulátora (NÚKIB)

**Stav:** přijato (v0.91)

## Kontext
NÚKIB zveřejňuje aktuality, varování a upozornění na zranitelnosti v RSS (https://nukib.gov.cz/rss.xml), statistiky nahlášených incidentů jako otevřená data (repozitář NUKIB/incidents-opendata, od 3/2025 archivovaný) a regulovaným subjektům zpřístupňuje Národní MISP. Varování NÚKIB musí povinná osoba zohlednit v hodnocení rizik.

## Rozhodnutí
- Modul Legislativa, stránka `/infoservice` (menu nahoře u Přehledu), API `/api/legislation/infoservice` (`modules/infoservice/routes.ts`). Jen stahování (GET) veřejných zdrojů, nic se neodesílá; server bez internetu = ruční nahrání (`/upload`).
- Parsery jen v `shared/infoservice.ts`: `parseRssFeed` (RSS 2.0 / Atom, text bez HTML, odkazy jen http(s) – `safeLink`), `classifyFeedItem` (varování / zranitelnost / přehled / metodika / aktualita podle názvu), `parseIncidentOpendata` (Rok/měsíc, Klasifikace ENISA, Závažnost, volitelně počet; řádek bez počtu = 1 incident), souhrn `summarizeIncidentStats` (při čtení, nepersistovat).
- Položky `info_feed_items` (globální, párování zdroj + guid – opakované stažení neduplikuje), posouzení za společnost `info_item_reviews` (seznámení, zohlednění varování; audit), statistiky `info_incident_stats` (nahrazuje se celý zdroj).
- Nastavení `app_settings.infoservice` (kanály jen https, interval, otevřená data); plánovač `processInfoService` s `acquireLease`.
- Národní MISP: žádné nové napojení – jen stav integrace z ADR-073 (hostitel, ověření, poslední stažení), bez klíčů.

## Doplnění (v0.92) – aktuální statistiky
Otevřená data končí 2022-08, novější čísla jsou jen v měsíčních PDF „Kybernetické incidenty pohledem NÚKIB“.
- Ruční údaje za měsíc v `info_incident_stats` se zdrojem `manual`: řádky podle klasifikace (závažnost `*`) a podle závažnosti (klasifikace `*`) – `ANY`; sloučení `mergeIncidentStats` (ruční měsíc nahradí otevřená data), souhrn `summarizeIncidentStats`.
- Návrh z PDF: `POST /stats/suggest` – položka RSS (stránka aktuality → odkaz na PDF, jen hostitelé nastavených kanálů, jen https) nebo nahraný PDF → text převodní službou (`pdfToText`) → model AI (`clientFor`) → `parseIncidentStatsProposal` (validace, kontrola součtů). Nic se neukládá, ukládá člověk přes `PUT /stats/manual`; audit `infoservice.stats_suggested` / `stats_saved`.
