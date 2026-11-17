# ADR-179: Jednotný vzhled a detail záznamu jako přehled (v1.84)

Stav: **přijato**

## Kontext

Stránky se postupně rozcházely: různé dlaždice s čísly, odkazy zpět nad nadpisem, drobečková navigace končící slovem
„Detail“ a detaily záznamů otevřené rovnou jako editovatelný formulář – snadno se něco přepsalo omylem a přehled
byl málo čitelný (rámečky, prázdná pole, maska data).

## Rozhodnutí

- Výchozí motiv `night` (`lib/theme.ts`) v tónech přihlášení: v tmavém režimu soumračný levandulový podklad stránky
  (gradient na `body`) a tmavě modré povrchy (`--color-white`, lišta, boční panel); ve světlém režimu jemně levandulový
  podklad a bílé karty. Text přímo na podkladu je světlejší – škála se přepíše v `.app-main` a uvnitř povrchů
  (`[class*="bg-white"]`, dialogy, nabídky) se vrátí (kontrast ≥ 4,5 : 1). Přihlášení (`.auth-night`) má pevné tóny,
  stejné v obou režimech. Motivy se dál přepínají proměnnými CSS přes `html[data-theme]`.
- Čísla na stránkách jen komponentou `Kpi` (`components/ui`). Název stránky nastavuje `PageHeader` (`setPageTitle`)
  a drobečková navigace jím končí; odkazy zpět nad nadpisem se nepoužívají.
- Detail záznamu se otevře ke čtení. Vlastní přehled (`ViewSection`, `ViewItem`, `Chips` z `components/detailView.tsx`)
  mají rizika, opatření, dodavatelé, GDPR a aktiva; ostatní detaily obalí stávající formulář do `FormView`
  (zakázaný fieldset `.ctx-view` – bez rámečků, pomlčka u prázdných polí, bez nápověd). Úpravy přepíná `EditActions`
  (*Upravit* / *Uložit* / *Zrušit úpravy*), oprávnění k úpravě se nemění. Nový záznam se zakládá rovnou ve formuláři.
- Průběžné akce (hlášení, zjištění, verze, testy, úkoly) nejsou vázané na režim úprav.

## Důsledky

- Nový detail = přehled nebo `FormView` + `EditActions`; e2e testy před úpravou klikají na `detail-edit`.
