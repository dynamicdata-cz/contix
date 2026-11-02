# Modul Rizika

Registr, hodnocení a plán zvládání rizik dle **zákona č. 264/2025 Sb.** a **vyhlášky č. 409/2025 Sb.** (§ 8, přílohy č. 3 a 4).
Modul `risks` (závisí na `assets`; vazby na procesy, CVE a opatření se zobrazí, jsou-li zapnuté příslušné moduly).

## Katalog hrozeb a zranitelností (příloha č. 3)

Výchozí obsah = kategorie z přílohy č. 3 vyhl. 409/2025: **21 hrozeb (H01–H21)** a **17 zranitelností (Z01–Z17)**
(„povinná osoba je musí zvážit při určování rizik, pokud jsou pro dané aktivum relevantní“). U hrozby se eviduje, které
složky C/I/A ohrožuje (doplněno CONTIX, editovatelné). Položky dle vyhl. 82/2018 z dřívějších verzí se při startu převedou
na **historické** (kód s příponou `-82`, deaktivované) – navázaná rizika zůstávají a UI vyzve k přemapování.

## Metodika (příloha č. 4, Administrace → Nastavení)

- **Funkce:** riziko = **hodnota aktiva × hrozba × zranitelnost** (příl. 4 odst. 3), nebo **dopad × pravděpodobnost scénáře**
  (sloučení hrozby a zranitelnosti dle odst. 5 – úroveň hrozby i zranitelnosti se pak vede jako doplňující údaj).
- **Počet úrovní 3 / 4 / 5** (matice 3×3, 4×4, 5×5). 4 úrovně = přesně tab. č. 1 a 2 vyhlášky; u 3 a 5 úrovní CONTIX vede
  **převodní tabulku** na úrovně vyhlášky (odst. 5: „zřetelná vazba“). Úrovně rizika jsou vždy 4 dle tab. č. 3.
- Výchozí hranice skóre (lze upravit):

  | Funkce | 3 úrovně (1–27 / 1–9) | 4 úrovně (1–64 / 1–16) | 5 úrovní (1–125 / 1–25) |
  | --- | --- | --- | --- |
  | aktivum × hrozba × zranitelnost | ≤3 / ≤8 / ≤17 / víc | ≤7 / ≤17 / ≤35 / víc | ≤12 / ≤36 / ≤75 / víc |
  | dopad × pravděpodobnost | ≤2 / ≤4 / ≤6 / víc | ≤3 / ≤7 / ≤11 / víc | ≤4 / ≤9 / ≤16 / víc |

- **Kritérium akceptovatelnosti** (§ 8 odst. 1 písm. a): akceptovatelná jsou nízká, nebo nízká a střední rizika.
- **Interval pravidelného hodnocení** (§ 8 odst. 1 písm. c: alespoň jednou ročně) – rizika s hodnocením starším než interval
  se označí „přehodnotit“.
- Každé riziko si pamatuje, **v kolika úrovních bylo hodnoceno** (`scale_levels`) a **kdy** (`assessed_at`). Po změně metodiky
  se stará rizika počítají svou stupnicí a jsou označena k přehodnocení; nová hodnocení se ukládají v aktuální stupnici.
- **Návrh dopadu** z hodnocení aktiv (příl. č. 1, 4 úrovně) převedený na stupnici metodiky – jen složky C/I/A, které hrozba ohrožuje.

## Zvládání rizik

- Metody dle příl. 4 odst. 6: akceptace, redukce, eliminace, vyhnutí se, přenesení/sdílení.
- **Plán zvládání rizik** (§ 8 odst. 1 písm. g): akce u rizika s body 1–7 vyhlášky (opatření, cíle a přínosy, odpovědná osoba,
  lidské/finanční/technické zdroje + odhad nákladů, termín, vazba na opatření z katalogu, způsob realizace), stav a datum dokončení.
  Souhrnný plán přes všechna rizika: **Rizika → Plán zvládání** (export CSV).
- Vazba **riziko ↔ opatření** (modul Opatření a shoda).

## Přehled

