# ADR-141: Garant postupu, další krok v Moje práce, vývoj Cesty k souladu, průvodci SOC a IDM (v1.44)

## Kontext

Průvodci (ADR-139, ADR-140) ukazovali, co udělat, ale nikomu to nepřidělili a nebylo vidět, jak se postup mění.

## Rozhodnutí

1. **Garant postupu** = funkční místo v `guide_owners` (společnost × průvodce). Nastavení `PUT /guides/:id/owner`
   jen s oprávněním `guideWritePerm` (výchozí `<modul>:write`) a jen místo z dané společnosti; audit `guide.owner_set`.
2. **Povinnost `guide_step`** jen `guideStepObligations` (`modules/guides/routes.ts`) volaná z `collectObligations`:
   za průvodce s garantem jedna položka s doporučeným dalším krokem (název, počet k vyřízení, odkaz na stránku),
   bez termínu s naléhavostí „brzy“ – do Moje práce i souhrnného e-mailu držitelů místa. Nepersistuje se.
3. **Trend `compliance_path`** (měsíční snímek, `computeTrendValues`): celkový postup průvodců zapnutých modulů
   (bez ohledu na oprávnění uživatele). Ve Zprávě pro vedení mezi výchozími ukazateli.
4. Průvodci **SOC** (zdroje, triáž do 24 h, hledání, slepá místa detekce `detectionFor`) a **Žádosti o přístup**
   (osoby, katalog, vlastníci, role, žádosti starší 5 dnů, oprávnění osob po odchodu, recertifikace za 12 měsíců).

## Důsledky

- Výpočet povinností u společností s garanty počítá fakta průvodců – jen požadované průvodce (`wanted`).
