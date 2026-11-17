# ADR-140: Další průvodci, přesnější kroky a Cesta k souladu za skupinu (v1.43)

## Kontext

Průvodci (ADR-139) nepokrývali aktiva, zranitelnosti, dokumentaci, školení, identity, významné změny a DORA;
některé kroky používaly pevnou lhůtu 12 měsíců a nebraly ohled na akceptovatelnou úroveň rizik ani lhůty hlášení.

## Rozhodnutí

1. Nové průvodce `assets`, `vulnerabilities`, `policies`, `awareness`, `identity`, `changes` a `dora` v `GUIDES`;
   DORA má `applies` (jen `companies.dora_entity`). Panel `ProcessGuide` na hlavní stránce modulu.
2. Fakta s logikou modulu se počítají jeho funkcemi a jen pro požadované průvodce (`guideFacts(db, id, wanted)`):
   rizika nad akceptovatelnou úrovní bez zvládání (`riskScore` + `isAcceptable`), přehodnocení podle
   `riskPolicy.reviewMonths` (`riskBaseline`), zranitelnosti po lhůtě (`vulnOverdueSql`), přezkum / oběh /
   seznámení dokumentů (`loadPolicies`), osoby po termínu školení (`loadCourses`), zmeškané lhůty hlášení
   (`incidentDeadlines` podle `profileOf`), nedostatky registru DORA (`doraRegisterOf`). Intervaly záznamů z jejich
   sloupců (`review_interval_months`, `review_months`, `test_interval_months`).
3. `GET /guides/group`: postup každé aktivní společnosti v `scope.accessible` (oprávnění po společnostech);
   na stránce Cesta k souladu tabulka se přepnutím společnosti.

## Důsledky

- Skupina počítá fakta po společnostech (sekvenčně) – u velkých skupin pomalejší; nic se nepersistuje.
