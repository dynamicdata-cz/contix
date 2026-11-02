# ADR-040: Bezpečnostní dotazníky pro dodavatele

**Stav:** přijato (v0.46.0)

## Kontext
§ 9 vyhl. č. 409/2025 Sb. vyžaduje hodnocení rizik souvisejících s významnými dodavateli (odst. 2 písm. a) a kontrolu, zda
dodavatel plní bezpečnostní požadavky (ustanovení přílohy č. 5, u nižšího režimu přílohy č. 2 vyhl. 410). Podklady se dosud
sbíraly mimo CONTIX (Excel, e-mail) a k dodavateli se zapisovalo jen datum hodnocení.

## Rozhodnutí
- Tabulka `supplier_questionnaires` (patří společnosti dodavatele; při přesunu dodavatele jde s ním). Otázky jsou **data ve
  sdíleném kódu** (`shared/supplierQuestionnaire.ts`, 30 otázek v 6 oblastech, česky i anglicky, vlastní formulace CONTIXu
  s orientační vazbou na písmena přílohy č. 5); zkrácená sada (`lite`, 21 otázek) pro režim nižších povinností.
- **Odkaz bez přihlášení**: náhodný token 32 B (base64url) v cestě `/q/<token>`; v DB jen SHA-256 (`token_hash`, unikátní index).
  Token se zobrazí jen při vytvoření / obnovení odkazu; nový odkaz zneplatní starý. Platnost 1–180 dnů.
  Veřejné API `/api/public/questionnaires/:token` (GET, PUT = rozpracované uložení, POST `/submit`) – mimo session middleware
  autentizace, CSRF kontrola Origin platí; cesta se nezapisuje do přístupového logu (token).
- Dodavatel vidí jen název organizace, svůj název, otázky a své odpovědi; po vypršení / zrušení se rozpracované odpovědi nezobrazují.
  Odevzdání je atomické (podmínka na stav), pak už odpovědi nemění; uživatel může dotazník **vrátit k doplnění**.
- **Vyhodnocení** `scoreQuestionnaire`: ano = 1, částečně = ½, ne = 0, klíčové otázky váha 2, „netýká se“ jen u povolených otázek
  a nepočítá se. Navržená úroveň: klíčové „ne“ nebo skóre < 50 % = vysoká; klíčové „částečně“ nebo < 80 % = střední; jinak nízká.
  Je to **návrh** – stav „vyhodnoceno“ nastaví uživatel (volitelně zapíše `suppliers.risk_assessed_at`).
- **Riziko** se zakládá jen tlačítkem: stav „identifikováno“, hrozba H11 z katalogu, popis s nedostatky, vazba na dodavatele;
  hodnocení podle metodiky doplní vlastník (skóre se z dotazníku nepřebírá – jiná škála).
- E-mail s odkazem jen přes SMTP z nastavení upozornění, v jazyce dotazníku; když SMTP chybí, dotazník vznikne a odkaz se předá ručně.
- Povinnost `supplier_questionnaire`: čeká na dodavatele (termín = platnost odkazu), vyplněno = k vyhodnocení.

## Důsledky
- Změna otázek = změna dat ve `shared`; klíče otázek jsou stabilní (odpovědi se ukládají pod klíčem), nové otázky jen přidávat.
- Přílohy (soubory) dodavatel nenahrává – jen odkaz / označení podkladu (bez nahrávání souborů bez přihlášení).
