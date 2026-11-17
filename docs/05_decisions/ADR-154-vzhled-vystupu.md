# ADR-154: Vzhled výstupů – logo, barva, zápatí (v1.59)

## Kontext

Výstupy (tisk / PDF, Word) měly jednotný vzhled CONTIX. Organizace chtějí ve zprávách pro vedení, SoA a dalších
dokumentech své logo a klasifikaci v zápatí; v holdingu může mít každá společnost vlastní.

## Rozhodnutí

1. Tabulka `company_branding` (migrace 0114): logo (data URL PNG / JPEG, max. 400 kB, rozměry z hlavičky souboru),
   barva `#rrggbb`, text zápatí, zobrazit název. API `GET / PUT / DELETE /api/branding/:companyId` (`admin:settings`).
2. Dědění: vlastní nastavení, jinak nejbližší nadřazená společnost (max. 10 úrovní).
3. **Kontext požadavku**: middleware `brandLoader` po přihlášení načte vzhled aktivní (jinak domovské) společnosti do
   `AsyncLocalStorage` (cache 60 s, zneplatní se uložením). `printPage`, `page` (dokumenty ISMS), `withBrandHtml`
   (vlastní stránky – hlášení incidentu, oznámení dodavateli) a `htmlToDocx` ho použijí bez úprav jednotlivých exportů.
4. Word: záhlaví jako tabulka bez okrajů (logo vlevo, název vpravo, čára v barvě), zápatí `text · název · strana`,
   nadpisy a záhlaví tabulek v barvě. Převod HTML → Word nově umí `background:#rrggbb` u buňky / řádku.
5. Stránky s CSP `default-src 'none'` povolují `img-src data:` (logo je vložené, nic se nestahuje).

## Důsledky

- Nový výstup přes `printPage` / `htmlToDocx` dostane vzhled automaticky; vlastní HTML šablona zavolá `withBrandHtml`.
- Uložené verze dokumentů se nemění – vzhled se použije při zobrazení / exportu.
