# ADR-083: Teplotní mapa pro maticové metodiky rizik

**Stav:** přijato (v0.87)

## Kontext
Od v0.84 dostávají společnosti mimo balíček CZ metodiku Matice 5 × 5. Stránka Rizika ukazovala teplotní mapu jen pro českou metodiku (příloha č. 4), u ostatních jen tabulku úrovní.

## Rozhodnutí
- Metodika s `matrix: { x, y }` má teplotní mapu: osy = stupnice faktorů, úroveň buňky = výsledek metodiky pro hodnoty os (`methodologyMatrix().levelAt`); pokud vzorec závisí i na jiném faktoru, buňka je neutrální.
- `/risks/summary` vrací `customMatrix` (počty [y][x] podle `cellOf` z `factorValues`) jen pro rizika hodnocená metodikou společnosti; metodiky bez matice (OCTAVE) dál ukazují tabulku úrovní.
