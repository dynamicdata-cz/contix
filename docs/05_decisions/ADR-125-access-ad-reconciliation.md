# ADR-125: Soulad evidence přístupů se skutečným stavem v AD / Entra ID (v1.28)

## Kontext

Evidence přidělení (ADR-123) vzniká z žádostí. Skutečný stav je ale v AD: členství mohlo vzniknout mimo proces,
správce mohl zapomenout odebrat odešlého, nebo nastavit schválenou žádost. Zdroje identit (ADR-029) už členství ve
skupinách načítají (`identity_accounts.groups`, jen čtení).

## Rozhodnutí

1. Porovnání jen z posledního načtení zdroje identit – žádné nové spojení s AD, žádný zápis.
2. Osoba ↔ účet: login bez domény (`bareLogin`), jinak e-mail (`matchAccounts`). Skupina: CN z DN (`groupKey`),
   u oprávnění typu skupina AD bez DN jeho název.
3. Typy nesouladu (`reconcileGroup`): `unapproved`, `leaver_in_ad`, `unknown_account`, `missing`, `no_account`.
4. Akce správce přístupů: **převzetí** stávajícího členství jako přidělení (počáteční naplnění; jen osoby, které
   server sám vyhodnotí jako `unapproved`) a **žádost o odebrání** (origin `reconcile`, rovnou k vyřízení).
5. Automatické nastavování skupin v AD (provisioning) je samostatné rozhodnutí (další verze): oddělený servisní účet
   s delegovaným právem jen na členství vybraných skupin v určené OU, nikdy privilegované skupiny, náhled změn,
   volitelně jen vygenerovaný skript PowerShell; soulad pak slouží jako kontrola, že změna proběhla.

## Důsledky

- Okamžitá hodnota bez rizika zápisu do AD; podklad pro audit (neschválené a osiřelé přístupy).
- Přesnost závisí na intervalu synchronizace zdroje a na vyplněném loginu / e-mailu osob.
