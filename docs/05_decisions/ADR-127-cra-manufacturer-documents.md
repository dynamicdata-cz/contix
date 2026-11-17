# ADR-127: Generování dokumentů výrobce podle CRA (v1.30)

## Kontext

Výrobce produktu s digitálními prvky musí vydat EU prohlášení o shodě (čl. 28, příloha V), může používat
zjednodušené prohlášení (příloha VI), musí k produktu přiložit informace a pokyny pro uživatele (čl. 13 odst. 18,
příloha II) a vést technickou dokumentaci (čl. 31, příloha VII). CONTIX už eviduje většinu údajů (kategorie, postup
posuzování shody, doba podpory, kontakt, CVD, SBOM, plnění požadavků přílohy I).

## Rozhodnutí

1. Čtyři dokumenty (`CRA_DOCUMENTS`) generované na serveru jako HTML (tisk do PDF) a .docx (`htmlToDocx`), česky
   nebo anglicky; text odpovídá struktuře příloh (body 1–8 přílohy V, formulace přílohy VI).
2. Údaje, které produkt nemá, v `cra_products.doc_info` (`CraDocInfo`, migrace 0097); výrobce bez názvu = vlastní
   organizace.
3. Povinné údaje každého dokumentu (`CRA_DOC_REQUIRED`, oznámený subjekt u modulů B+C a H); chybějící se v dokumentu
   zvýrazní a dokument je označen jako koncept – nic se tiše nevynechá.
4. Dovozce a distributor dokumenty nevydávají (409), správce OSS jen informace pro uživatele (`craDocAllowed`).
5. Každé vygenerování se zapíše do auditu (druh, jazyk, chybějící údaje). Dokument se neukládá – vždy z aktuálních dat.

## Důsledky

- Prohlášení je podklad k podpisu; právní odpovědnost a podpis zůstávají na výrobci.
- Další jazyky členských států lze doplnit rozšířením slovníku dokumentů.
