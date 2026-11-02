# ADR-011: Skupina společností (holding)

**Stav:** přijato · 1. 10. 2026

## Kontext

Zákazníci jsou často holdingy: více povinných osob s různým režimem, ale společný manažer KB, architekt a auditor;
aktiva, funkční místa a opatření holdingu sdílí dceřiné společnosti.

## Rozhodnutí

1. Jedna instance, strom `companies`; `company_id` na doménových tabulkách (výchozí kořen, takže existující data
   patří kořenové společnosti). Žádné samostatné databáze – skupinové přehledy a sdílení vyžadují společná data.
2. Role per společnost s dědičností dolů; role na kořeni = celá skupina. Systémová oprávnění jen z kořene.
3. Rozsah požadavku (`resolveScope`) z hlavičky / parametru; souhrnný pohled skupiny s průnikem oprávnění.
   Pomocníci `inScope`, `assertScope`, `targetCompany`, `soleCompany`, `visibleIds` jsou povinné pro každý dotaz.
4. Vlastní nastavení společnosti jako přepisy (`overrides`) dědí od nadřazené.
5. Migrace 0009 byla vygenerována `drizzle-kit` a **ručně upravena**: pořadí příkazů (sloupce před změnou PK),
   doplněné odstranění PK `requirement_assessments_pkey` a založení kořenové společnosti z `app_settings` (datový seed).
   Výjimka z pravidla „migrace ručně neupravuj“ – generátor neumí změnu PK s novým sloupcem ani seed.

## Důsledky

- Každý nový modul musí filtrovat přes pomocníky rozsahu (test izolace v `api.test.ts`).
- Přesun záznamů mezi společnostmi a konsolidovaný SoA skupiny jsou budoucí rozšíření.
