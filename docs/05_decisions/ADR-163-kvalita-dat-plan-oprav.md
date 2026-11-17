# ADR-163: Kvalita dat, priorita a plán oprav nálezů, kontrola před vydáním (v1.70)

## Kontext

Úkoly, eskalace i zprávy stojí na odpovědnosti v datech (vlastník, garant, funkce) – slabiny byly roztroušené
v průvodcích. Seznam nálezů byl řazený jen podle závažnosti. Po řadě rychlých vydání (1.60–1.69) bylo potřeba
zkontrolovat závislosti, veřejný export a výkon.

## Rozhodnutí

1. **Kvalita dat** (`modules/quality`): kontroly jako SQL nad tabulkou (`CHECK_SQL`, alias x, sloupce id / company_id /
   label / link), jen společnosti s čtecím oprávněním evidence a zapnutým modulem, nejvýš 200 položek + počet.
   Hromadná oprava jen tam, kde odpovědnost chybí (`… is null`), osoba aktivní, funkce ze společnosti záznamu, audit
   `quality.bulk_fix`; technický garant → přepočet úkolů z nálezů. Skóre = podíl kontrol bez nálezu.
2. **Priorita** `findingPriority` (shared, deterministicky): závažnost 40/25/12/4/1, internet +15, kritičnost aktiva
   +12/+8/+3, po termínu +10. Seznam nálezů se řadí podle ní.
3. **Plán oprav** (`findings/plan.ts`): nejvýš 60 otevřených nálezů aktivní společnosti podle priority, pseudonymy
   F (nález), H (server), A (aktivum), u sběrače bez předmětu; odpověď jen přes `parseFindingPlan` (známé reference,
   bez duplicit). Poslední plán v `app_settings` (`findings.plan.<společnost>`), při čtení jen položky čitelných zdrojů.
   Plán nic nemění – je to doporučení.
4. **Před vydáním**: `bun audit` – Hono a fast-xml-parser na opravené verze; zbývá esbuild jen ve vývojových nástrojích
   (drizzle-kit, vite – dev server se v provozu nepoužívá). Veřejný export (`publish.sh` + `publish-scan.ts`)
   s lokálním seznamem zákazů: interní IP a názvy serverů nahrazeny příklady (192.0.2.0/24, `firma.local`).
   Výkonnostní test (`load-test.ts`) doplněn o nálezy, nápravu, zprávu pro vedení a kvalitu dat (5000 aktiv: vše do 0,5 s).
