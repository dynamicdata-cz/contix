# ADR-023: Dokumentace jako DMS se schvalovacím oběhem

**Stav:** přijato · 4. 10. 2026

1. **Rozšíření modulu `policies`, ne nový modul** – registr dokumentů, okruh dotčených osob a seznámení už pokrývají § 6;
   DMS přidává oběh, soubory a portál nad stejnými daty (jedna pravda pro shodu i pro zaměstnance).
2. **Role oběhu = funkční místa** (gestor, vlastník procesu, schvalovatel) v souladu s pravidlem odpovědnosti na funkční
   místo. Neurčené/neobsazené místo nezablokuje oběh: kontrola se přeskočí, schvaluje `documents:approve`.
3. **Stavový automat verze** (draft → review → approval → approved → superseded) se mění jen jedním endpointem
   `workflow` s povolenými přechody podle role; každý přechod = záznam `policy_events` (kdo, kdy, z/do, poznámka) a audit.
   Přímé schválení zůstává pro malé organizace, ale je viditelně odlišeno v historii.
4. **Soubory v PostgreSQL (`bytea`)** s limitem a SHA-256, ne na disku – zálohuje je stávající záloha DB, nová
   infrastruktura (S3, svazek) není potřeba. Soubory schválené verze jsou neměnné. PDF lze otevřít v prohlížeči, ostatní
   jen jako příloha.
5. **Portál pro zaměstnance** používá samostatné endpointy `/portal` s oprávněním `obligations:self` a vlastní viditelností
   (platná verze, klasifikace / okruh dotčených osob) – běžný uživatel nedostane `policies:read` (neviděl by návrhy).
   Nová systémová role **Zaměstnanec** (`obligations:self`, `incidents:report`).
6. **Vazba na školení bez duplicit**: test a seznámení zapisují záznamy školení do existujících kurzů navázaných na
   dokument; opakování školení při nové verzi se vyhodnocuje dynamicky (`coursePeople`), nic se nemaže.
