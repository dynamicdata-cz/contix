# ADR-194: Prioritizace zranitelností – opravy místo nálezů

Stav: **přijato** (v1.100.0) – navazuje na ADR-049 (KEV/EPSS) a ADR-050 (lhůty oprav).

## Kontext

V provozu má organizace desítky tisíc otevřených zranitelností (např. 18 469, jen na jednom aktivu přes 2 800
prioritních). Přehled ukazoval syrový počet a povinnost „Oprava zranitelností“ tisíce položek – nebylo z toho
poznat, co udělat jako první. Plán oprav podle balíčků už existoval, ale byl schovaný na stránce Zranitelností.

## Rozhodnutí

1. **Jednotka práce je aktualizace balíčku**, ne CVE. Plán oprav ke každému balíčku počítá odstraněné prioritní
   (P1 + P2) zranitelnosti, kumulativní podíl ze všech otevřených prioritních (v pořadí plánu), cílovou verzi
   (nejčastější `fixedVersion` ze skeneru) a nejbližší termín podle lhůt priority (`vulnDueSql`).
2. **Souhrn zranitelností** nese `fixPlan` (prioritní celkem, počet balíčků, kolik odstraní 10 nejúčinnějších,
   tři nejlepší) – jedna SQL agregace, Přehled nemusí stahovat celý plán.
3. **Přehled** ukazuje jako hlavní číslo prioritní k opravě; celkový počet jen v popisku.
4. **Naplánovat opravu** zakládá běžný úkol (bez nové vazby ve schématu) – jen při zvolené jedné společnosti.
5. Povinnost na aktivu jmenuje nejúčinnější aktualizaci (`distinct on` přes balíčky aktiva).

## Důsledky

- Bez migrace. Zranitelnosti bez balíčku (nálezy webových skenerů, konfigurace) v plánu nejsou – podíl se počítá
  ze všech prioritních, takže je vidět, kolik zbývá mimo balíčky.
- Opakované „Naplánovat opravu“ založí další úkol; duplicitu hlídá uživatel (odkaz na založený úkol v řádku).
