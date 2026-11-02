# ADR-044: Vektory záznamů – rizika, zranitelnosti, incidenty, výjimky

**Stav:** přijato (v0.49.0)

## Kontext
Vyhledávání podle významu (bge-m3 na lokálním modelu) existovalo jen pro platnou dokumentaci (ADR o „Zeptej se dokumentace“).
Analytik u incidentu nebo rizika potřebuje vidět podobné dřívější případy a ptát se evidencí běžnou řečí s odkazy na záznamy.

## Rozhodnutí
- Tabulka `record_vectors` (`kind` + `ref_id` unikátní, `company_id`, titulek, text, `search_text`, odkaz, `meta`, `content_hash`,
  embedding, model, chyba). Druhy `RECORD_KINDS`: riziko, zranitelnost (seskupená po společnosti a CVE, jen otevřené/akceptované),
  incident, výjimka.
- Index plní plánovač (`processRecordIndex`, dávky po 16, časový limit): přeindexuje při změně obsahu nebo modelu, maže zaniklé
  záznamy, chyby zkouší znovu po hodině. Do textu se nedávají jména osob ani e-maily (data zůstávají na lokálním modelu).
- Zapíná se v AI nastavení `recordSearchEnabled` (výchozí vypnuto); bez embeddingu funguje náhradní hledání podle slov.
- API `/api/records`: `status`, `reindex` (admin:settings), `search`, `similar` (práh skóre 0,45; 404, když uživatel nevidí zdroj),
  `ask` (ai:use, auditováno, odpověď jen z poskytnutých záznamů s citacemi [n]).
- Oprávnění: `RecordAccess` podle čtecích oprávnění a zapnutých modulů (riziko → risks:read, zranitelnost → assets:read,
  incident → incidents:read, výjimky jako v přehledu výjimek) a dostupných společností.
- UI: přepínač a stav indexu v Administrace → AI asistent, karta **Podobné záznamy** u incidentu a rizika.

## Důsledky
- Nový druh = `RECORD_KINDS` + `RECORD_LABELS` + větev v `collectRecordDocs` + `RECORD_ACCESS`.
- Odvozená data `record_vectors` se mažou s firmou; po změně embedding modelu se vše přeindexuje.
- Jednotný AI vstup na nástěnce (v0.50) využije `searchRecords` jako jeden ze zdrojů.
