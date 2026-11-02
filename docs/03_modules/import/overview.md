# Import dat z Excelu / CSV (v0.21)

Menu **Import dat** (oprávnění k zápisu do dané evidence). Evidence: **aktiva, rizika, procesy, opatření, dodavatelé**.

1. **Soubor** – `.xlsx` (vybraný list; bez volby první list s daty) nebo `.csv` (oddělovač `;` `,` nebo tabulátor,
   UTF-8 i Windows-1250 z českého Excelu). Šablona `.xlsx` s listem *Nápověda* (povolené hodnoty) je ke stažení.
2. **Mapování** – sloupce se rozpoznají podle názvu (i bez diakritiky a podle synonym, např. „S/N“, „Garant“);
   lze je změnit ručně.
3. **Náhled** – každý řádek: *nový / aktualizace / přeskočen / chyba* s důvodem. Hodnoty výčtů lze psát česky
   („Vysoká“, „Redukce“), ano/ne, data `31. 12. 2026` i jako datum Excelu, seznamy oddělené čárkou.
4. **Import** – řádky bez chyby se zapíší; výsledek a neúspěšné řádky se zobrazí, do auditu se zapíše `import.completed`.

**Párování na existující záznamy** (ve zvolené společnosti): aktiva – sériové číslo, hostname, název; dodavatelé –
IČO, název; ostatní – kód, název. Existující záznam se v režimu *aktualizovat* změní **jen vyplněnými sloupci**;
v režimu *ponechat* se přeskočí. Duplicitní řádky v souboru se přeskočí.

**Odkazy:** vlastník rizika / procesu / opatření = název (nebo kód) funkčního místa z Organizace; vlastník aktiva =
e-mail uživatele. Neznámá hodnota je upozornění – pole zůstane prázdné, řádek se importuje.

Limity: 10 MB, 5 000 řádků na jeden import. Starý formát `.xls` uložte jako `.xlsx`.
