# ADR-166: Průvodce prvním nastavením nové instalace (v1.73)

## Kontext

Kontrolní seznam nastavení (ADR-027) ukazuje stav 14 oblastí a odkazuje jinam – na čisté instalaci ale správce
neví, kde začít, a musí projít pět různých stránek, než je v aplikaci cokoli vidět.

## Rozhodnutí

1. Stránka **Průvodce prvním nastavením** (`/setup-wizard`) s pěti kroky a ukazatelem postupu: organizace (název
   organizace, IČO a sídlo – vyplnění z ARES), klíčoví uživatelé s rolí, organizační struktura (kořenový útvar,
   útvary, volitelně vedoucí funkce), síťové rozsahy (segmenty v povolených rozsazích skenu, sken se nespouští)
   a první import aktiv (šablona, kontrola, import přes `/import`).
2. Kroky zapisují jen přes **existující API** (stejná oprávnění, validace a audit) – průvodce nemá vlastní zápisy.
3. Stav kroků počítá `GET /setup/wizard` z dat (výchozí název organizace = nehotovo, víc než jeden aktivní
   uživatel, útvary, segmenty, aktiva; vypnutý modul = přeskočeno). Dokončení se pamatuje v `app_settings`
   (`setup.wizard`, `POST /setup/wizard/finish`, `reopen`); do té doby ho Přehled správci nabízí.
4. Noví uživatelé: při SSO / AD bez hesla, jinak `temporaryPassword` (16 znaků, bez zaměnitelných znaků) –
   zobrazí se jen jednou, uživatel ho při prvním přihlášení změní.

## Důsledky

- Kontrolní seznam a předávací protokol zůstávají – průvodce pokrývá jen první kroky a odkazuje na ně.
