# Modul Opatření a shoda

Katalog bezpečnostních opatření organizace, jejich mapování na požadavky předpisů a norem a míra shody. Modul `controls`.

## Rámce a požadavky (`packages/shared/src/frameworks`)

| Rámec | Obsah | Zdroj |
| --- | --- | --- |
| ZKB | zákon č. 264/2025 Sb., § 12 (stanovení rozsahu) | e-Sbírka, auditní checklist NÚKIB (31. 3. 2026) |
| Vyhl. 409 | vyhláška č. 409/2025 Sb., § 3–27, **plné znění** (293 posuzovaných požadavků) | e-Sbírka, znění od 1. 11. 2025 |
| Vyhl. 410 | vyhláška č. 410/2025 Sb., § 3–14, **plné znění** (82 požadavků) | e-Sbírka, znění od 1. 11. 2025 |
| ISO 27001 | kap. 4–10 a 93 opatření přílohy A – **jen čísla a stručné popisky CONTIX** | text normy je chráněn |
| DORA | nařízení (EU) 2022/2554, čl. 5–30, 45 – úřední české názvy + shrnutí | EUR-Lex |
| SOC 2 | Trust Services Criteria (AICPA, 2017 rev. 2022): CC1–CC9, A1, C1, PI1, P1–P8 (61 kritérií) – **jen ID a popisky CONTIX** | text AICPA je chráněn |

Posuzovaný požadavek = písmeno, nebo odstavec bez písmen; body jsou součástí požadavku, úvodní věta slouží jako kontext.
ID požadavku je stabilní (např. `cz409:8/1/f`, `iso27001:A.5.15`, `dora:28`, `soc2:CC6.1`). Texty předpisů byly ověřeny proti e-Sbírce
(shodný kontrolní součet). Při novelizaci je nutné data aktualizovat.

**Mapování § vyhl. 409 → ISO 27001 / DORA / SOC 2 / vyhl. 410** (`CROSSWALK_409`) je orientační odborný odhad CONTIX – ověřte ho.

## Opatření

Kód, název, druh (organizační/technické/fyzické/personální), vlastník (funkční místo), **stav** (nezavedeno, plánováno,
v procesu, zavedeno, neaplikováno – odpovídá příl. č. 1 vyhl. 410), **účinnost**, způsob plnění, doložení (kde je kodifikováno),
termín, priorita (1–4 dle příl. č. 1 vyhl. 410), přezkum; vazby na požadavky, aktiva a rizika.

**Výchozí katalog** (tlačítko): jedno opatření na každý § vyhl. 409 (V-03 … V-27) nebo 410 (N-03 … N-14) navázané na všechny
požadavky daného § a volitelně na příbuzné požadavky ISO/DORA/ZKB. Existující kódy se přeskočí.

## Prohlášení o aplikovatelnosti / přehled bezpečnostních opatření

- Vyhl. 409 § 8 odst. 1 písm. f): u každého požadavku **aplikováno ano/ne**; neaplikované vyžadují **odůvodnění** (API to vynucuje)
  a případná **náhradní opatření**; aplikované mají **způsob plnění** (vlastní text nebo z opatření).
- Vyhl. 410 § 3 odst. 2 a příl. č. 1: stav, popis, termín, **priorita**, odpovědnost; přehled se aktualizuje alespoň jednou
  ročně a uchovává 4 roky (verzování přehledů je v plánu – zatím uchovávejte exporty).
- **Míra shody** požadavku = ruční posouzení, jinak odvozeno z opatření: žádné → nesplněno; všechna zavedená a ne-neúčinná →
  splněno; část zavedena / v procesu / částečně účinná → částečně.
- **Skóre %** = (splněno + 0,5 × částečně) / aplikovatelné (neposouzené = 0). Po rámcích i po § / kapitolách.
- Export CSV (středník, UTF-8 s BOM pro Excel, ochrana proti vzorcům).

## Oprávnění

`controls:read`, `controls:write` (SoA, mapování, vlastník). Vlastník opatření (držitel funkčního místa) smí upravit stav,
účinnost a způsob plnění svého opatření.

## SOC 2

- Bezpečnost (společná kritéria CC) je v každé zprávě SOC 2; dostupnost, důvěrnost, integrita zpracování a soukromí
  jen podle rozsahu – kritéria mimo rozsah označte v SoA jako neaplikovatelná.
- Opatření generovaná z vyhlášky 409 (s mapováním) dostanou i příbuzná kritéria SOC 2; jednotlivá opatření lze
  namapovat ručně nebo návrhem AI asistenta (detail opatření → rámec SOC 2).
