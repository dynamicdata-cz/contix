# ADR-094: AI automatizace pro AI Act, CRA a incidenty; vektory a vazby modulů

- Stav: přijato
- Datum: 2026-10-22
- Verze: 0.99

## Kontext
Moduly AI Act, SOC 2 a CRA (v0.95–0.98) neměly napojení na úkoly, vyhledávání podle významu ani AI návrhy. Revize vazeb ukázala chybějící úkoly, vektory a nástroje AI asistenta.

## Rozhodnutí
1. Nové AI úlohy (lokální model, vzor prepare → validate → apply po rozhodnutí člověka):
   - `ai_act_screening` – návrh polí screeningu (položky `set`); po přijetí přepočet klasifikace, zakázaná praktika vrací rozhodnutí.
   - `vex_triage` – návrh VEX stavu/odůvodnění pro nálezy „under_investigation“ (max. 30, kontext KEV/EPSS; položky `vex`).
   - `incident_triage` – návrh druhu, kategorie, příčiny a porušení OÚ; RAG z podobných incidentů omezený na záznamy čitelné uživatelem (`recordAccessFor`).
2. Vektory: RECORD_KINDS rozšířeny o audit_finding (vč. výjimek SOC 2), ai_system, cra_finding; nový endpoint `POST /search/records/related` pro kartu Související záznamy.
3. Úkoly: TASK_SOURCES ai_system, cra_product, soc2 včetně přesunu mezi společnostmi.
4. AI asistent: nástroje `cra_products`, `soc2_engagements`.

## Nezahrnuto
Automatická triáž na pozadí – chybí kontext oprávnění uživatele. Vazby dokument ↔ AI systém/produkt, vznik rizika z KEV nálezu a dlaždice přehledu jsou kandidáty na další verze.

## Důsledky
Data neopouští server; každý návrh se loguje a aplikuje jen po přijetí.
