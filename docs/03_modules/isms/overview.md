# Modul Řízení ISMS – změny, cíle, přezkoumání

Modul `isms`, oprávnění `isms:read` / `isms:write`. API `/api/isms`, UI *Řízení ISMS* (záložky Cíle a přezkoumání · Řízení změn).

## Řízení změn (§ 11 vyhl. č. 409/2025 Sb.)

- **Kritéria významných změn** (§ 11 odst. 1 písm. a) stanovuje organizace – Administrace → Nastavení
  (`settings.changeCriteria`, jedno na řádek). Výchozí seznam je návrh CONTIX, ne text vyhlášky.
- Záznam změny: typ, stav (navržená → posouzená → schválená → provedená → uzavřená; zamítnutá, vrácená zpět), vlastník
  (funkční místo), termíny, vliv na kybernetickou bezpečnost (písm. b), **významná změna** (písm. c) + splněná kritéria.
- U významné změny (odst. 2): b) řízení rizik (text + vazba na rizika), c) bezpečnostní opatření (text + vazba na katalog),
  d) aktualizace dokumentace, e) testování před provozem, f) návrat do původního stavu; odst. 3 rozhodnutí o penetračním testu
  (§ 24 odst. 5 písm. a) bod 3); audit v rozsahu změny (§ 16 odst. 4 písm. a). Záznam sám je dokumentace řízení (písm. a).
- **Mezery** (`changeGaps`) se vyhodnocují podle fáze: od návrhu kritérium a rizika, od schválení opatření, návrat a rozhodnutí
  o pentestu, od provedení test, při uzavření dokumentace a audit.
- Schvaluje a zamítá `isms:write`; vlastník (držitel funkčního místa) změnu upravuje.
- Vazby: aktiva, procesy, rizika, opatření, dodavatelé.
- Významné změny za hodnocené období se automaticky vypíší ve **zprávě o hodnocení rizik** (§ 8 odst. 1 písm. c) bod 2)
  a ve **zprávě o přezkoumání** (§ 3 písm. f) bod 7).

## Cíle ISMS (§ 3 písm. a)

Cíl, ukazatel, cílová a dosažená hodnota, stav (nevyhodnoceno / splněno / částečně / nesplněno / zrušeno), vyhodnocení,
odpovědnost, termín.

## Vyhodnocení účinnosti a zpráva o přezkoumání (§ 3 písm. f) a g)

Druh dokumentu `isms_review` ve verzích dokumentů (návrh → schválení `documents:approve` → seznámení vedení § 4 odst. 2 písm. a).
Snímek převezme z evidence podklady k bodům 1–7:

1. cíle ISMS, 2. plán zvládání rizik (akce, po termínu, náklady), 3. stav ISMS – rizika (včetně rizik bez přehodnocení),
míra shody (rámec dle režimu), stav a účinnost opatření, platné dokumenty a seznámení, kontinuita (plány, testy), významní
dodavatelé s mezerami, 4. audity a zjištění (modul Audity), 5. závěry předchozí schválené zprávy, 6. incidenty (modul Incidenty),
7. významné změny v období. K bodům se doplní hodnocení, závěry a rozhodnutí o aktualizaci ISMS (§ 3 písm. h).
Přehled hlídá termín: poslední schválená zpráva + 12 měsíců.
