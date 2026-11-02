# ADR-104: Vzhled – tmavý režim, ukazatele na přehledu, detail se záložkami a pevnou hlavičkou

**Stav:** přijato (v1.08)

## Kontext

Uživatelé chtěli modernější vzhled, tmavý režim, výraznější přehled s vývojem ukazatelů a kratší detaily záznamů
(riziko 10 karet, aktivum 16 pod sebou).

## Rozhodnutí

- **Tmavý režim** (`html[data-mode="dark"]`, `lib/theme.ts` – systém / světlý / tmavý, uloženo v prohlížeči): stránky
  používají škály `slate-*`, `brand-*` a stavové odstíny, proto se jen přepíší proměnné (`styles.css`) – tóny 50–300
  jsou tmavé podklady, 700–900 světlý text, `white` = povrch karet (`text-white` zůstává bílý). Grafy berou barvy
  z proměnných (`--chart-line`, `--chart-area`; jedna série = modrá řada 1 ověřené palety, v tmavém režimu vlastní krok).
- **Primitiva**: karty `rounded-xl` se stínem `--shadow-card`, štítky s jemným obrysem, pole `rounded-lg`, záhlaví
  stránky s `meta` a volbou `sticky`, `Skeleton`; aktivní položka menu se svislou značkou; `fieldset` / `select`
  nepřetékají kontejner.
- **Přehled**: pruh ukazatelů `KpiStrip` (míra shody, nepřijatelná rizika, P1 zranitelnosti, povinnosti po termínu) –
  hodnota, změna proti minulému měsíci šipkou a slovem (nikdy jen barvou), drobný průběh s tooltipem; data z trendů.
- **Detail rizika, aktiva, opatření**: pevná hlavička (název, stav, akce) a záložky `Tabs` + `useTab` (Přehled /
  Zvládání nebo Testy / Vazby / Úkoly), záložka v adrese. Formulář zůstává v Přehledu – stav formuláře se mezi
  záložkami neztrácí.

## Důsledky

Nová komponenta s pevnými barvami (hex) musí počítat s tmavým povrchem – používat proměnné / škály. E2E testy
otevírají záložku detailu (`getByRole("tab")` nebo `?tab=`). Náhledy vzhledu: `E2E_SHOTS=<adresář>` v e2e.
