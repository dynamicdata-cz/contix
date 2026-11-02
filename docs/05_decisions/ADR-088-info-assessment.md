# ADR-088: Posouzení dopadu informací regulátora, vydavatelé a země kanálů

**Stav:** přijato (v0.93)

## Kontext
Varování a upozornění NÚKIB (a dalších CSIRT) nejsou bezpečnostní událost ani incident – nic se nestalo. Jde o informaci o hrozbě, kterou povinná osoba posoudí, zohlední v analýze rizik a případně na ni reaguje (aktualizace, opatření). Incident management a SOC pracují s událostmi a incidenty; tato oblast je vstupem řízení rizik.

## Rozhodnutí
- Posouzení položky za společnost = `info_item_reviews` rozšířené o `id`, `status` (`assessing` / `not_applicable` / `affected` / `resolved`; uzavřené = `INFO_DECIDED`), odpovědné místo a termín; dotčená aktiva `info_assessment_assets`; navazující záznamy `info_assessment_links` (riziko, úkol, bezpečnostní událost – cíl musí být ze stejné společnosti). Starší posouzení = `resolved`.
- Návrh dotčených aktiv `suggest-assets`: CVE ze zprávy (`cveIdsOf`) ve zranitelnostech aktiv, pojmy produktů (`productTermsOf`) v softwaru / OS / výrobci / modelu / názvu – jen aktiva v rozsahu (včetně sdílených). Návrh se neaplikuje sám.
- Úkol se zdrojem `info_item` (sourceId = ID posouzení), riziko přes `/risks/new?infoItem=` (předvyplnění, vazba po uložení), událost jako incident druhu `event`. Vznik navazujícího záznamu přepne posouzení na „dotčeno“.
- Povinnost `info_assessment` (otevřené posouzení s místem a termínem); karta na detailu aktiva; vstup zprávy o hodnocení rizik (řádek „relevantní hrozby“) a přezkumu ISMS (`infoItemsForReport`).
- Kanály mají vydavatele a zemi; relevantní pro společnost = bez země, `EU` nebo jurisdikce profilu (`relevantFeeds`); počty v menu jen z relevantních kanálů.
