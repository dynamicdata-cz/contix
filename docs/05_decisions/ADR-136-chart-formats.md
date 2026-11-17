# ADR-136: Volitelný formát grafů, export a grafy ve zprávě pro vedení (v1.39)

## Kontext

Grafy trendů měly pevný tvar (čárové malé násobky, přepínač tabulky); do prezentací šly jen jako snímek obrazovky
a zpráva pro vedení ve Wordu měla jen tabulku posledních 6 měsíců.

## Rozhodnutí

1. Nastavení grafu `ChartPrefs` (shared): typ `CHART_TYPES` (čára, plocha, sloupce, tabulka), období 6 / 12 / 24 měsíců,
   měřítko `value` / `change` (změna od prvního měsíce: % u počtů, p. b. u procentních ukazatelů; nulový začátek
   → bez hodnoty), výběr a pořadí ukazatelů. Uloženo jen v prohlížeči (`contix.chart.<id>`), per karta.
2. Řady a formátování jen `seriesOf` / `fmtChartValue`; export a tisk jen `trendsSvg` (escapované popisky, bílé
   pozadí), CSV `trendsCsv` (středník, BOM). PNG na webu z SVG přes canvas.
3. Zpráva pro vedení: `management.html|docx?charts=&chart=&months=` (`ReportChartsQuery`, neznámé ukazatele se
   zahodí) – web posílá nastavení karty Vývoj ukazatelů. Tisk = inline SVG; Word = PNG z vlastního rastru
   `seriesPng` (`reports/png.ts`, bez nativních závislostí) + popisky v textu; `htmlToDocx` vkládá jen
   `<img src="data:image/png;base64,…">`.

## Důsledky

- Nová karta grafu = `TrendsCard` s vlastním `id`; ostatní grafy (teplotní mapa, rozložení) zatím pevné.
