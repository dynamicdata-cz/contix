# ADR-199: Certifikáty a osvědčení osob

Stav: **přijato** (v1.105.0) – navazuje na modul Bezpečnostní povědomí a školení (§ 10 vyhl. 409/2025) a personální evidenci (ADR-123).

## Kontext

Organizace potřebují evidovat externí certifikáty a osvědčení ze školení – vlastních zaměstnanců (síťaři, správci,
auditoři) i pracovníků dodavatelů, kteří u nich pracují – s doložením (sken, PDF) a hlídáním platnosti. Dosavadní
přehled absolvování znal jen interní kurzy a uživatele CONTIXu.

## Rozhodnutí

1. Tabulka `person_certificates`: držitel je **právě jeden** z `user_id` (uživatel), `person_id` (osoba z `iam_people`,
   včetně externistů) nebo `holder_name` (externí osoba bez záznamu); volitelně `supplier_id` (zaměstnavatel – dodavatel).
2. Soubor certifikátu v DB (`file_content`, max. 10 MB, PDF/PNG/JPG), stahování jen jako příloha s CSP sandbox; seznam
   soubor nenačítá.
3. Stav platnosti se počítá (`personCertState`): platný, brzy vyprší (≤ 60 dnů), po platnosti, bez omezení.
4. Nová povinnost `person_cert` (modul awareness) – souhrn pro správce i osobní povinnost držitele-uživatele.
5. Osvědčení uživatele může započítat kurz (`course_id`): CONTIX založí záznam v `training_records`
   a drží ho v souladu s certifikátem (`training_record_id`); externí osobě kurz započítat nelze (nemá účet).
6. API `/api/person-certificates`, oprávnění `awareness:read` / `awareness:write`.

## Důsledky

- Externí pracovníci nepotřebují účet v CONTIXu; jejich certifikáty jsou vidět u dodavatele.
- Soubory zvětšují zálohu databáze (stejně jako důkazy a mapy).
