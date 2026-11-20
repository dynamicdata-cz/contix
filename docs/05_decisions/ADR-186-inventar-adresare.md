# ADR-186: Inventář adresáře – aktivní a neaktivní objekty

Stav: **přijato** (v1.91.0) – navazuje na [ADR-029](ADR-029-identity-access-review.md) a [ADR-185](ADR-185-ad-pocitace.md).

## Kontext

Přehled identit ukazoval jen počet povolených a privilegovaných účtů. Pro výkaz aktiv, licence a hygienu adresáře je
potřeba vědět, kolik účtů a počítačů se skutečně používá – a rychle se dostat na seznam těch ostatních.

## Rozhodnutí

1. **Aktivní** = povolený objekt přihlášený v limitu ze zásad svého zdroje: účty `staleDays`, hosté `guestStaleDays`,
   počítače `computerStaleDays` (výchozí 90 dní). Stejný limit jako pravidla nálezů – čísla se s nálezy nerozcházejí.
2. Kategorie účtů: aktivní, neaktivní, **nikdy nepřihlášené** (AD bez údaje o přihlášení), **přihlášení neznámé**
   (Entra ID bez údaje – typicky chybí licence pro `signInActivity`), zakázané. Počítače: aktivní, neaktivní, zakázané
   a rozpad podle role. Skupiny: celkem a privilegované (počet „prázdných“ se nevykazuje – vnořené skupiny se do
   přímých členů nepočítají a číslo by klamalo).
3. Výpočet jedním SQL dotazem (`identity/inventory.ts`) – podmínka aktivity se sdílí s filtrem seznamu účtů
   (`activity`), takže počet na dlaždici = počet řádků po kliknutí.
4. Zobrazení: karta *Objekty v adresáři* v Přehledu, dlaždice v záložkách Účty a Počítače; kliknutí nastaví filtr.
   API `GET /api/identity/inventory?sourceId=`.

## Důsledky

- Bez migrace.
