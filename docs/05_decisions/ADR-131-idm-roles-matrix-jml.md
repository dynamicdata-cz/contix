# ADR-131: IDM – přehled, business role, matice, detail osoby, JML a SoD při žádosti (v1.34)

## Kontext

Žádosti o přístup, soulad s AD a zápis do AD (ADR-123 až 130) fungovaly, ale správce musel stav skládat z více záložek.
Chyběl pohled „kdo má co a proč“, přiřazení oprávnění podle pozice a řízený nástup / přesun / odchod. Toxické kombinace
(ADR-030) se vyhodnocovaly až po zápisu do AD.

## Rozhodnutí

1. **Business role** `iam_roles` + `iam_role_resources`: balíček oprávnění, přiřazení jen podle kritérií útvar a/nebo
   funkce z evidence osob (`roleMatches`, bez ohledu na velikost písmen; bez kritérií = nepřiřazuje se). Role nic
   nepřiděluje sama – chybějící přidělení (`roleGaps`) se doplní jen žádostmi `createRequest` s původem `role`
   (`POST /access/roles/:id/fill`), časově omezená oprávnění se přeskočí.
2. **Matice** `GET /access/matrix` a **detail osoby** `GET /access/people/:id/overview`: jen čtení evidence a
   posledního načtení AD (`reconcileCompany`); stav buňky jen `matrixState`. Akce z matice a detailu vždy zakládají
   běžné žádosti.
3. **JML průvodce** `POST /access/jml/preview` a `/apply`: návrh jen `jmlPlan` (nástup = role; přesun = nové role přidat,
   oprávnění jen ze starých rolí předvybrat k odebrání, mimo role nabídnout bez předvýběru; odchod = vše odebrat).
   Server návrh při provedení počítá znovu a výběr musí být jeho podmnožinou. Přesun upraví útvar / funkci osoby,
   odchod s budoucím datem jen uloží datum (odebere `processAccessLifecycle`).
4. **SoD při žádosti**: pravidla `sod_rules` z Identit; stav osoby `personState` = skupiny účtu v AD + přidělení +
   otevřené žádosti o přidělení + funkční místa jejího uživatele; konflikt jen `sodConflictsFor` (hlásí jen nově vzniklé).
   `createRequest` uloží konflikty do `iam_requests.sod_conflicts`; taková žádost se nikdy neschválí automaticky
   (ani vedoucím-žadatelem, bez kroků se přidá krok správce) a schválení vyžaduje komentář. Náhled `POST /access/sod-check`.
5. **Přehled** `GET /access/idm/overview`: počty při čtení (nepersistovat), správce přístupů vidí rizika a tok, ostatní
   jen své úkoly. Migrace 0101.

## Důsledky

- Správce má jedno místo pro stav, osobu a změny pozice; vše dál prochází schválením a auditem.
- Role zatím nemají vlastní schvalování ani výjimky; kritéria jen rovnost útvaru / funkce (ne hierarchie útvarů).
