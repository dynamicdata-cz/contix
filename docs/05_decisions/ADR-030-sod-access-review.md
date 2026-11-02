# ADR-030: Toxické kombinace (SoD) a přezkum přístupů

**Stav:** přijato · 5. 10. 2026

## Rozhodnutí

1. **Osoba = uživatel CONTIXu.** Účty z AD a Entra ID se spojují přes `identity_accounts.user_id` (párování e-mailem při
   synchronizaci) a k osobě se přidávají její funkční místa. Účet bez uživatele CONTIXu je samostatná „osoba“. Tím se
   najde i kombinace přes více adresářů (skupina v AD × role v Entra × funkční místo).
2. **Pravidlo SoD = dvě strany** (skupiny / role podle názvu bez ohledu na velikost písmen + funkční místa); porušení,
   když osoba splní obě. Vyhodnocení je čistá funkce `evaluateSodRule` (shared), výsledek v `sod_violations` se stejným
   životním cyklem jako nálezy (zmizí → vyřešené, výjimka s termínem, po termínu znovu otevřené). Vyhodnocuje se po
   synchronizaci adresáře, po změně pravidla a v plánovači (obsazení míst se mění bez synchronizace).
3. **Přezkum přístupů** zmrazí rozsah při zahájení (`access_review_items` = snímek účtu a přezkoumaných přístupů), takže
   doklad nezávisí na pozdějších změnách adresáře. Recenzent je **funkční místo** (jedno místo, nebo vedoucí útvaru
   držitele účtu s náhradním místem); povinnost se objeví v Moje povinnosti (`access_review`) a v e-mailovém souhrnu.
4. **Recenzent nepotřebuje `identity:read`** – vidí a rozhoduje jen položky svých funkčních míst (`obligations:self`).
   Celek, protokol a správa (předání položky, ruční potvrzení provedení, uzavření) vyžadují `identity:read/write`.
5. **CONTIX nic neodebírá.** „Odebrat“ je pokyn pro správce adresáře; provedení se ověřuje z aktuálního stavu účtu
   (`revokeRemediated`: zakázaný / odstraněný / bez přezkoumaných přístupů), počítá se při čtení, nepersistuje.
   Lze ho potvrdit i ručně (např. odebrání jen části skupin).
6. Uzavřít lze až po rozhodnutí všech položek; uzavřený přezkum je neměnný. Protokol (tisk / Word) je doklad pro audit;
   každé rozhodnutí je v auditním záznamu.
