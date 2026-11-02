# ADR-075: Třídění seznamů a uložené pohledy (incidenty, SOC)

- Stav: přijato (v0.80)

## Kontext
Seznam incidentů měl jen hledání a čtyři pevné pohledy, fronta SOC jen filtry bez řazení a seskupení. Analytici potřebují rychle najít opakující se věci (stejný hostitel, pravidlo, kategorie) a vracet se k oblíbeným kombinacím filtrů.

## Rozhodnutí
- Filtry, řazení kliknutím na sloupec (`SortTh`, `sortRows` – prázdné hodnoty vždy na konec) a seskupení (`groupRows`) běží v prohlížeči nad načteným seznamem; API přidává jen filtry, které mění množství dat (SOC: `source`, `from`, `to`).
- Uložené pohledy `saved_views` (uživatel, stránka, název, stav, sdílený) – stav je jen nastavení UI, žádná data. Vlastní pohledy + sdílené ostatních; mění a maže jen vlastník; stejný název přepíše. API `GET/POST /incidents/views`, `/soc/views`, `DELETE …/views/:id` (oprávnění čtení stránky, audit).
- Uložený pohled se slučuje s výchozím stavem stránky (starší pohled bez nového pole funguje).
