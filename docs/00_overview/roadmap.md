# Roadmapa

## Fáze 1 – Skeleton + Asset (v0.1) ✅

- Monorepo (Bun workspaces), API (Hono + Drizzle), web (React + Vite), PostgreSQL v Docker Compose, Caddy
- Health endpoint, Asset CRUD, filtrování, statistiky
- Discovery: Wazuh konektor, nmap konektor (s allow-listem), CSV import, párování, historie běhů
- Testy (unit + integrační proti PostgreSQL)

## Fáze 2a – Identita, administrace, třídy aktiv (v0.2) ✅

- Lokální účty (Argon2id), MFA (TOTP + záložní kódy), zamykání účtů, relace s timeoutem
- SSO: Microsoft Entra ID, AD FS (on-prem AD), Google, obecné OIDC; mapování skupin IdP na role
- Administrace: uživatelé, skupiny, role (systémové dle ZKB + vlastní), nastavení, auditní log
- Primární a podpůrná aktiva, vazby, dědění CIA, garant aktiva jako uživatel

## Fáze 2c – Zranitelnosti a zastaralost (v0.4) ✅

- CVE z Wazuhu (Indexer 4.8+ / API ≤ 4.7), životní cyklus otevřená → vyřešená, výjimky s platností
- Konec podpory OS (EOL), semafor 🟢🟠🔴 s konfigurovatelnými pravidly, propagace na primární aktiva
- Přehled se sloupcovými grafy: závažnost, podpora OS, nejrizikovější aktiva, nejzranitelnější komponenty

## Fáze 2b – Asset produkčně

- Fronta úloh (pg-boss), plánované synchronizace Wazuhu
- Fronta konfliktů, sloučení/rozpojení aktiv, technické vztahy mezi aktivy
- WebAuthn / passkeys, SCIM z Entra ID, export audit logu do SIEM
- Import XLSX + průvodce mapováním, první konektor jiného AM (GLPI nebo Snipe-IT)
- CI (GitHub Actions / GitLab CI): typecheck, test, build image

## Fáze 3 – Moduly, organizace, procesy, rizika (v0.5) ✅

- Modulární systém (zapínání modulů v Administraci, závislosti, API vypnutého modulu = 404)
- Organizace: strom útvarů, funkční místa, obsazení, bezpečnostní role dle ZKB
- Procesy: procesní karta, hierarchie, procesní mapa, kroky s RACI a aktivy, matice RACI, dokumenty,
  BPMN editor (bpmn-js) s generováním z kroků a převzetím úloh
- Rizika: katalog hrozeb/zranitelností dle vyhlášky 82/2018, registr, tříčlenná/dvoučlenná metodika, návrh dopadu z CIA,
  zbytkové riziko, ošetření, vazby na aktiva/procesy/CVE, teplotní mapa

## Fáze 4 – Opatření, shoda, kontinuita (v0.6) ✅

- Plné znění vyhl. 409/2025 a 410/2025 a § 12 ZKB jako katalog požadavků; ISO/IEC 27001:2022 (struktura), DORA (články)
- Katalog opatření, výchozí katalog dle § vyhlášky, mapování na ISO/DORA, prohlášení o aplikovatelnosti, míra shody, CSV
- Metodika rizik dle příl. 4 vyhl. 409: 3×3/4×4/5×5, převod na úrovně vyhlášky, kritérium akceptovatelnosti, katalog příl. 3
- Plán zvládání rizik (§ 8 odst. 1 písm. g), vazba riziko ↔ opatření
- BIA (§ 15): dopady v čase, MTPD/RTO/RPO, minimální úroveň služeb, kontrola dostupnosti aktiv

## Fáze 4b – Dokumenty ISMS, plány kontinuity, dodavatelé (v0.7) ✅

- Verze a schvalování SoA / přehledu opatření, zprávy o hodnocení rizik (§ 8 odst. 1 písm. e) a plánu zvládání rizik;
  neměnný snímek, tisková podoba (PDF z prohlížeče), prokazatelné seznámení (§ 4 odst. 2), uchování 4 roky
