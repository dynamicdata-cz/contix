# ADR-133: Nová kostra vzhledu – horní lišta, oblíbené, záhlaví stránky (v1.36)

## Kontext

Návrh vzhledu (směr A „Klidná evoluce“, odsouhlaseno) – současná kostra měla tři pruhy nad obsahem (pruh
společnosti, drobečková navigace s tlačítkem Zpět, nadpis), zdvojený výběr společnosti, dlouhé menu bez zkratek
a záhlaví s mnoha stejně důležitými tlačítky, které se zalamovala; záložky se zalamovaly do dvou řádků.

## Rozhodnutí

1. **Horní lišta** `TopBar` (`components/topbar.tsx`): výběr společnosti (`DropdownMenu`, celá skupina / stromová
   nabídka), hledání a příkazy (otevírá `CommandPalette`), zvonek s počtem povinností (→ Moje práce) a nabídka
   uživatele (profil, odhlášení). Nahrazuje `ActiveCompanyBar`, hledání, výběr společnosti a uživatele v bočním menu
   (na telefonu zůstává `CompanySwitcher` v menu).
2. **Oblíbené** v menu: hvězdička u položky, seznam cest v `localStorage` (`contix.nav.favorites`, max. 12 – jen
   pohodlí prohlížeče); položky se klonují z vykreslených skupin (registr plněný `NavGroup`), skupiny se dál
   neodmontovávají (čte je rychlé hledání).
3. **Záhlaví stránky** `PageHeader`: `actions` = hlavní akce, `more` = vedlejší akce v nabídce „Další“ (`DropdownMenu`,
   položky `MenuItem`), `nav` = podsekce modulu (`SubNav`, aktivní podle adresy). Rizika mají podsekce `useRiskNav`.
4. **Záložky** se nezalamují (vodorovné posouvání), drobečková navigace je kompaktní (Zpět jako ikona),
   ukazatel bez předchozího měsíce trend nezobrazuje.

## Důsledky

- Nové stránky: méně tlačítek v záhlaví – vedlejší akce do `more`, části modulu do `nav`.
- Sticky záhlaví detailu je pod horní lištou (`top-14`).
