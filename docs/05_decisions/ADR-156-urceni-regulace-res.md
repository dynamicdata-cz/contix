# ADR-156: Určení regulace podle vyhlášky 408/2025 s údaji z RES (v1.61)

## Kontext

Povinná osoba se podle zákona č. 264/2025 Sb. sama identifikuje: zda poskytuje službu z přílohy vyhlášky
č. 408/2025 Sb. (102 služeb ve 22 odvětvích), zda splňuje podmínky významnosti a do kterého režimu patří.
Podklady jsou rozptýlené – činnosti a velikost ve statistickém registru, licence a výkony u subjektu.

## Rozhodnutí

1. **Katalog** (`packages/shared/src/regulatedServices.ts`) přepisuje přílohu vyhlášky ve znění účinném od
   1. 11. 2025: číslo bodu, název, poskytovatel, podmínky (otázky ano / ne), pravidla režimu jako disjunkce konjunkcí
   (velikost L / M / S / U a podmínky), povinné podmínky (`require`, např. 5 % obratu u vody a odpadů) a vodítka
   CZ-NACE / sektoru ESA pro návrh. Pravidla vyšších povinností se vyhodnocují první (§ 8 zákona).
2. **RES** se čte přes ARES (`GET /ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty-res/{ico}`), stejný zdroj
   a vypínač jako dosavadní vyhledávání v ARES (`ARES_SOURCE`). Použije se primární záznam: CZ-NACE (2025 i 2008),
   převažující činnost, institucionální sektor ESA 2010, kategorie počtu zaměstnanců (číselník ČSÚ 579).
   `GET /api/ares/res/:ico`, cache 10 min.
3. **Velikost** podle čl. 2 doporučení 2003/361/ES: zaměstnanci pod hranicí a zároveň obrat nebo bilanční suma
   do stropu; částky v mil. Kč s kurzem ČNB (§ 2 odst. 2 vyhlášky). Bez vlastních údajů odhad z kategorie RES
   (jen když kategorie neleží přes hranici velikostí); ruční volba má přednost. Propojené podniky = poznámka a součet
   zadaný uživatelem.
4. **Návrh není rozhodnutí**: CZ-NACE služby jen navrhuje, nic se nezaškrtne samo. Uživatel potvrdí služby a
   podmínky; server výsledek přepočítá stejnou funkcí jako náhled.
5. **Úložiště** `regulation_assessments` (migrace 0116): subjekt `company` / `supplier`, vstupy, velikost a její
   základ, odpovědi, výsledek, snímek RES, autor a čas; historie se nemaže. `POST /api/regulation/assessments`
   (`admin:settings` pro společnost, `suppliers:write` pro dodavatele), volba `apply` zapíše u české společnosti
   `regime` a `regulated_services` do profilu.

## Důsledky

- Katalog je potřeba udržovat při novele vyhlášky (kontrolu znění pomáhá modul Legislativa).
- Určení službou NÚKIB rozhodnutím (§ 4 zákona) a přeřazení do vyššího režimu CONTIX nepočítá – uživatel ho
  zohlední ruční volbou a poznámkou.
