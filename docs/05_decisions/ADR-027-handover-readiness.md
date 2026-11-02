# ADR-027: Připravenost na předání – průvodce, nápověda, bezpečnost a výkon

**Stav:** přijato · 5. 10. 2026

1. **Průvodce nastavením počítá stav z dat** (`GET /api/setup`) – žádné „odškrtávání“, které by se rozcházelo
   se skutečností. Kroky odpovídají povinnostem (identifikace povinné osoby, MFA správců, organizační struktura
   a bezpečnostní role, aktiva, rizika, SoA, bezpečnostní politika, upozornění, zálohy). Volitelné kroky se do
   „připraveno“ nepočítají; kroky vypnutých modulů se přeskočí.
2. **Předávací protokol** se generuje ze stejných dat (HTML pro tisk a Word přes `htmlToDocx`) – doklad stavu
   k datu předání s kontrolním seznamem a podpisy.
3. **Nápověda jako data v `shared/help.ts`** – jeden zdroj pro panel v aplikaci, úvodní prohlídku i příručku
   ke stažení; témata jsou podle rolí (zaměstnanec, gestor, manažer KB, správce) a cest v aplikaci. Text je
   omezený Markdown převáděný bez HTML (XSS). Prohlídka se ukáže jednou na uživatele a prohlížeč (localStorage).
4. **Bezpečnostní revize před předáním** – nezávislá kontrola kódu; nálezy opraveny ve v0.25.1 s regresními testy:
   typ souboru vždy podle přípony a WebDAV GET jako příloha se sandboxem, limit rozbalení ZIP, povolené domény SSO
   (Google bez domén nezakládá ani nepropojuje účty), kontrola modulových oprávnění u AI návrhů, vazby dokumentu jen
   na opatření a funkční místa vlastní (nadřazené) společnosti, omezení neúspěšných přihlášení z jedné IP, doplněný
   audit. Vědomě ponecháno: odpověď 423 u zablokovaného účtu (srozumitelnost pro uživatele), HSTS bez
   `includeSubDomains` (domény zákazníků), šablony dostupné všem uživatelům se zaměstnaneckou rolí ve společnosti.
5. **Výkon** – `load-test.ts` naplní databázi realistickým objemem a změří hlavní přehledy. Odstraněny dotazy
   v cyklu (okruhy dotčených osob, seznámení, stav portálu): přehled dokumentace se 300 dokumenty z ~1,1 s na ~0,1 s,
   při trojnásobném objemu všechny přehledy pod 0,5 s.
