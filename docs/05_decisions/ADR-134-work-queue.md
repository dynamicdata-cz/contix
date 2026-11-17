# ADR-134: Fronta práce a „Dnes pro vás“ (v1.37)

## Kontext

Druhý krok nového vzhledu (ADR-133). Moje práce byla seznam odkazů bez akcí; schválení žádosti o přístup nebo změny
projektu vyžadovalo otevřít detail. Přehled neukazoval osobní úkoly, jen lhůty celé společnosti.

## Rozhodnutí

1. `ObligationItem.action` (volitelné, `ObligationAction`): `access_decide`, `project_change`, `project_task_done`,
   `task_done` – plní jen sběr povinností v `notifications/obligations.ts` (firemní i osobní, `/notifications/mine`) u příslušných druhů. Akce volá stávající endpointy
   (rozhodnutí žádosti, změny projektu, stav úkolu), takže čtyři oči, SoD a oprávnění ověřuje server jako dosud;
   při chybě se otevře detail.
2. `WorkQueue` (`components/workQueue.tsx`): skupiny podle naléhavosti, filtry `filterQueue` (Ke schválení,
   Po termínu, Tento týden, Dokumenty a školení), relativní termín, zamítnutí vždy s důvodem, klávesy J/K/Enter/A.
3. Přehled: karta „Dnes pro vás“ = fronta bez pozdějších položek, nejvýše 5.

## Důsledky

- Nová povinnost s jednoduchou akcí = doplnit typ do `ObligationAction` a větev do `WorkQueue`.
