# Modul Kontinuita – analýza dopadů (BIA) a plány

§ 15 vyhl. č. 409/2025 Sb. Modul `continuity` (závisí na `processes`). Jedna aktuální BIA na proces.

- **Dopady v čase:** oblasti = oblasti hodnocení primárních aktiv dle **přílohy č. 1 tab. č. 4** (osobní údaje, právní
  povinnosti, řídicí činnosti, finanční zájmy, důležité služby, běžné činnosti, dobré jméno, zdraví osob, mezinárodní vztahy,
  uživatelé služby) × časové body 1 h, 4 h, 1 den, 3 dny, 1 týden, 2 týdny+; úroveň 0–4.
- **Cíle kontinuity** (§ 15 písm. c): 1. minimální úroveň služeb, 2. **RTO** (doba obnovení chodu), 3. **RPO** (bod obnovení dat);
  navíc MTPD (maximální přijatelná doba výpadku) – návrh = první čas, kdy některá oblast dosáhne vysokého dopadu.
- **Kontrola dostupnosti aktiv:** RTO → požadovaná úroveň dostupnosti dle příl. č. 1 tab. č. 3 (< 1 h kritická, < 8 h vysoká,
  ≤ 1 den střední, jinak nízká); aktiva procesu s nižším hodnocením dostupnosti se označí.
- Upozornění: chybějící RTO/RPO/minimální úroveň, RTO > MTPD.
- Stav návrh / schváleno (schvaluje `bia:write`); vlastník procesu může BIA zpracovat, ne schválit.
- Oprávnění `bia:read`, `bia:write`.

## Plány kontinuity a obnovy (§ 15 písm. e)

API `/api/continuity-plans`, UI *Kontinuita → Plány kontinuity a obnovy* (z detailu BIA tlačítko „Plán kontinuity“).

- Typy: plán kontinuity činností, plán obnovy, plán reakce na incident, plán krizové komunikace.
- Obsah: účel, rozsah, kritéria a oprávnění k aktivaci, strategie / náhradní řešení, zdroje, **kroky** (pořadí, odpovědné
  funkční místo nebo text, cílový čas v minutách), **kontakty**, vazby na procesy a aktiva.
- **Cílové RTO:** z plánu, jinak nejpřísnější RTO z BIA navázaných procesů.
- **Schválení** (`bia:write`; vrcholné vedení dle § 4 odst. 1 písm. i). Plán se zakládá jako návrh. Věcná změna schváleného
  plánu (kroky, strategie, aktivace, rozsah, kontakty, zdroje, RTO) zvýší verzi a vrátí plán do návrhu.
- **Testy:** datum (ne v budoucnu), typ (tabletop, walkthrough, simulace, plný test), scénář, účastníci, výsledek, dosažené RTO
  (vyhodnocení splnění cíle), zjištění, zlepšení. Další test = poslední test (nebo schválení) + interval (výchozí 12 měs.).
- Upravovat a zaznamenávat testy smí `bia:write` nebo držitel funkčního místa vlastníka plánu.
