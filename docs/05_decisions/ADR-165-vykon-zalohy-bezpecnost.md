# ADR-165: Výkon při velkém objemu, ověřený test obnovy, bezpečnostní průchod (v1.72)

## Kontext

Před nasazením u dalších zákazníků: výkon jsme měřili na 5 000 aktivech; test obnovy byl ruční a ověřoval jen,
že se archiv načte; po řadě vydání (1.60–1.71) přibyly routy, které bylo potřeba znovu projít z hlediska oprávnění.

## Rozhodnutí

1. **JIT v PostgreSQL vypnutý** (`db/client.ts` – parametr spojení `jit=off`, v docker compose i na serveru DB).
   Přehledy jsou jeden dotaz s desítkami poddotazů; odhad ceny přes práh JIT spustil překlad, který trval déle než
   dotaz. Měření při 20 000 aktivech a 160 000 zranitelnostech (`LOAD_SCALE=4`): průvodci 2,4 s → 0,7 s,
   průvodce rizik 1,8 s → 0,25 s, eskalace nálezů 1,5 s → 0,15 s; ostatní beze změny nebo rychlejší.
2. **Stránkování nálezů**: `limit` (50–1500) v `FindingsQuery`, odpověď `total`; web načte 300 podle priority
   a „Zobrazit další“ po 300 (dřív až 1 500 řádků, ~0,8 MB).
3. **Eskalace** bez korelovaného poddotazu na úkoly (CTE s otevřenými úkoly a left join).
4. **Test obnovy s ověřením obsahu** (`restore.sh --test`): klíčové tabulky nesmí být po obnově prázdné, když
   v provozu nejsou; migrace nesmí chybět ani být novější; doba a počty do záznamu `restore_test`.
   **Automaticky** ve službě záloh (`BACKUP_RESTORE_TEST` weekly / daily / off) nad čerstvým dumpem před šifrováním.
5. **Bezpečnost**: omezení velikosti požadavku na API (`bodyLimit`: JSON 32 MB, multipart 160 MB; Bun 170 MB);
   `esbuild` přes `overrides` na opravenou verzi (`bun audit` bez nálezů); test oprávnění nových rout (garant aktiva
   nesmí plán, úkoly z plánu, hromadnou opravu kvality ani předání odpovědností). Ostatní ochrany už existují
   (CSP, secure headers, CSRF, zámek účtu a omezení podle IP, `requirePerm` na každé routě – review test).

## Důsledky

- Vlastní PostgreSQL mimo docker compose: JIT vypíná API ve spojení, nastavení serveru není nutné.
- Zátěžový test (`load-test.ts`) používá stejné spojení jako provoz; větší objem `LOAD_SCALE=4`.