- Plány kontinuity a obnovy (§ 15 písm. e): kroky, kontakty, RTO z BIA, verzování po věcné změně, testy a termín dalšího testu
- Evidence dodavatelů (§ 9): významní dodavatelé, mezery v povinnostech, smlouvy s kontrolou ustanovení příl. 5 vyhl. 409
  / příl. 2 vyhl. 410, oznámení dle § 9 odst. 3

## Fáze 4c – Řízení ISMS (v0.8) ✅

- Řízení změn a evidence významných změn (§ 11) s kritérii organizace a kontrolou kroků odst. 2 a 3
- Cíle ISMS, vyhodnocení účinnosti a zpráva o přezkoumání (§ 3 písm. f–h) jako schvalovaný dokument s termínem 1× ročně

## Fáze 4d – Incidenty a audity (v0.9) ✅

- Události a incidenty (§ 14 vyhl. 409), povinnost hlášení a lhůty § 15–16 zákona (24 h / 72 h / 30 dnů), GDPR 72 h,
  podklady pro hlášení, nahlášení události každým uživatelem
- Audity KB (§ 16): plán, auditor dle § 5 odst. 4, zjištění a nápravná opatření, pokrytí oddílů vyhlášky
- Automatické podklady pro body 4 a 6 přezkoumání ISMS a vstupy 5 a 6 zprávy o hodnocení rizik

## Fáze 4e – Skupina společností a metodiky (v0.10) ✅

- Holding a dceřiné společnosti: data, role a nastavení per společnost, dědění rolí, sdílené zdroje holdingu, přehled skupiny
- Metodiky jako balíčky YAML/JSON/XML: OCTAVE Allegro, matice 5×5, vlastní metodiky rizik; kontrolní seznamy auditu
  (vyhl. 409/410, importované) s výsledky položek a zakládáním zjištění

## Fáze 4f – Dokumentace, povědomí, upozornění (v0.11) ✅

- Bezpečnostní politika a dokumentace (§ 6): verze, schvalování, přezkum, odpovědná osoba, seznámení dotčených osob
- Plán rozvoje bezpečnostního povědomí (§ 10): školení, termíny, absolvování, stav osob, přehled § 10 odst. 5
- Moje povinnosti, lhůty týmu, upozornění e-mailem (SMTP) a do Microsoft Teams

## Fáze 4g – Roční hodnocení a kvantitativní analýza (v0.12) ✅

- Hodnotící cykly rizik a BIA nad živým registrem: přehodnocení / potvrzení / vyřazení, schválení, porovnání mezi roky
- Kvantitativní analýza FAIR (Monte Carlo): ALE, percentily, křivka překročení ztrát, ROSI, ochota nést riziko, oddíl ve zprávě

## Fáze 4h – Propojení a dotažení skupiny (v0.13) ✅

- Přesun záznamů mezi společnostmi, přehled skupiny s ročním hodnocením a FAIR, audit a pokrytí dle vyhl. 410
- Editor metodik v aplikaci (rizika i kontrolní seznamy)
- Wazuh alerty → návrhy událostí; zranitelnosti → návrhy rizik; účinnost opatření → návrh zbytkového rizika

## Fáze 4i – SOC 2, provoz a AI asistent (v0.14) ✅

- SOC 2 (Trust Services Criteria) jako další rámec s mapováním z vyhl. 409
- Provoz: služba záloh (šifrování age, kopie mimo server, test obnovy), stav systému v administraci,
  metriky Prometheus, nasazení Docker Compose + Caddy (TLS), zámek plánovače pro více instancí
- AI asistent na lokálním modelu (Ollama / Open WebUI, gpt-oss): návrh opatření k riziku, mapování opatření
  na požadavky; vše jako návrh ke schválení, auditní záznamy AI

## Fáze 4j – Testy a důkazy (v0.15) ✅

