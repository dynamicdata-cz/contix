# Jak přispět do CONTIXu

Díky za zájem! Hlášení chyb, návrhy i úpravy kódu jsou vítané.

## Chyby a návrhy

- **Chyba:** založte issue podle šablony „Chyba“ – verze, kroky, očekávané a skutečné chování. Bez citlivých dat
  (jména, IP adresy, hesla, výpisy z vaší evidence).
- **Bezpečnostní chyba:** jen soukromě, viz [SECURITY.md](SECURITY.md).
- **Návrh funkce:** šablona „Návrh“ – jaký problém řeší a pro koho (role, předpis).

## Úpravy kódu

1. Před větší změnou založte issue a domluvme se na řešení – ušetří to práci oběma stranám.
2. Dodržujte pravidla projektu v [AGENTS.md](AGENTS.md) (oprávnění u každé routy, audit, překlady cs + en, nápověda,
   migrace jen přes `bun run db:generate`, žádná tajemství v kódu). UI a dokumentace česky, kód a commity anglicky.
3. Každá změna s testem. Před odesláním:
   ```bash
   bun run typecheck
   TEST_DATABASE_URL=postgres://contix:contix@localhost:5432/contix_test bun test
   E2E_DATABASE_URL=postgres://contix:contix@localhost:5432/contix_e2e bun run e2e
   ```
4. Významné rozhodnutí zapište jako ADR do `docs/05_decisions/`.
5. Pull request proti větvi `main`, popis podle šablony.

## Licence příspěvků

CONTIX je pod licencí [AGPL-3.0](LICENSE). Odesláním příspěvku potvrzujete, že ho smíte poskytnout a že je poskytnut
pod stejnou licencí – podle [Developer Certificate of Origin](https://developercertificate.org/). Commity prosím
podepisujte: `git commit -s` (řádek `Signed-off-by: Jméno <e-mail>`).

## Jak vydání vznikají

Vývoj probíhá v interním repozitáři; do tohoto repozitáře se přenáší vydání (jeden commit a tag na verzi).
Přijaté pull requesty proto převezmeme do vývoje a objeví se v nejbližším vydání – autor zůstane uveden v `CHANGELOG.md`.
