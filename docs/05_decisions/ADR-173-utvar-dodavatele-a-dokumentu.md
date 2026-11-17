# ADR-173: Odpovědný útvar dodavatele a dokumentu (v1.80)

## Kontext

Útvar jako centrum (ADR-169) ukazoval aktiva, procesy, rizika, opatření a úkoly. Dodavatelé a dokumenty k útvaru
vazbu neměli, takže vedoucí útvaru neviděl, které smlouvy a předpisy spravuje.

## Rozhodnutí

- Sloupce `suppliers.owner_unit_id` a `policies.owner_unit_id` (FK na `org_units`, při smazání útvaru `null`),
  migrace 0124. Stávající dokumenty dostaly útvar funkčního místa gestora.
- API: útvar musí patřit do společnosti záznamu (`assertUnitInCompany` v `org/hierarchy.ts`), jinak 400.
  Nový dokument bez útvaru převezme útvar gestora. Útvar dokumentu mění jen správce dokumentace (jako ostatní zařazení).
- Seznamy: `GET /suppliers?unit=` a `GET /policies?unit=` (útvar včetně podřízených, `unitSubtreeSql`).
  `ownerUnitName` v seznamech i detailu.
- Přehled útvaru (`OrgUnitOverviewDto`) doplněn o `suppliers` (aktivní) a `documents` (nezrušené).
- Hromadné úpravy dodavatelů a import dodavatelů rozšířeny o útvar.

## Důsledky

- Útvar dokumentu se při změně gestora sám nemění – jde o samostatné zařazení.
