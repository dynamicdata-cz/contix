# ADR-039: Výjimky a přijatá rizika – jednotný přehled

**Stav:** přijato (v0.43.0)

## Kontext
Výjimky (vědomé přijetí rizika místo nápravy) vznikají v několika modulech – nálezy identit, porušení SoD, zranitelnosti,
přijatá rizika, neaplikovaná ustanovení SoA. Po udělení zmizí z běžných seznamů (filtr „otevřené“) a chyběl přehled pro
vedení i auditora: co je přijato, proč, kým a do kdy.

## Rozhodnutí
- Modul `modules/exceptions` (`GET /api/exceptions`, `GET /api/exceptions/export` CSV), stránka `/exceptions`. Jen čtení.
- **Nic se nepersistuje** – výjimky zůstávají u svých záznamů; `loadExceptions` je sbírá při čtení (`shared/exceptions.ts`:
  `exceptionState` – po platnosti / brzy vyprší (≤ 30 dnů) / platná / bez termínu, `sortExceptions`, `summarizeExceptions`).
- Každý druh jen pro společnosti, kde má uživatel čtecí oprávnění dané evidence a modul je zapnutý (`EXCEPTION_ACCESS`).
- Přijaté riziko = stav `accepted` nebo zvládání `accept` (ne uzavřené); za výjimku odpovídá vlastník rizika, bez termínu.
- Neaplikované ustanovení = `requirement_assessments.applicable = false` (odůvodnění, kompenzační opatření, kdo naposledy upravil).
- **Upozornění**: nový druh povinnosti `exception_expiry` (nálezy identit, SoD, zranitelnosti s termínem) – v týmovém přehledu,
  e-mailovém souhrnu a v Mých povinnostech toho, kdo výjimku udělil; okno alespoň 30 dnů bez ohledu na obecný předstih.

## Důsledky
- Nová evidence s výjimkou → doplnit druh do `EXCEPTION_KINDS`, `EXCEPTION_ACCESS` a `loadExceptions`.
- Po platnosti se nálezy / porušení znovu otevírají až synchronizací – do té doby je přehled ukazuje jako „Po platnosti“.
