# ADR-012: Metodiky jako datové balíčky (OCTAVE Allegro, YAML/JSON/XML)

**Stav:** přijato · 1. 10. 2026

## Kontext

Organizace chtějí kromě metodiky dle přílohy č. 4 vyhl. 409 používat OCTAVE Allegro nebo vlastní metodiku a pro audity
vlastní kontrolní seznamy – bez úprav kódu.

## Rozhodnutí

1. Metodika = deklarativní definice (`MethodologyDef`, zod) ve formátu YAML, JSON nebo XML; import validuje strukturu,
   vzorec a vazby. Kód metodik neobsahuje – žádné pluginy ani skripty.
2. Skóre se počítá bezpečným vyhodnocovačem vzorců (bez `eval`), úrovně metodiky se mapují na úrovně CONTIX
   (barvy, přehledy, akceptovatelnost).
3. Metodika dle vyhlášky (`zkb409`) zůstává vestavěná se stávajícím výpočtem; OCTAVE Allegro a 5×5 jsou vestavěné definice,
   kontrolní seznamy auditu se generují z katalogu požadavků vyhlášek.
4. Riziko ukládá metodiku hodnocení a hodnoty faktorů; po změně metodiky politiky se nepřepočítává do jiné metodiky,
   jen se označí k přehodnocení (§ 8 odst. 1 písm. c).
5. Importované definice se drží v DB (původní text pro audit změn) a načítají do sdíleného registru při prvním požadavku.
   UI registruje stejné definice z `GET /api/methodologies`.

## Důsledky

- Hranice poolů OCTAVE jsou výchozí a mají je ověřit uživatelé; úpravou je nová verze metodiky pod vlastním id.
- Smazat lze jen nepoužitou importovanou metodiku; nahrazení stejným id mění hodnocení stávajících rizik –
  proto vyžaduje výslovné potvrzení (`replace`).
