# ADR-174: Ukázková data z Administrace (v1.81)

## Kontext

Ukázková společnost (ADR-112) se zakládala jen příkazem na serveru a nešla odstranit – společnost s daty nelze smazat
(ochrana skutečných dat). Pro předvádění a školení je potřeba ukázku rychle založit a po předvedení beze stop odstranit.

## Rozhodnutí

- `GET/POST/DELETE /api/demo` (`admin:settings`). Založení volá `seedDemo` přes stejná API jako aplikace s relací
  přihlášeného administrátora (validace, oprávnění, audit). Id ukázkové společnosti se uloží do `app_settings`
  (`demo.companyId`); ukázku založenou dříve příkazem `demo:seed` se najde podle názvu.
- Odstranění (`purgeCompany`) je povolené jen pro takto označenou společnost. V jedné transakci zruší vazby na nadřízené
  záznamy ve stromech (útvary, procesy, složky dokumentů) a maže řádky se `company_id` ve všech tabulkách v kolech –
  tabulka držená vazbou se zkusí v dalším kole (savepoint). Uživatele nemaže: jsou-li ve společnosti, odstranění
  skončí srozumitelnou chybou. Auditní záznamy (bez `company_id`) zůstávají.
- Ukázka nově ukazuje útvary u aktiv, dodavatelů a dokumentů, štítky a umístění.

## Důsledky

- Nová evidence se `company_id` se odstraní s ukázkou bez úprav kódu; nová evidence v ukázce = volání API v `demoData.ts`.
