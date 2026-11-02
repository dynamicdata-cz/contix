# Modul Procesy

Evidence a modelování procesů. Modul `processes` (závisí na modulu `organization`).

## Procesní karta

Název, kód, typ (**řídicí / hlavní / podpůrný**), stav (návrh / platný / zrušený), kritičnost, účel, popis a hranice,
spouštěč, vstupy/výstupy, frekvence, KPI, legislativa a interní předpisy. Vlastník = **funkční místo**
(ne osoba – při personální změně se mění jen obsazení místa v Organizaci), garantující útvar, nadřazený proces (hierarchie).
Každá změna zvyšuje `version`; vše se zapisuje do auditního logu.

## Kroky – zdroj pravdy

Kroky jsou seřazený seznam (`order`, přesun šipkami → `PUT /processes/:id/steps/order`). Krok má typ
(činnost, rozhodnutí, podproces, událost), popis, vstupy/výstupy, lhůtu, systémy a:

- **RACI** – funkční místo nebo celý útvar s rolí R (provádí), A (schvaluje/odpovídá), C (konzultován), I (informován).
  Na záložce Kroky je i **matice RACI** (kroky × účastníci). Doporučení: právě jedno A na krok.
- **Aktiva** – podpůrná aktiva použitá v kroku (aplikace, servery…). Aktiva procesu = přímo přiřazená (typicky primární:
  informace, služby) ∪ aktiva z kroků.

## Diagram BPMN 2.0

- Editor **bpmn-js** (bpmn.io, licence vyžaduje ponechat watermark). Načítá se líně jen na záložce Diagram.
- Dokud diagram není uložen, **generuje se z kroků**: dráhy (lanes) podle R (jinak A), rozhodnutí = exkluzivní brána,
  podproces = subProcess, včetně souřadnic (BPMNDI). Generátor: `packages/shared/src/bpmn.ts`.
- Uložený diagram se upravuje volně (větvení, paralelní brány, události) a ukládá jako XML (`processes.bpmn_xml`).
  Server odmítá XML s DTD/entitami (XXE).
- **Převzít úlohy do kroků**: úlohy z diagramu (v pořadí toku od startu) chybějící v krocích se přidají na konec.
- Export .bpmn (Camunda Modeler, Signavio, ADONIS…) a SVG.

## Oprávnění

- `processes:read` – číst; `processes:write` – zakládat, mazat, měnit vlastníka a hierarchii.
- **Držitel funkčního místa vlastníka** smí svůj proces upravovat (karta, kroky, diagram, aktiva, dokumenty) i bez `processes:write`.

## API

| Metoda | Cesta | Popis |
| --- | --- | --- |
| GET | `/api/processes?q&status&assetId` | seznam (strom se skládá na klientu) |
| POST/GET/PATCH/DELETE | `/api/processes[/:id]` | procesní karta |
| POST/PATCH/DELETE | `/api/processes/:id/steps[/:stepId]` | kroky vč. `raci` a `assetIds` |
| PUT | `/api/processes/:id/steps/order` | nové pořadí kroků |
| POST | `/api/processes/:id/steps/import` | úlohy z diagramu → kroky |
| PUT | `/api/processes/:id/assets` | přímo přiřazená aktiva |
| POST/DELETE | `/api/processes/:id/documents[/:docId]` | odkazy na dokumenty (http(s), file:, UNC) |
| GET/PUT/DELETE | `/api/processes/:id/bpmn` | diagram (GET vrací i vygenerovaný) |
| POST | `/api/processes/:id/bpmn/generate` | vygenerovat z kroků (neukládá) |
