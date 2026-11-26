# ADR-204: Požadavek na kvalifikaci pracovníků dodavatele

Stav: **přijato** (v1.112.0) – navazuje na ADR-199 (certifikáty osob) a ADR-202 (certifikáty v dotazníku).

## Kontext

Smlouvy s dodavateli často vyžadují certifikované pracovníky (např. „alespoň dva technici s CCNA“, „auditor
ISO 27001 LA“). Certifikáty pracovníků dodavatele už CONTIX eviduje, ale nehlídal, zda požadavek trvale splňují.

## Rozhodnutí

1. Dodavatel má `cert_requirements` (jsonb, nejvýš 20 položek): část názvu certifikátu a minimální počet
   pracovníků. Úprava přes `GET/PUT /api/suppliers/:id/qualification` (oprávnění dodavatelů), ne přes formulář
   dodavatele – ten posílá celý záznam a požadavky by přepisoval.
2. Vyhodnocení (`evaluateQualification`): shoda názvu „obsahuje“ bez ohledu na velikost písmen; pracovník se počítá
   jednou (podle jména) s nejdelší platností; certifikát po platnosti se nepočítá. `until` = platnost `min`-tého
   nejlépe pokrytého pracovníka – den, kdy požadavek přestane být splněn (null = bez omezení).
3. Povinnost `supplier_qualification` (modul Dodavatelé, právní základ opatření – § 9 vyhlášky): nesplněný požadavek
   s termínem dnes, splněný s koncem platnosti jako termínem (upozornění podle předstihu povinností).

## Důsledky

- Shoda podle názvu je záměrně jednoduchá; přesnější požadavek se zapíše delší částí názvu („CCNP Security“).
- Ukončený dodavatel se nehlídá.
