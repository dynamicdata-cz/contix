# ADR-102: Ovládání – rychlé hledání, filtry v adrese, potvrzovací dialog, neuložené změny, mobilní menu

**Stav:** přijato (v1.06)

## Kontext

Při ~35 položkách menu nešlo rychle skočit na záznam; filtry seznamů se ztrácely po návratu z detailu; mazání a
schvalování používalo `window.confirm` (90 míst); okno formuláře se zavřelo kliknutím vedle; rozepsaný formulář
šlo opustit bez varování; na telefonu menu chybělo; hledání posílalo dotaz na každý úhoz.

## Rozhodnutí

- **Rychlé hledání (Ctrl+K / ⌘K)** – `components/commandPalette.tsx`: stránky se čtou z vykresleného menu
  (oprávnění a moduly platí automaticky; sbalené skupiny zůstávají v DOM skryté), záznamy z `GET /api/search/quick`
  (`modules/search/quick.ts`, registr `DEFS` – evidence jen s čtecím oprávněním ve společnosti a zapnutým modulem,
  LIKE escapovaný, CVE odkaz), naposledy otevřené v `localStorage`, otázka pro AI jen předvyplní `/ask?q=`.
- **Filtry a záložky v adrese** – `useUrlParam` / `useUrlFlag` (`lib/urlState.ts`, zápis s `replace`), záložky
  `Tabs` + `useTab` (`components/ui/tabs.tsx`, role tab, šipky). Hledání se zpožděním `useDebounced` (`lib/utils.ts`).
- **Potvrzení a oznámení** – `askConfirm` / `toast` (`components/ui/overlay.tsx`, hostitel `OverlayHost` v aplikaci);
  `window.confirm` se v aplikaci nepoužívá (fallback jen bez hostitele – veřejné stránky).
- **Okno formuláře** – Esc zavírá, fokus na první pole a zůstává v okně, kliknutí vedle zavře jen nezměněný formulář.
- **Neuložené změny** – `useFormGuard(save)` (`lib/unsaved.ts`): `bind` na obal polí, odchod (`useBlocker`) i zavření
  okna se potvrdí; během ukládání a po uložení neblokuje; události z oken (`data-guard-ignore`) se nepočítají.
- **Mobilní menu** – stejný panel jako na počítači, vysouvací z horní lišty.

## Důsledky

E2E testy potvrzují dialog přes `addLocatorHandler`; záložky se hledají rolí `tab`. Další seznamy a formuláře
převádět na `useUrlParam` / `useFormGuard` postupně.