- Důkazy k opatřením (soubory v DB se SHA-256, odkazy, platnost a upozornění)
- Testy návrhu a provozní účinnosti se vzorky, doporučená velikost vzorku, odvozený výsledek, promítnutí do účinnosti
- Rozsah zprávy SOC 2 per společnost

## Fáze 4k – AI asistent II (v0.16) ✅

- Klasifikace aktiva (kritičnost, CIA), nápravná opatření ke zjištění auditu, shrnutí incidentu pro vedení
  a doplnění dopadu/příčiny/poučení, kontrola textu dokumentu vůči požadavkům vyhlášky

## Fáze 4l – Reporty (v0.17) ✅

- Zpráva pro vedení se semaforem klíčových ukazatelů (obrazovka, tisk, Word)
- Export dokumentů ISMS (SoA, zprávy, plán) do Wordu

## Fáze 4m – Audit, procesy, GDPR (v0.18–v0.19) ✅

- Balíček pro auditora (ZIP), důkazy přímo k požadavkům
- Verze procesů se schvalováním a porovnáním
- GDPR: záznamy o činnostech zpracování (čl. 30), screening a DPIA (čl. 35)

## Fáze 4n – AI III: dotazy, MCP, duplicity (v0.20) ✅

- Dotazy v přirozeném jazyce nad daty (katalog čtecích nástrojů, oprávnění uživatele)
- MCP server pro externí AI klienty s osobními API tokeny
- Detekce a slučování duplicitních aktiv

## Fáze 4o – Pilotní nasazení (v0.21) ✅

- Instalace / aktualizace / balíček pro zákazníka (Docker Compose, TLS auto / interní CA / vlastní certifikát)
- GitLab CI s e2e testy (Playwright), JUnit reporty
- Import aktiv, rizik, procesů, opatření a dodavatelů z Excelu / CSV

## Fáze 4p – Dokumentace jako DMS (v0.22) ✅

- Schvalovací oběh gestor → vlastník procesu → schvalovatel (funkční místa), vrácení s odůvodněním, historie
- Soubory verzí (Word/PDF) + volitelný text, portál **Dokumenty** pro všechny zaměstnance (role Zaměstnanec)
- Připomínky k dokumentům, test porozumění, seznámení splní navázané školení, opakování školení při nové verzi

## Fáze 4q – DMS II: struktura a řízení (v0.23) ✅

- Složky dokumentace (strom), prefixy a automatické číslování dokumentů (SM-001…)
- Šablony Wordu se značkami {{kod}}, {{nazev}}… – soubor nové verze jedním kliknutím
- Check-out / check-in: rezervace návrhu k úpravě, revize souborů v rámci verze, zrušení cizí rezervace správcem
- Skartační znak (A/S/V) a lhůta, přehled lhůt, balíček dokumentu (ZIP), skartace / předání do archivu s protokolem

## Fáze 4r – DMS III: převody, vyhledávání, porovnání (v0.24) ✅

- Převodní služba `converter` (LibreOffice + poppler) v interní síti bez internetu, písma kompatibilní s MS Office, vlastní písma
- PDF s doložkou (stav verze, schválení, účinnost, neřízená kopie) a vodoznakem NÁVRH / NEPLATNÉ – razítko při stažení
- Fulltext v obsahu souborů (bez diakritiky) v správě i v portálu, úryvky
- Porovnání verzí po odstavcích a slovech; zaměstnanci vidí „Co se změnilo“ před potvrzením seznámení

## Fáze 4s – DMS IV: úpravy v desktopovém Office (v0.25) ✅

- „Upravit ve Wordu / Excelu / PowerPointu“ – otevření přes Office URI + WebDAV s osobním tokenem, automatická rezervace verze
- Uložení (Ctrl+S) = nová revize souboru (další uložení v téže úpravě ji přepisují), převod do PDF a text na pozadí
- Otevření jen pro čtení u schválených verzí

