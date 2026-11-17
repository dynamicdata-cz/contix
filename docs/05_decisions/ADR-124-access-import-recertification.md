# ADR-124: Import z personálního systému (PERM) a recertifikace oprávnění (v1.27)

## Kontext

Evidence osob (ADR-123) potřebuje pravidelný přísun dat z personalistiky – u zákazníků typicky Kvasar PERM 3, který
nemá veřejně dokumentované API, ale umí exportovat sestavy do CSV / XLSX. Normy (ISO 27001 A.5.18, § 8 vyhl. 409/2025)
požadují pravidelný přezkum přidělených přístupových oprávnění.

## Rozhodnutí

1. **Import ze souboru, ne přes API.** Adresář `./import` na serveru je do API připojen jen pro čtení (`/import`,
   `ACCESS_IMPORT_DIR`). Nastavení na společnost (`iam_import_settings`): název souboru (jen jméno, žádná cesta), zapnuto,
   „chybějící = odešlí“. Plánovač soubor načte při změně SHA-256; výsledek a chyba se ukládají k nastavení.
2. **Rozpoznání exportu bez znalosti přesného formátu PERM:** záhlaví může být pod titulkem sestavy (`readTable(…,
   headerMatch)`), celé jméno v jednom sloupci se rozdělí a tituly vynechají (`splitFullName`), kód střediska se použije
   jen bez názvu, rozšířená synonyma českých mzdových systémů (Os.č., Pracovní zařazení, Druh PPV…).
3. **Minimalizace údajů:** sloupce s citlivými údaji (`sensitiveColumns`: rodné číslo, narození, adresa, mzda, účet,
   pojišťovna, doklady…) se nenačítají nikdy, náhled na ně upozorní.
4. **Odchody z chybějících osob** jen na výslovnou volbu; pojistka: soubor s méně než polovinou aktivních importovaných
   osob odchody neoznačí (neúplný export nesmí hromadně odebrat přístupy).
5. **Recertifikace** (`iam_certifications`, `iam_certification_items`): rozsah všechna / privilegovaná / jedno oprávnění,
   posuzovatel vlastník nebo nadřízený (podle e-mailu), jinak správce přístupů; nikdo neposuzuje vlastní přístup.
   „Odebrat“ vyžaduje důvod a hned založí žádost o odebrání (origin `review`). Povinnost `access_certification`
   v Moje práce; protokol CSV pro auditora; uzavření správcem.

## Důsledky

- Napojení na PERM bez zásahu do personálního systému a bez síťového přístupu CONTIXu k němu.
- Přesný formát exportu ověříme u prvního zákazníka; neznámý sloupec se jen ignoruje.
