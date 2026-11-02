# ADR-105: Rychlost načítání a jednotné seznamy

**Stav:** přijato (v1.09)

## Kontext

Web se načítal jako jeden balík 3,7 MB (≈1 MB gzip) včetně anglických textů a nápovědy, které česky pracující
uživatel nepotřebuje. Řazení a uložené pohledy měly jen incidenty a SOC.

## Rozhodnutí

- **Stránky po částech**: každá stránka routeru je `lazyRouteComponent` (`main.tsx`); načítá se při otevření,
  při najetí na odkaz se přednačte (`defaultPreload: "intent"`), mezitím `PagePending` (skeleton). Statické zůstávají
  jen obrazovky přihlášení a stránky použité přímo v JSX.
- **Angličtina na vyžádání**: vestavěný anglický balíček je samostatný modul `@contix/shared/i18n/en` (`EN_PACK`);
  web ho načte až pro jiný jazyk než češtinu (`I18nProvider`, do načtení nic nevykreslí). API dál používá
  `BUILTIN_PACKS`.
- **Seznamy**: řazení `SortTh` + `sortRows` a uložené pohledy `SavedViews` u rizik, opatření a dodavatelů; řazení
  v adrese `?sort=klíč:směr` (`useUrlSort`), pohled nastaví více parametrů najednou (`useUrlBatch`). Trasy
  `/…/views` jsou registrované před routery s `/:id`. Záhlaví řazení má `scope="col"`.

## Důsledky

Úvodní načtení ≈1,6 MB (≈0,5 MB gzip). Nová stránka v `main.tsx` = `lazyRouteComponent(() => import(...), "Název")`.
Nový seznam s pohledy = `VIEW_PAGES` + `VIEW_BASE` (web) + `savedViewRoutes` v `app.ts` před routerem.
