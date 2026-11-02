# ADR-032: Vazby dokumentu (hierarchie, související dokumenty, požadavky, procesy, aktiva, rizika, dodavatelé)

**Stav:** přijato (v0.31.0)

## Kontext
Řídicí dokumentace podle § 6 vyhl. 409/2025 tvoří hierarchii (politika → směrnice → postup / standard) a každý dokument
naplňuje konkrétní ustanovení předpisů a řídí konkrétní procesy, aktiva, rizika či dodavatele. Dosud šlo dokument navázat
jen na opatření a oddíly vyhlášky; „Nadřazený dokument“ a „Právní vazba“ existovaly jen jako text v souborech.

## Rozhodnutí
- `policies.parent_id` – nadřazený dokument (ON DELETE SET NULL), cyklus brání `parentCycle` (shared, API i UI).
- Vazební tabulky `policy_related` (obousměrná – uloženo jednou, čte se oběma směry), `policy_processes`, `policy_assets`,
  `policy_risks`, `policy_suppliers` (index na cíl) a `policy_requirements` (stabilní ID požadavku z `shared/frameworks`).
- Vazby jsou součástí `PolicyInput` (`parentId`, `relatedIds`, `requirementIds`, `processIds`, `assetIds`, `riskIds`, `supplierIds`);
  zápis jen `setLinks` v `policies/routes.ts`: cíle musí patřit společnosti dokumentu nebo nadřazeným (holding), neznámý požadavek = 400.
  Vazby smí měnit správce dokumentace i gestor (věcný obsah), opatření dál jen správce.
- Zobrazení na kartě záznamu: `GET /api/policies/linked?kind=process|asset|risk|supplier|control|requirement&id=…`
  (oprávnění `policies:read`, filtr `inScope`), komponenty `LinkedDocsCard` / `LinkedDocsInline`.
- Přesun dokumentu mezi společnostmi ruší vazbu nadřazený/podřízený mimo přesouvanou skupinu.

## Důsledky
Dokumentaci lze procházet jako strom a z pohledu procesu, aktiva, rizika, dodavatele, opatření i požadavku (SoA) je vidět,
kterými dokumenty je řízen. Vazby se neverzují se schválenou verzí (jsou to metadata dokumentu, změny jsou v auditním logu).
