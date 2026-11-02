# ADR-017: Důkazy a testování opatření

**Stav:** přijato · 2. 10. 2026

## Rozhodnutí

1. **Důkaz (evidence)** je samostatný záznam společnosti s vazbou M:N na opatření (jeden zápis může dokládat
   více opatření). Má druh, období, datum pořízení a **platnost** – blížící se konec platnosti je povinnost
   (`evidence_expiry`) v přehledu povinností a upozorněních.
2. **Soubory důkazů se ukládají v PostgreSQL** (`bytea`, max. 25 MB, SHA-256). Důvod: jedna záloha (pg_dump)
   pokrývá vše, žádné sdílené úložiště pro více instancí API, transakční konzistence. Soubory jsou neměnné –
   nová verze = nový soubor. Stažení vždy jako příloha (`Content-Disposition: attachment`, `nosniff`,
   `CSP: sandbox`), každé stažení se loguje. Při růstu nad desítky GB lze přejít na S3/MinIO za stejným API.
3. **Test opatření** rozlišuje test návrhu (existence – Type I) a test provozní účinnosti za období (Type II).
   Vzorky nesou výsledek a odkaz na důkaz; výsledek se **odvozuje** ze vzorků a tolerovaných výjimek
   (`deriveTestResult`), uživatel ho při dokončení potvrdí nebo upraví. Doporučená velikost vzorku podle
   frekvence opatření (`recommendedSample`) je vodítko, ne pravidlo.
4. **Dokončený test je auditní záznam**: nelze ho měnit ani smazat; lze ho znovu otevřít (zalogováno).
   Dokončení může (volitelně) nastavit účinnost opatření a datum přezkumu → promítne se do návrhu zbytkového
   rizika (ADR-015).
5. Oprávnění `controls:test` (CISO, manažer KB, architekt, **auditor**) – auditor smí testovat a nahrávat důkazy,
   ale neměnit katalog opatření.
6. **Rozsah SOC 2**: volitelné kategorie TSC (A1, C1, PI1, P) v nastavení / u společnosti; kritéria mimo rozsah
   jsou bez výslovného posouzení neaplikovatelná.

## Důsledky

- Přesun opatření do jiné společnosti přesune jeho testy a důkazy, které se týkají jen přesouvaných opatření.
- Možné rozšíření: export balíčku důkazů pro auditora (ZIP), vazba důkazu na požadavek a zjištění auditu.
