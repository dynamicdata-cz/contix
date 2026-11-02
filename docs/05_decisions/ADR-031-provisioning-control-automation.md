# ADR-031: Synchronizace uživatelů z adresáře a automatické testy opatření

**Stav:** přijato · 5. 10. 2026

## Synchronizace uživatelů a struktury

1. **Zapíná se u zdroje** (AD / Entra ID) a vyžaduje **skupinu** – jen její členové (povolené uživatelské účty s e-mailem)
   se stanou uživateli CONTIXu. Zapnout ji smí jen správce uživatelů a rolí. Plán je čistá funkce `planProvisioning`
   (shared) – náhled i provedení počítají totéž.
2. **Spravuje jen to, co sama založila** (`directory_source_id` u uživatelů a funkčních míst). Ručně založené účty se
   nepřejmenují, nedeaktivují ani nepřebírají; jen se zařadí na synchronizované funkční místo. Útvary se zakládají podle
   `department` (existující útvar se stejným názvem se použije), nikdy se nemažou. Funkční místa podle `title` (bez title
   „Pracovník“) a jejich obsazení se udržuje podle adresáře.
3. Noví uživatelé jsou **SSO účty** (`auth_provider = oidc`, bez hesla) s výchozí rolí; při prvním přihlášení se propojí
   s identitou u IdP podle e-mailu (stávající logika). Deaktivace ruší relace.
4. Entra ID: členství skupin se načítá jen pro **sledované skupiny** (`trackedGroups` + skupina synchronizace) přes
   `transitiveMembers` (GroupMember.Read.All) – stejné skupiny pak fungují i v toxických kombinacích a přezkumech.
5. Odpovědnosti (gestor, vlastník rizika, RACI) se nepřiřazují automaticky – vedou dál na ručně spravovaná místa.

## Automatické testy opatření

1. `control_automations` váže opatření na zdroj výsledku: **kontrola účtů** (interval týdně / měsíčně / čtvrtletně,
   rozsah zdrojů a pravidel, tolerance kritických / vysokých nálezů) nebo **uzavřený přezkum přístupů**.
2. Výstupem je běžný **dokončený test** (`control_tests`, metoda re-performance, tester „CONTIX – automatický test“) se vzorky
   (pravidla / účty) a **důkaz** se souborem (CSV nálezů / HTML protokol) navázaný na opatření – stejné jako ruční testy,
   takže se objeví v detailu opatření, balíčku pro auditora i zprávách.
3. Test se **neprovede**, pokud poslední synchronizace některého zdroje v rozsahu selhala (výsledek by vycházel z neúplných dat).
4. Účinnost opatření se mění **jen při výslovně zapnutém** `applyEffectiveness` (rozhodnutí člověka při nastavení) –
   jinak zůstává změna účinnosti a zbytkového rizika na člověku.
