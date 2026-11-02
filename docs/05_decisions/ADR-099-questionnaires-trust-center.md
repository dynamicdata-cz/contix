# ADR-099: Bezpečnostní dotazníky zákazníků a Trust Center

- Stav: přijato
- Datum: 2026-10-23
- Verze: 1.04

## Kontext
Zákazníci (zejména regulovaní – NIS2, DORA) posílají bezpečnostní dotazníky (XLSX) a chtějí doklady (certifikace, politiky).
Odpovědi se dnes píší opakovaně ručně a dokumenty se posílají e-mailem bez kontroly, kdo je má.

## Rozhodnutí
1. Nový modul `trust` (oprávnění `trust:read` / `trust:write`, upgrade 1.04; CISO a manažer KB zápis, auditor čtení).
2. **Dotazník** `customer_questionnaires` + `customer_questionnaire_items`: import jen přes `readTable` (XLSX / CSV), sloupce
   `guessQuestionColumns` nebo volba v náhledu, otázky `questionsFromTable` (řádek jen s nadpisem = oddíl). Originál se uchová.
3. **Knihovna odpovědí** `answer_library` (klíč `questionKey` = normalizovaná otázka): plní se schválením celého dotazníku nebo ručně;
   při importu se otázky s podobností ≥ 0,85 (`qaSimilarity`, deterministicky, bez modelu) předvyplní jako návrh.
4. **AI** `questionnaire_answer`: dávka 20 nezodpovězených otázek; ke každé kandidáti – knihovna, vlastní opatření (podobnost textu,
   se stavem a účinností), úryvky platné dokumentace (`retrieveDocChunks` + `docVisibility` v kontextu požadavku) a certifikace
   z Trust Center. Validace `parseQaAnswers` (zdroje jen z kandidátů otázky, bez zdroje jistota „low“). Výsledek = návrh; každou odpověď
   schvaluje člověk; schválený dotazník je neměnný (vrácení do rozpracování). Export XLSX (`writeXlsx`), nic se neodesílá.
5. **Trust Center** `trust_centers` (jedno na společnost, adresa `/t/<slug>`): ven jde jen výslovně vybrané – certifikace, souhrn opatření
   podle kategorií, monitorování (úspěšnost za 90 dní, bez podrobností běhů), subdodavatelé (název, účel, země), dokumenty
   (platná schválená verze jako PDF s doložkou). Žádná jména osob ani interní údaje.
6. **Přístup po NDA** `trust_access_requests`: povinné přijetí NDA, past na roboty, limity (3 čekající na e-mail, 20 za den z IP);
   schválení vytvoří token (v DB jen SHA-256, platnost `accessDays`), odkaz e-mailem nebo k předání; PDF s vodoznakem e-mailu příjemce
   a doložkou; počet stažení; odebrání přístupu zneplatní token. Veřejné routy mimo přihlášení (`/api/public/trust`, web `/t/`).

## Nezahrnuto
Zápis odpovědí zpět do buněk původního XLSX, automatický import z portálů (OneTrust, Whistic), vlastní doména Trust Center.
