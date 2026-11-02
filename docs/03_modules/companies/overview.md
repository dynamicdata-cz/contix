# Skupina společností (holding)

CONTIX eviduje jednu organizaci i skupinu: holding a dceřiné společnosti ve stromu (`companies`). Každá společnost je
samostatná povinná osoba – vlastní režim (vyšší / nižší povinnosti / neregulovaná), SoA, dokumenty ISMS, incidenty a lhůty hlášení.

## Datový model

- `companies`: strom (`parentId`), kořen `ROOT_COMPANY_ID` = dosavadní organizace (migrace 0009 převzala identitu z nastavení).
- `company_id` mají: uživatelé (domovská společnost), aktiva, discovery běhy, útvary, procesy, rizika, opatření, hodnocení
  požadavků (SoA), BIA, verze dokumentů, plány kontinuity, dodavatelé, změny, cíle ISMS, incidenty a audity.
- Vlastní nastavení společnosti (`overrides`), jinak se dědí od nadřazené: metodika rizik (`riskPolicy`), kritéria
  významných změn, únosná míra újmy z incidentu, příznak poskytovatele služeb vytvářejících důvěru.

## Role a oprávnění

- Role se přidělují **pro společnost** (`user_roles` / `group_roles` s `company_id`) a dědí se do podřízených společností.
  Role přidělená kořenu platí pro celou skupinu (např. manažer KB, architekt nebo auditor skupiny).
- Systémová oprávnění (`admin:*`, `audit_log:read`) platí jen z role na kořeni.
- Aktivní společnost: hlavička `x-contix-company` (u odkazů parametr `_co`), hodnota `group` = souhrnný pohled skupiny.
  V souhrnném pohledu platí průnik oprávnění přes dostupné společnosti a nové záznamy se zakládají do domovské společnosti.

## Sdílení v rámci skupiny („nezavírat vrátka“)

- Aktiva, funkční místa, opatření, dodavatelé a cíle holdingu jsou viditelné i v dceřiných společnostech (`visibleIds` =
  společnost + nadřazené). Vlastníkem aktiva dceřiné společnosti může být funkční místo holdingu.
- Opatření holdingu se započítávají do SoA dceřiné společnosti (příznak `inherited`).

## Pravidla pro vývoj

Každý dotaz nad daty společností musí používat `inScope(c, col)` (výpis), `assertScope(c, companyId)` (detail / změna)
nebo `targetCompany(c, requested, perm)` (založení). SoA a dokumenty potřebují jednu společnost (`soleCompany`).

## Omezení

- Přesun záznamu mezi společnostmi zatím není podporován.
- Vazby mezi záznamy různých společností se kontrolují jen na viditelnost (společnost + nadřazené).
- Přehled skupiny: `GET /api/companies/overview`, v UI „Přehled skupiny“.

## Přesun záznamů mezi společnostmi (v0.13)

`POST /api/companies/transfer` (aktiva, rizika, procesy vč. BIA, opatření, dodavatelé, incidenty, audity, změny, dokumenty,
školení, plány kontinuity, cíle ISMS). Vyžaduje oprávnění k zápisu ve zdrojové i cílové společnosti. Vazby na záznamy,
které z cílové společnosti nebudou viditelné (jiná větev skupiny), se nejdřív ohlásí – přesun proběhne až po potvrzení
(`force`). V UI tlačítko ⇄ v hlavičce detailu záznamu. Přehled skupiny ukazuje i stav ročního hodnocení rizik a BIA
a očekávanou roční ztrátu (FAIR).

## Organizace a společnosti (v0.13.1)

Organizační struktura navazuje přímo na společnosti z Administrace → Společnosti: kořenem stromu je společnost
(název, typ a režim se berou z administrace), pod ní útvary a funkční místa. V dceřiné společnosti jsou útvary holdingu
vidět jako „sdílené“ (jen ke čtení a k přiřazení funkčních míst). Výběry funkčních míst a útvarů ukazují název společnosti,
garantující útvar procesu se vybírá jen ze společnosti procesu. Pruh nad obsahem stránky ukazuje, ve které společnosti
uživatel pracuje; v souhrnném pohledu formulář nového procesu nabízí volbu společnosti.