## Fáze 4t – Připravenost na prvního zákazníka (v0.25.1–v0.26) ✅

- Bezpečnostní revize (WebDAV XSS, ZIP bomby, SSO domény, oprávnění AI návrhů, omezení přihlášení z IP…) a regresní testy
- Výkonnostní test `load-test.ts` (5–15 tis. aktiv, 40–120 tis. zranitelností, stovky dokumentů) a hromadné vyhodnocení okruhů
- Test aktualizace z v0.21.2 (data starší verze → migrace → přehledy bez chyb)
- Průvodce nastavením (13 kroků se stavem z dat), výchozí struktura složek, předávací protokol (Word / PDF)
- Nápověda k obrazovce, úvodní prohlídka podle role, uživatelská příručka ke stažení

## Fáze 4u – Zeptej se dokumentace (v0.27) ✅

- Úseky platných verzí (text + soubory) s nadpisem/článkem, vektory z lokálního modelu (bge-m3) v pgvector
- Hybridní vyhledávání (význam + slova), jen dokumenty čitelné pro uživatele, odpověď s citacemi [1], [2]
- Indexace po schválení a plánovačem (nové texty z převodní služby, změna modelu), stav v AI asistentovi a Provozu

## Fáze 4v – Identity a přístupy I (v0.28) ✅

- Konektory Active Directory (LDAPS, účet jen pro čtení) a Microsoft Entra ID (Graph, aplikace s oprávněním ke čtení)
- Účty se vnořeným členstvím, privilegované skupiny podle SID / privilegované role Entra, MFA, poslední přihlášení
- Nálezy: neaktivní, nikdy nepřihlášené, odešlí (deaktivovaní v CONTIXu), heslo bez expirace / bez hesla, AS-REP a Kerberoasting,
  neomezená delegace, staré heslo správce, bez MFA, příliš mnoho privilegovaných členů; výjimky s termínem, CSV pro auditora
- Plánovaná synchronizace, trend, dlaždice na přehledu, kontrola v Provozu, krok průvodce nastavením, nástroj pro AI dotazy

## Fáze 4w – Identity a přístupy II (v0.29) ✅

- Toxické kombinace (SoD): pravidla nad skupinami AD, rolemi Entra ID a funkčními místy; osoba přes všechny adresáře
- Přezkum přístupů: kampaně se zmrazeným rozsahem, recenzent funkční místo / vedoucí útvaru, úkoly v Moje povinnosti,
  ověření odebrání podle adresáře, protokol (tisk / Word)

## Fáze 4x – Identity a přístupy III (v0.30) ✅

- Synchronizace uživatelů (SSO účty), útvarů (department) a funkčních míst (title) z AD / Entra ID pro členy zvolené skupiny,
  deaktivace odešlých, náhled změn; sledované skupiny Entra ID
- Automatické testy opatření: kontrola účtů v intervalu a uzavřený přezkum přístupů → dokončený test + důkaz u opatření

## Další kroky

- Integrace s TheHive (případy z incidentů), knihovna loveckých dotazů nad Wazuhem (MITRE ATT&CK)
- Kontrola rozporů mezi dokumenty (AI návrh pro gestora)

## Plán DMS

- volitelně později: úpravy v prohlížeči (OnlyOffice přes WOPI) – jen pokud by zákazníci potřebovali práci bez desktopového Office

## Další kroky

- Zkušenosti z pilotu (test na testovacím serveru, první zákazník)
- pgvector – sémantické vyhledávání v dokumentaci

## Fáze 5 – Audit + AI (v0.5)

- Audity, zjištění, nápravná opatření
- AI asistent: klasifikace aktiv, detekce duplicit, návrhy vazeb, sumarizace; MCP server
- pgvector sémantické vyhledávání v dokumentaci

## Fáze 6 – Collector a škálování

- `apps/collector` pro síťové segmenty (sken, SNMP, pasivní discovery)
- Multi-tenant (pro poskytování jako služby více klientům), reporting a exporty
