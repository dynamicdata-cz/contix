# ADR-168: Pokrytí vazeb u všech hlavních evidencí, hlídání testem, hromadné úpravy (v1.75)

## Kontext

Kontrola vazeb aktiva (ADR-167) našla tabulky s cizím klíčem, které detail neukazoval. Stejná kontrola u procesů,
rizik, opatření a dodavatelů našla další: podprocesy, smlouvy dodavatelů pokrývající funkci (DORA), zranitelnosti
produktů CRA navázané na riziko, útočné cesty, úkoly ze změn předpisů a automatické testy u opatření, umístění dat
a náklady projektů u dodavatele. Naplnění dat (útvar, vlastník, štítky) šlo jen záznam po záznamu.

## Rozhodnutí

1. Nové druhy zpětných vazeb `subprocess`, `supplier_contract`, `cra_finding`, `attack_path`, `legal_task`,
   `control_automation`, `data_location`; `scenario_proposal` i u rizika; projekt dodavatele i přes náklady.
2. `RELATION_COVERAGE` (`shared/links.ts`): pro každou tabulku s cizím klíčem na aktivum, proces, riziko, opatření
   a dodavatele místo zobrazení (`detail`, `backlink:<druh>`, `elsewhere`, `internal`). `review.test.ts` čte cizí klíče
   ze schématu Drizzle a selže, když nová tabulka v mapě chybí, mapa obsahuje zastaralou tabulku nebo odkazuje na
   zpětnou vazbu, která u cíle není zapnutá.
3. Hromadné úpravy `POST /bulk/assets|risks|controls` (`modules/bulk`): aktiva – útvar, vlastník, technický garant
   a zástupce, kritičnost, životní cyklus, prostředí, štítky; rizika – vlastník (funkce), štítky; opatření – vlastník,
   stav (bez „nepoužitelné“ – vyžaduje zdůvodnění), štítky. Záznam po záznamu: zápis ve společnosti záznamu, útvar /
   funkce ze stejné společnosti, osoba aktivní; nevyhovující se přeskočí s důvodem; audit po záznamech; po změně
   garanta přepočet úkolů z nálezů, po změně kritičnosti semafor. Stav rizika se hromadně nemění (přijetí má schválení).
4. Web: zaškrtávátka v seznamech aktiv, rizik a opatření a lišta `BulkBar` (co změnit, hodnota sdílenými výběry).
