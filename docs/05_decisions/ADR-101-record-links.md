# ADR-101: Vazby mezi záznamy – klikací vazby, zpětné vazby, CRA produkt a zjištění × opatření

**Stav:** přijato (v1.05)

## Kontext

Vazby mezi evidencemi existovaly v databázi (tabulky `incident_*`, `change_*`, `activity_*`, `ai_system_*`, `plan_*`,
`supplier_*`, cizí klíče `audit_findings.risk_id`, `risk_treatment_actions.control_id`…), ale v aplikaci byly vidět
jen jedním směrem a vybrané položky nešly rozkliknout. Produkt CRA nebyl propojen s ničím mimo CRA a zjištění auditu
nešlo navázat na opatření.

## Rozhodnutí

- **Klikací vazby:** `IdMultiSelect` má `linkKind`, `AssetPicker` odkazuje vždy; cesty k detailům jen `recordPath`
  (`shared/links.ts`, `RECORD_PATHS`).
- **Zpětné vazby:** `GET /api/links/:target/:id` (`modules/links`) pro aktivum, proces, riziko, opatření a dodavatele;
  druhy a jejich zobrazení u cíle jen `BACKLINKS_FOR`, oprávnění a modul druhu `BACKLINK_ACCESS`, dotaz v `query()`.
  Cíl musí uživatel smět číst (aktivum i sdílené – `assetVisible`), každý navázaný záznam jen s čtecím oprávněním
  jeho evidence ve společnosti záznamu. Počítá se při čtení, nic se nepersistuje. UI `LinkedRecordsCard`.
  Nový druh = `BACKLINK_KINDS` + `BACKLINKS_FOR` + `BACKLINK_ACCESS` + větev v `query()` + popisek + test.
- **CRA produkt:** tabulky `cra_product_assets / _suppliers / _processes / _risks` (`craLink`), `GET/PUT /cra/:id/links`
  (cíle jen ze společností v rozsahu, aktiva přes `assetVisible`). Riziko z nálezu jen na pokyn
  `POST /cra/findings/:id/risk` (`risks:write`, jednou – `cra_findings.risk_id`), naváže produkt a jeho aktiva.
- **Zjištění auditu × opatření:** `audit_findings.control_id`; riziko i opatření zjištění jen ze společnosti auditu.
- Karta úkolů doplněna u rizika, dokumentu, auditu a činnosti zpracování; případy SOC na kartě SOC incidentu.

## Důsledky

Navigace mezi evidencemi oběma směry bez nových duplicitních dat. Další vazby (pozice → vše, kompenzační opatření
u výjimek, AI systém × riziko) lze doplnit stejným registrem.