Teplotní mapa N×N (u tříčlenné funkce je pravděpodobnost = zaokrouhlená odmocnina hrozba × zranitelnost, jen pro zobrazení),
rozložení podle úrovní (aktuální/zbytkové), stavy, po termínu, **nad hranicí akceptovatelnosti bez ošetření**, k přehodnocení.

## Oprávnění

`risks:read`, `risks:write`, `risks:catalog`. Držitel funkčního místa vlastníka rizika smí své riziko a jeho plán upravovat.

## Kvantitativní analýza (FAIR) – v0.12

Volitelně u rizika: četnost incidentů za rok a ztráta z jednoho incidentu (Kč) jako rozpětí min / nejpravděpodobnější / max
(PERT), volitelně i po opatřeních a roční náklady opatření. Výpočet Monte Carlo (výchozí 10 000 opakování, deterministický
generátor – stejný vstup = stejný výsledek): očekávaná roční ztráta (ALE), percentily P50/P90/P95/P99, pravděpodobnost
alespoň jednoho incidentu, křivka překročení ztrát, návratnost opatření ROSI = (snížení ALE − náklady) / náklady
(náklady: zadané, jinak součet odhadů akcí plánu zvládání). Pásma ALE → úrovně CONTIX a ochota nést riziko (P95 portfolia)
se nastavují v metodice rizik. Kvantitativní výsledek **doplňuje** kvalitativní úroveň dle přílohy č. 4 – ta zůstává
pro vyhlášku, SoA a akceptovatelnost primární. Přehled portfolia: Rizika → Kvantitativně; zpráva o hodnocení rizik
obsahuje oddíl 5a.

## Návrhy (v0.13)

- **Rizika ze zranitelností:** aktiva s otevřenými kritickými a vysokými CVE bez rizika → „Založit riziko“
  (zranitelnost Z17, hrozba H09, zranitelnost dle závažnosti, dopad dle CIA aktiva, vazby na aktivum a CVE).
- **Zbytkové riziko z účinnosti opatření:** `suggestResidual` – zavedené účinné opatření −2 stupně zranitelnosti
  (u dvoufaktorové metody i pravděpodobnosti), částečně účinné −1, dvě a více účinných −1 navíc, minimum 1.
  Jen návrh – použije se tlačítkem „Použít návrh“.
- **Editor metodik** (Administrace → Metodiky): nová metodika rizik / kontrolní seznam, úprava importované, kopie vestavěné;
  živá validace a zkouška výpočtu; uloží se jako balíček JSON.

## Rizikové scénáře z dat (v1.17, ADR-114)

Stránka **Rizika → Scénáře z dat** (`/risks/scenarios`): profil bezpečnostních schopností měřený z dat (deklarace tam, kde data
chybí) a návrhy scénářů z knihovny šablon pro primární aktiva – jen kde data dokládají slabinu. Dopad z CIA, hrozba z alertů SOC
a expozice, zranitelnost z doložených signálů; přijetí založí riziko přes API rizik, zamítnutí se zdůvodněním.

## Pokrytí katalogu hrozeb (v1.18, ADR-115)

- Záložka **Pokrytí katalogu hrozeb** na `/risks/scenarios`: primární aktivum × aktivní hrozba z katalogu – pokryto rizikem, návrh z dat, nerelevantní (zdůvodněno), neposouzeno; souhrn podílu posouzených.
- API: `GET /api/risks/scenarios/coverage`, `PUT|DELETE /api/risks/scenarios/coverage/:assetId/:catalogId` (`risks:write`, zdůvodnění povinné).
- Podnět k přehodnocení **Změna dat scénáře** (`scenario`) u přijatých a navázaných návrhů, když se doložené skutečnosti změní po posledním hodnocení rizika.
- Denní obnova návrhů v plánovači (jen společnosti, které scénáře z dat používají).

## Analýza rizik z dat ve zprávě (v1.19, ADR-116)

- Zpráva o hodnocení rizik obsahuje část 7: profil schopností, pokrytí katalogu hrozeb, nerelevantní hrozby se zdůvodněním, rozhodnuté scénáře, přehodnocení v období a otevřené podněty – zmrazeno ve snímku verze.
- Ukazatele verze `threatCoverage` (%) a `unassessedThreats`.
