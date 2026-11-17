# ADR-123: Žádosti o přístup – osoby, katalog oprávnění, schválení, přidělení (v1.26)

## Kontext

Modul Identity a přístupy (ADR-029 až ADR-031) čte účty z AD / Entra ID, hlídá rizikové příznaky a vede přezkumy
přístupů. Chybí řízený proces **přidělování**: kdo o co žádal, kdo schválil, kdo nastavil a kdy se přístup odebral
(§ 8 vyhl. 409/2025, ISO 27001 A.5.15–A.5.18). Personální data jsou v HR systému (např. PERM 3), ne v adresáři.

## Rozhodnutí

1. Nový modul `access` a oprávnění `access:request` (žádat za sebe a přímé podřízené, schvalovat určené kroky; všechny
   běžné role) a `access:manage` (katalog, osoby, import, vyřízení; CISO, manažer KB, správce IT, admin).
2. Tabulky (migrace 0094): `iam_people` (osoba z personalistiky – nemusí mít účet v CONTIXu; nadřízený, nástup,
   ukončení), `iam_resources` (katalog: typ, vlastník, schvalování vedoucím / vlastníkem, max. doba, privilegované,
   skupina AD), `iam_requests`, `iam_approvals` (kroky s určeným schvalovatelem), `iam_grants` (evidence přidělení,
   jedno aktivní na osobu a oprávnění).
3. Schvalovatel kroku „vedoucí“ = aktivní uživatel s e-mailem nadřízeného osoby; „vlastník“ = vlastník oprávnění.
   Nenalezený schvalovatel, dotčená osoba nebo vlastník-žadatel → krok rozhoduje kdokoli s `access:manage`.
   Žádá-li sám vedoucí, jeho krok se schválí automaticky. Žadatel ani dotčená osoba nerozhodují; nikdo nevyřizuje sám sobě.
4. Odebrání se neschvaluje (rovnou „schváleno – k vyřízení“). Denně `processAccessLifecycle`: přidělení po platnosti
   a přidělení osob po datu ukončení → žádost o odebrání (`origin` expiry / leaver); otevřené žádosti odešlých o přidělení
   se zruší.
5. Import CSV / XLSX (`readTable`) s rozpoznáním záhlaví z personálních systémů (`peopleMapping`, porovnání bez diakritiky
   a mezer), párování podle osobního čísla, jinak e-mailu; náhled → commit; nikoho nemaže. Druh poměru DPP / DPČ → externí.
6. Čekající schválení jsou povinností `access_approval` v Moje práce a v souhrnném e-mailu. Všechny kroky auditované.
7. V této verzi vyřízení potvrzuje správce ručně; automatické nastavení skupin AD (oddělený servisní účet s delegovanými
   právy jen na vybrané OU, náhled změn) přijde v další verzi, stejně jako přímé napojení na PERM.

## Důsledky

- Úplná auditní stopa žádost → schválení → vyřízení → odebrání bez zásahu do AD.
- Schvalování závisí na shodě e-mailu osoby a uživatele CONTIXu; bez ní rozhoduje správce přístupů.
