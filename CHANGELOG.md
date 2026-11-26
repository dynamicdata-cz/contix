# Změny (CHANGELOG)

Přehled vydání CONTIXu. Podrobnosti ke každé změně jsou v rozhodnutích [docs/05_decisions](docs/05_decisions/) (ADR).

## 1.112.0

Požadovaná kvalifikace pracovníků dodavatele (ADR-204).

- **Požadavek u dodavatele**: v záložce Smlouvy a dotazníky lze u dodavatele zadat požadovanou kvalifikaci, např. „CCNA alespoň u 2 pracovníků“ nebo „ISO 27001 Lead Auditor“. CONTIX ji průběžně vyhodnocuje proti Certifikátům pracovníků (zapsaným ručně i z dotazníku dodavatele) a ukazuje, kdo požadavek splňuje a dokdy.
- **Upozornění**: nesplněný požadavek, nebo blížící se den, kdy přestane být splněn (končí platnost certifikátů), je v povinnostech, upozorněních a kalendáři lhůt s odkazem na dodavatele.

## 1.111.0

Revize a termíny prvků fyzické bezpečnosti lokalit (ADR-203).

- **Revize u lokality**: u prvků, které lokalita má (EPS, hašení, UPS, EZS, kamery, klimatizace, záložní zdroj…), lze zapsat datum poslední revize / kontroly provozuschopnosti a interval (doporučený ročně, záložní zdroj půlročně). V detailu lokality je u prvku vidět termín další revize, oranžově před termínem a červeně po termínu.
- **Upozornění**: termíny revizí jsou v povinnostech, upozorněních a kalendáři lhůt (30 dní předem) s odkazem přímo na lokalitu.
- **Nálezy a monitor**: revize po termínu je nález v Nálezech (vysoká u EPS, hašení nebo UPS v serverovně či datovém centru) a započítá se do monitoru „Fyzická bezpečnost lokalit“. Po zapsání nové revize se nález sám uzavře.
- **Oprava**: v přehledu povinností týmu chyběla platnost certifikátů osob.

## 1.110.1

Opravy.

- **Přesun dodavatele do jiné společnosti** nově přesune i certifikáty pracovníků dodavatele (dříve zůstaly ve zdrojové společnosti).
- **Stabilní pořadí** inventářů ze sběrače u aktiva (dříve náhodné); testy nových funkcí 1.110 nyní ověřují i oddělení dat podle společnosti.

## 1.110.0

SBOM automaticky z Harboru a certifikáty pracovníků v dotazníku dodavatele (ADR-202).

- **CRA – SBOM z Harboru**: tlačítko „Načíst z Harboru“ (i automatické načítání) nově stáhne i SBOM obrazu, pokud ho Harbor vygeneroval (Harbor 2.11+, „Generate SBOM“ nebo automaticky při push), a doplní komponenty produktu včetně párování se zranitelnostmi. Ručně nahraný SBOM se bez potvrzení nepřepíše – u produktu je odkaz „Nahradit SBOMem z Harboru“. Stav SBOM je vidět u produktu.
- **Dotazník dodavatele – certifikáty pracovníků**: dodavatel v dotazníku vyplní certifikáty a školení svých pracovníků (jméno, certifikát, vydavatel, číslo, platnost) a přiloží doklad. Po odevzdání se zapíší do Certifikátů pracovníků u dodavatele a hlídá se jejich platnost; v detailu dotazníku i v tiskové zprávě je jejich přehled.
- **Oprava**: převod textového umístění aktiv bere zápis místa vždy od nejstaršího aktiva (dříve náhodně).

## 1.109.0

Fyzická bezpečnost lokalit v nálezech a v plnění opatření.

- **Nálezy**: lokalita, které chybí doporučené prvky fyzické bezpečnosti (datové centrum, serverovna, technická místnost, budova), má nález v Nálezech (zdroj Monitoring a zóny) – závažnost vysoká u serverovny / datového centra bez přístupového systému nebo EPS. Po doplnění prvků se nález sám uzavře; lze k němu zapsat výjimku.
- **Průběžné monitorování opatření**: nový monitor „Fyzická bezpečnost lokalit“ – připojte ho k opatření fyzické bezpečnosti (vyhláška 409/410, ISO 27001 A.7) a jeho běhy slouží jako průběžný důkaz a test účinnosti; výjimky jsou lokality s chybějícími prvky.

## 1.108.0

Lokality – dotažení (navazuje na ADR-198).

- **Detail budovy a dalších netechnických aktiv** (informace, služby, procesy, lidé, dodavatelé): místo prázdných technických údajů (IP, MAC, OS) karta Umístění – cesta v lokalitách, druh, adresa a souhrn fyzické bezpečnosti.
- **Rychlá náprava v Kontrole vazeb**: kritickou techniku bez umístění lze rovnou umístit do lokality, u aktiva na více místech ponechat jedno, nesmyslnou vazbu „umístěno v“ odebrat jedním kliknutím.
- **Převod textového umístění**: aktiva s umístěním zapsaným textem („Budova A › 2. patro › Serverovna“) se převedou na lokality – chybějící se založí podle cesty (budova, patro, místnost), existující se znovu použijí a aktiva se do nich umístí.

## 1.107.2

- **Objekt / prostory ve formuláři aktiva**: místo technických údajů (IP, MAC, OS) se ukáže karta Lokalita – druh (budova, patro, serverovna…), nadřazená lokalita a adresa. Technické údaje se neukazují ani u informačních aktiv, služeb, procesů, lidí a dodavatelů.
- **Umístění techniky přímo ve formuláři**: u serveru, síťového prvku apod. lze vybrat lokalitu (budovu, místnost) ze stromu Lokalit; volný text umístění zůstává jako upřesnění.

## 1.107.1

- Anglické znění nových chybových hlášek (lokality, certifikáty osob, Harbor).
- Přehled vazeb mezi evidencemi zná nové vazby: zóna a půdorys v lokalitě, certifikáty pracovníků dodavatele (oprava kontrolního testu v CI).

## 1.107.0

Harbor a opravy zranitelností komponent v CRA (ADR-201).

- **Oprava u každého nálezu produktu**: nejnižší verze s opravou (z rozsahů OSV nebo ze skenu Harboru), příkaz pro aktualizaci podle ekosystému (npm, pip, Maven, Go, Cargo, NuGet, Composer, Bundler, apt, apk, dnf) s tlačítkem Kopírovat a odkazy na opravu a oznámení (FIX / ADVISORY záznamu OSV, odkazy skeneru, vždy i záznam na osv.dev). Do příkazu se dostanou jen bezpečné znaky.
- **Harbor**: v detailu produktu lze zadat obraz („projekt/repozitář:tag“). CONTIX načte výsledek skenu obrazu (Trivy v Harboru) – nálezy s opravenou verzí a odkazy – ručně tlačítkem nebo automaticky (výchozí jednou denně). Nastavení v CRA → Oznámení výrobců: adresa Harboru a robotický účet jen pro čtení (heslo se ukládá šifrovaně).
- **Opravené nálezy se uzavřou samy**: co v novém skenu obrazu (nebo po novém SBOM) už není, je „zmizelé“ a CONTIX navrhne stav VEX **Opraveno**; u známé opravy navrhne **Zasaženo** s popisem akce („Aktualizovat X na verzi Y“). Návrhy lze přijmout jednotlivě nebo všechny najednou a pak exportovat OpenVEX / CycloneDX VEX.
- Oprava občas selhávajícího testu odkazu na kalendář (náhodný token).

## 1.106.0

Utlumení historických zranitelností (ADR-200).

- **Karta Historické zranitelnosti** (Zranitelnosti): kritéria „aktivum se nehlásí déle než N dní“ (vypnutý virtuál, vyřazený počítač) a „nález starší než N dní“, volitelně jen do určité závažnosti a jen z Wazuhu. Náhled ukáže, kolik otevřených zranitelností kritériím odpovídá; jedním tlačítkem se utlumí všechny – se zdůvodněním a volitelnou lhůtou. Aktivně zneužívané (KEV) se ve výchozím stavu neutlumí nikdy.
- **Pravidla utlumení**: kritéria lze uložit jako pravidlo, které se použije po každé synchronizaci Wazuhu – nové historické nálezy utlumí a když se aktivum znovu ozve, jeho nálezy zase otevře. Vypnutí nebo smazání pravidla vrátí jeho nálezy mezi otevřené.
- Nový stav zranitelnosti **Utlumená (historická)**: nepočítá se do semaforu, přehledů ani priorit; po uplynutí lhůty se znovu otevře, když ji zdroj stále hlásí; když ji zdroj přestane hlásit, je vyřešená.
- Ruční utlumení vybraných nálezů v tabulce zranitelností (hromadná akce „Utlumit“) a filtr seznamu podle stáří nálezu a nečinnosti aktiva.

## 1.105.0

Certifikáty a osvědčení osob (ADR-199).

- **Nová záložka Školení → Certifikáty a osvědčení**: externí certifikace (CCNA, CISSP, ISO 27001 Lead Auditor), osvědčení ze školení, oprávnění a licence. Držitelem je uživatel CONTIXu, osoba z personální evidence (zaměstnanec, externista) nebo externí pracovník dodavatele bez účtu.
- **Soubor certifikátu** (PDF, PNG, JPG do 10 MB) se ukládá k záznamu a stahuje se jen jako příloha.
- **Platnost**: filtr platné / brzy vyprší (do 60 dnů) / po platnosti / bez omezení; před koncem platnosti přijde upozornění (nová povinnost „Platnost certifikátu osoby“ v přehledu povinností, e-mailu i Teams). Držitel s účtem ji vidí i v Moje práce.
- **Započtení kurzu**: osvědčení uživatele může splnit kurz z plánu školení – zapíše se do přehledu absolvování (§ 10 odst. 5 vyhl. 409/2025); se změnou nebo smazáním certifikátu se záznam upraví či smaže.
- **Detail dodavatele** ukazuje certifikáty jeho pracovníků.

## 1.104.0

Lokality – budovy, patra, místnosti a datová centra (ADR-198).

- **Nová obrazovka Aktiva → Lokality**: strom Areál › Budova › Patro › Místnost / Serverovna / Datové centrum. Lokalita je aktivum (typ „prostory“), takže má vlastníka, kritičnost, rizika a vazby jako každé jiné aktivum.
- **Umístění techniky**: servery, racky, síťové prvky i podřízené lokality se umisťují do lokality (vazba „umístěno v“); technika v racku se počítá do místnosti racku. Detail aktiva ukazuje celou cestu umístění. Aktivum leží vždy na jednom místě – nové umístění nahradí dosavadní.
- **Fyzická bezpečnost lokality**: přístupový systém, EZS, kamery, EPS, hašení, klimatizace, UPS, generátor, detekce zaplavení, evidence návštěv (ano / částečně / ne), adresa a datum poslední kontroly. U serveroven, datových center, technických místností a budov se ukazují mezery proti doporučenému minimu.
- **Zóny v lokalitě**: bezpečnostní zóna může patřit do lokality; mapu zón lze filtrovat podle budovy. Půdorysy (Mapy) lze přiřadit k lokalitě.
- **Kontrola vazeb**: vazba „umístěno v“ na aktivum, které není lokalitou ani rackem, umístění na více místech, cyklus lokalit, nelogické vnoření (budova v místnosti) a kritická technika bez umístění. Nové vazby „umístěno v“ jinam než do lokality nebo racku se už nepřijmou.
- Oprava: vazba „umístěno v“ se už nepočítá jako síťový tok přes hranici zón (nezakládá nález „vazba přes hranici zón“).

## 1.103.1

Opravy podle připomínek z provozu.

- **Wazuh nespojuje různé počítače do jednoho aktiva**: dva agenti se sdílenou virtuální MAC adresou (FortiClient, Cisco AnyConnect, VMware, lokálně spravované adaptéry) nebo se stejným sériovým číslem (klonované virtuály) se slévali do jednoho aktiva – aktivum pak střídavě ukazovalo jméno a operační systém jiného počítače a druhý počítač v evidenci chyběl. Takové MAC adresy a link-local IP (169.254.x.x, fe80::) se k párování nepoužívají a sériové číslo ani MAC nespojí zařízení s různým jménem. Už chybně spojená aktiva se při další synchronizaci rozdělí sama: druhý agent dostane vlastní aktivum a jeho adresy se z původního odeberou.
- **Síťový sken nezakládá duplicity**: zařízení nalezené jen podle IP adresy (bez MAC a jména, typicky za routerem) se spáruje s existujícím aktivem se stejnou adresou, např. s aktivem z Wazuhu. Dřív založené duplicity („10.32.0.10“ apod.) smažte nebo slučte v Kvalitě dat – další sken je už nezaloží.
- **Opatření holdingu a podřízené organizace se nezdvojují**: když má podřízená organizace vlastní opatření se stejným kódem jako nadřazená (např. N-03), v plnění požadavků se ukáže jen její vlastní; opatření nadřazené organizace bez vlastní obdoby jsou označená „skupina“.
- **Rozbalovací výběr se neořízne**: seznam (osoby, aktiva…) se otevírá nad stránkou, takže ho nezakryje rámeček karty (např. Kvalita dat → Aktiva s nálezy bez technického garanta); když pod polem není místo, otevře se nahoru.
- Rada k opravě zranitelností Windows: `winget` jen na Windows 10/11 a Serveru 2025, na Windows Serveru 2016–2022 instalátor výrobce.

## 1.103.0

Přemýšlení AI modelu podle druhu úlohy (ADR-197).

- **Přemýšlení zvlášť pro rychlé odpovědi a pro analýzy** (Administrace → AI asistent): u modelů s uvažováním (qwen3, qwen3.5, deepseek-r1) lze přemýšlení vypnout tam, kde uživatel na odpověď čeká (dotaz v přirozeném jazyce, Zeptej se dokumentace, odpovědi nad záznamy, otázka SOC poradci), a ponechat zapnuté u analýz a návrhů, kde zlepšuje kvalitu (návrhy k rizikům, aktivům a dokumentům, plán nápravy, rozbor zranitelnosti, triáž a rozbor alertů, shrnutí bezpečnostních testů, vytěžení PDF). Výchozí volba „Podle obecného nastavení“ zachová dosavadní chování.
- Test příznaku spustitelnosti skriptů čte režim souborů přímo z indexu gitu – obraz CI program `git` nemá.

## 1.102.2

- **Vypnutí přemýšlení AI modelu** (Administrace → AI asistent → *Přemýšlení modelu*): u modelů s uvažováním (qwen3, qwen3.5, deepseek-r1) lze přemýšlení vypnout a dostat rychlé odpovědi – stejně jako `ollama run … --think=false`. Ollama dostane parametr `think`, OpenAI-kompatibilní servery (Ollama /v1, llama.cpp, vLLM) standardní `reasoning_effort: "none"`. Odmítne-li server parametr, dotaz se zopakuje bez něj. Výchozí volba posílá dotazy jako dosud. Podnět z pilotního provozu.
- Test příznaku spustitelnosti skriptů kontroluje režim uložený v gitu (runner CI může kód vytáhnout bez příznaku na disku).

## 1.102.1

Opravy podle připomínek z provozu.

- **Opravené zranitelnosti z Wazuhu se spolehlivě uzavírají**: když čtení z Wazuh Indexeru u velké instalace spadlo uprostřed (vypršení stránkování, časový limit), neuzavřelo se nic a běh přitom vypadal jako dokončený. Zranitelnosti se teď čtou seřazené podle agenta – při přerušení se uzavřou opravené u všech agentů, kteří se stihli celí načíst, a log řekne, kde čtení skončilo. Neúplné čtení (méně záznamů, než Indexer ohlásil) naopak nic neuzavře omylem. Stránkování Indexeru má delší platnost (5 min).
- **Nálezy identit ukazují jméno**: nálezy počítačů a účtů (např. „Systém bez podpory výrobce“) měly v registru nálezů, úkolech, výjimkách a reportu místo názvu vnitřní kód (`computer:…`). Nově přihlašovací jméno účtu nebo název počítače; hledání v registru najde i podle názvu. Už založené úkoly se při aktualizaci přejmenují.
- **Širší rozbalovací výběr** (osoby, garanti, zástupci): seznam se roztáhne podle obsahu až na 32 rem, jméno má přednost a zkracuje se jen pomocný text (funkce, e-mail), celý je v bublině.

## 1.102.0

Rychlejší Přehled a trvalá kontrola čitelnosti (ADR-196).

- **Přehled jedním dotazem pro technické karty**: bezpečnostní testy, monitoring a zóny, certifikáty TLS, SOC, konfigurace serverů a provoz se načítají jedním požadavkem místo sedmi a prohlížeč nestahuje celé seznamy (certifikáty, mapa zón, politiky SCA) – jen čísla pro karty. Oprávnění a moduly platí stejně jako u samostatných obrazovek.
- **Trvalá kontrola čitelnosti** v automatických testech: každé vydání projde všechny hlavní obrazovky ve světlém i tmavém režimu (i se systémem v tmavém režimu) a hlídá kontrast textu, textů v grafech a tlačítek při najetí myší, vodorovné přetečení a zúžené záhlaví. Chyby typu „bílá na bílé“ z verzí 1.98.1–1.98.2 se tak už nevrátí bez povšimnutí.

## 1.101.0

Odběr kalendáře lhůt a vylepšení bezpečnostních zón (ADR-195).

- **Odebírat v kalendáři** (Kalendář lhůt): osobní adresa odběru pro Outlook nebo Google Kalendář – lhůty se v kalendáři aktualizují samy. Adresa slouží jen ke čtení lhůt, vždy s aktuálními oprávněními uživatele, jde omezit na jednu společnost a na zákonné lhůty a kdykoli zrušit. Ukládá se jen otisk tokenu.
- **Navrhnout rozsahy** (Bezpečnostní zóny): návrh rozsahů ze síťových segmentů skenů a z podsítí IP adres aktiv, které zatím nejsou v žádné zóně, s předvybranou zónou podle typů aktiv (pracovní stanice → Uživatelé, servery → Servery, síťové a bezpečnostní prvky → Správa, IoT/OT → OT, dostupné z internetu → DMZ). Rozsahy se ručně nemusí opisovat.
- **Řízený přechod**: u rizikové vazby přes hranici zón jde zapsat firewall, proxy nebo jump server (z evidence) či popis pravidla – nález se uzavře a vazba je v mapě zelená. Nový seznam vazeb přes hranice zón pod mapou.
- **IPv6 v zónách**: rozsahy i zařazení aktiv podle IPv6 adres (nejpřesnější rozsah vyhrává napříč IPv4 i IPv6).

## 1.100.0

Prioritizace zranitelností – opravy místo tisíců nálezů (ADR-194).

- **Přehled – karta Zranitelnosti** ukazuje počet **prioritních k opravě** (P1 + P2) místo všech otevřených nálezů, rozpad podle priority, aktivně zneužívané (KEV), po termínu opravy, kolik % prioritních vyřeší 10 aktualizací a nejúčinnější aktualizaci.
- **Plán oprav podle balíčků**: nad tabulkou souhrn „prvních 10 aktualizací odstraní X % prioritních“, u každého balíčku počet odstraněných prioritních s kumulativním podílem, **cílová verze** ze skeneru (Trivy, Grype …) a nejbližší **termín opravy** podle lhůt priority.
- **Naplánovat opravu**: z řádku plánu vznikne úkol „Aktualizovat balíček …“ s dotčenými aktivy, cílovou verzí, nejprioritnějšími CVE a termínem.
- **Povinnost „Oprava zranitelností“** na aktivu nově jmenuje aktualizaci, která na něm odstraní nejvíc prioritních zranitelností.

## 1.99.0

Technická bezpečnost na Přehledu (ADR-193).

- **Bezpečnostní testy i v souhrnu skupiny**: karta bezpečnostních testů se dosud v pohledu „Celá skupina“ nezobrazovala; nyní sčítá všechny společnosti v rozsahu.
- **Nové karty v sekci Technická bezpečnost**:
  - *Monitoring a zóny* – otevřené nálezy z monitoringu (odpojení či zastaralí agenti Wazuhu) a kontrol zón, rizikové vazby přes hranice zón, zařazení aktiv do zón;
  - *Certifikáty a TLS* – prošlé, brzy vypršující a nálezy konfigurace TLS;
  - *SOC – bezpečnostní alerty* – otevřené alerty podle závažnosti, bez analytika, eskalace a doba do převzetí;
  - *Konfigurace serverů (CIS)* – podíl splněných kontrol konfigurace z Wazuh SCA;
  - *Provoz a zálohy* (správce) – provozní kontroly, problémy a poslední úspěšná záloha.
- Karta „Co mám udělat tento týden“ a Kalendář lhůt: data bez nesmyslného času (např. „1. 1. 2026“ místo „01.01.26 1:00“).

## 1.98.2

Opravy rozvržení a tmavého režimu.

- **Záhlaví stránek s mnoha tlačítky** (např. Aktiva): při velkém počtu akcí se popis stránky zúžil na úzký sloupec po jednom slově. Nadpis a popis mají teď základní šířku a tlačítka se zalomí pod ně.
- **Tmavý režim podle CONTIXu, ne podle systému**: některé obrazovky (projekty, přístupy a IdM, mapy a půdorysy, CRA, profil) měly vlastní tmavé barvy, které se zapínaly podle nastavení systému (macOS/Windows v tmavém režimu). Ve světlém režimu CONTIXu pak dělaly tmavé ostrůvky a v tmavém světlé pruhy při najetí myší. Odstraněno – tmavý režim řídí jen volba v CONTIXu.
- **Hlavní tlačítka v tmavém režimu**: při najetí myší zesvětlela do bledé barvy s bílým textem (např. „Přečíst a potvrdit“). Nyní jen mírně zesvětlí plnou barvu.
- Kontrola všech obrazovek (světlý i tmavý režim, šířka 1280 a 1700 px): bez dalších nalezených problémů s kontrastem či přetečením.

## 1.98.1

Opravy zobrazení grafu vazeb aktiv.

- **Tmavý režim grafu vazeb aktiv**: uzly měly bílou výplň s bílým textem a vrstvy světlé pásy s rozmazanými popisky. Výplň uzlů, pásy vrstev a zvýraznění dopadu výpadku se teď řídí barvami režimu (světlý i tmavý). Totéž pro štítky aktiv na mapě bezpečnostních zón.
- **Graf na celou obrazovku**: nové tlačítko vpravo nahoře zobrazí graf přes celou obrazovku (zpět tlačítkem nebo klávesou Esc). Dosavadní tlačítko se šipkami jen vrací pohled na celý graf – nově má popisek „Celý graf“.

## 1.98.0

Tento týden a kalendář zákonných lhůt (ADR-192).

- **Co mám udělat tento týden** – nová karta na Přehledu: zákonné lhůty na příštích 7 dní a vše po termínu, kritické nálezy a vysoké nálezy s termínem do týdne a pro správce nedokončené povinné kroky nastavení. Každá položka vede rovnou na místo, kde se řeší.
- **Kalendář lhůt** (menu pod Moje práce): termíny z celé evidence po měsících s právním základem – hlášení a ohlášení NÚKIB, zavedení opatření do 1 roku od rozhodnutí o registraci, přezkumy ISMS, rizik a dokumentů, audity, testy kontinuity, přezkumy přístupů, smlouvy a zprávy dodavatelů, GDPR, AI Act, CRA a **test obnovy zálohy** (do 92 dní od posledního úspěšného). Filtr *Jen zákonné lhůty*, právní základ a období 3–24 měsíců.
- **Export do Outlooku / Google Kalendáře**: tlačítko *Stáhnout do kalendáře (.ics)*; zákonné lhůty mají připomínku 7 dní předem, opakovaný import termíny přepíše, nezdvojí.

## 1.97.0

Bezpečnostní zóny a vrstvená mapa (ADR-191).

- **Bezpečnostní zóny** (Aktiva → Bezpečnostní zóny): jedním tlačítkem vznikne výchozí sada Internet, DMZ, Hosté, Uživatelé, Servery, Správa a OT s úrovní důvěry 0–4. Zóny jde přejmenovat, smazat a přidávat **vlastní** (např. Kamery, Interní DMS) s vlastní úrovní důvěry – základ je hotový, další vrstvy si doplníte podle své sítě.
- **Zařazení aktiv podle IP**: do zóny zapíšete rozsahy IP a aktiva se zařadí sama (nejpřesnější rozsah vyhrává); přepočet po uložení zóny, tlačítkem i plánovačem. V detailu aktiva jde zónu nastavit ručně a zase vrátit na automatiku.
- **Vrstvená mapa zón**: zóny od nedůvěryhodné po kritickou, u aktiv sběr dat a dostupnost z internetu, šipky vazeb přes hranice zón obarvené podle rizika (skok o víc úrovní nebo do správy či OT = červená).
- **Kontroly segmentace jako nálezy** (zdroj registru nálezů se nově jmenuje *Monitoring a zóny*): aktivum v DMZ / z internetu bez sběru dat, pracovní stanice v zóně serverů či správy, riziková vazba přes hranici zón, zóna bez sledovaného aktiva. Po nápravě se nález sám uzavře.

## 1.96.0

Nálezy monitoringu a report počítačů z AD (ADR-190).

- **Nálezy z odpojených agentů Wazuhu**: v registru nálezů je nový zdroj **Monitoring (Wazuh)** – agent bez spojení déle než 7 dní (u serveru vysoká závažnost) a agent se starší verzí než manager. Nález má aktivum, garanta, lhůtu podle závažnosti a jde z něj založit úkol nebo zapsat výjimku s termínem. Jakmile se agent znovu připojí nebo aktualizuje, nález se sám uzavře (i s úkolem). Přepočítává se po synchronizaci Wazuhu a pravidelně plánovačem.
- **Report „Počítače a servery z AD“** (Word / tisk do PDF, v záložce Počítače i v Reportech identit a v měsíčním rozesílání garantovi): stav podle rolí, systémy bez podpory výrobce s kolonkou rozhodnutí, aktivní servery bez sběru dat, neaktivní počítače podle OU, počítače bez LAPS nebo s neomezenou delegací.
- AI plán oprav dostává u nálezů monitoringu jen pseudonym serveru (bez jména a IP).

## 1.95.0

Provozní pojistky (ADR-189).

- **Zálohovat a otestovat obnovu** jedním tlačítkem v Administrace → Provoz: služba záloh požadavek převezme do minuty, vytvoří zálohu a obnoví ji do dočasné databáze; výsledek se objeví v seznamu záloh a kontrola „Test obnovy“ zezelená. Bez příkazů na serveru.
- **Instalátor sondy kontroluje síť**: ověří DNS server, překlad jména CONTIXu, spojení na jeho port a internet. Když sonda nemá DNS nebo nezná jméno CONTIXu, zeptá se na ně (nebo `--dns IP`, `--contix-ip IP`) a zapíše je; chybějící nástroje vypíše i s příkazem k instalaci.
- **Pojistka**: automatický test hlídá, že skripty v `infra/scripts` mají příznak spustitelnosti (chyba „command not found“ z 1.92.1 se nemůže opakovat).

## 1.94.0

Podněty z pilotního provozu (ADR-188).

- **Průvodce nastavením – Organizace**: už nehlásí chybějící údaje, když jsou vyplněné. Kontroluje profil aktivní společnosti (dříve četl staré globální nastavení), regulované služby vyžaduje jen v režimu zákona a uzná je i ze zapsaného posouzení; odkaz vede na Nastavení nebo Společnosti podle toho, kde se údaje vyplňují.
- **Ohlášení regulované služby – oprava záznamu**: tlačítko *Opravit záznam o ohlášení* změní datum a číslo podání; se zaškrtnutím *Ohlášení obsahovalo aktuální údaje* se současné údaje vezmou jako ohlášené a nevznikne ohlášení změny (např. když jste ohlašovali už dříve a údaje doplnili až teď). *Zrušit záznam o ohlášení* vrátí stav na „k ohlášení“. U prvního záznamu je nápověda, že přibližné datum jde později opravit.
- **Rozhodnutí NÚKIB o registraci**: v kartě ohlášení zapíšete datum doručení a číslo jednací a přiložíte PDF rozhodnutí. CONTIX ukáže termín **zavedení bezpečnostních opatření (1 rok od doručení)** se zbývajícími dny a odpovědné funkční místo dostane povinnost v Moje práce.
- **Test obnovy zálohy**: `restore.sh --test` bez názvu souboru otestuje nejnovější zálohu. Hlášení v Administrace → Provoz i dokumentace uvádějí celý příkaz: `cd /opt/contix && sudo docker compose --profile full run --rm backup restore.sh --test`.
- **Instalace na Debian 13**: návod instalace Dockeru bere repozitář podle distribuce (dříve vždy Ubuntu, na Debianu nefunkční).

## 1.93.1

- Oprava: `infra/scripts/update.sh` v 1.92.1 ztratil příznak spustitelnosti, takže `sudo ./infra/scripts/update.sh` hlásil „command not found“. Příznak je zpět; pro jistotu lze vždy spustit i `sudo bash ./infra/scripts/update.sh`.

## 1.93.0

Mapa propojení – připojená zařízení Wazuhu (ADR-187).

- Kliknutím na uzel Wazuhu v mapě propojení se v panelu ukážou **připojená zařízení a jejich stav**: aktivní, bez spojení déle než 7 dní, odpojená, čekající na připojení, se starší verzí než manager a odebraná z Wazuhu; pod tím problémoví agenti s IP, dobou bez spojení, verzí a kritickými zranitelnostmi.
- **Všechna zařízení** v okně: filtry podle stavu, hledání (jméno, IP, skupina, systém), poslední spojení, verze, systém, skupiny Wazuhu, odkaz na aktivum a počet zranitelností; export CSV / XLSX.
- Uzel Wazuhu nově varuje, když jsou agenti bez spojení déle než 7 dní, a informuje o odpojených a zastaralých agentech; v údajích je počet aktivních a odpojených agentů.
- Stav je z poslední synchronizace Wazuhu (bez dalšího zatížení Wazuh API).

## 1.92.1

- Oprava: `update.sh` spuštěný přímo ze složky `infra/scripts` (`./update.sh`) po úspěšné aktualizaci nenašel kontrolu `verify.sh` („No such file or directory“). Kontrola se teď volá z kořene instalace bez ohledu na to, odkud se skript spustil.

## 1.92.0

Identity a přístupy – přehlednější dlaždice nálezů (doplněk ADR-186).

- Dlaždice nálezů podle pravidla jsou rozdělené do skupin **Účty a hesla**, **Privilegovaný přístup** a **Počítače a servery**; u skupiny je počet nálezů a základ (z kolika povolených účtů / privilegovaných účtů / počítačů).
- Každé pravidlo má barevný proužek podle nejvyšší závažnosti svých nálezů, podíl v procentech s ukazatelem a řadí se od nejzávažnějšího a nejčastějšího. Kliknutím se filtr nastaví nebo zruší jako dosud.

## 1.91.0

Identity a přístupy – počty aktivních a neaktivních objektů v adresáři (ADR-186).

- **Objekty v adresáři** v Přehledu: účty (aktivní, neaktivní, nikdy nepřihlášené, zakázané; uživatelé / servisní / hosté / privilegované a kolik z nich je aktivních), počítače (aktivní, neaktivní, zakázané; řadiče, servery, stanice) a skupiny (celkem, privilegované) s podílem v procentech. Kliknutím se otevře příslušný seznam s filtrem.
- **Záložka Účty**: dlaždice aktivní / neaktivní / nikdy nepřihlášené / zakázané a nový filtr *Aktivita*.
- **Záložka Počítače**: dlaždice a výběr *Aktivní*.
- Aktivní = povolený a přihlášený v limitu ze zásad zdroje (stejný jako u nálezů, výchozí 90 dní). U Entra ID bez údaje o přihlášení (chybí licence) se účet vykazuje jako „přihlášení neznámé“, ne jako nikdy nepřihlášený.

## 1.90.0

Identity a přístupy – počítače a servery z Active Directory (ADR-185).

- **Záložka Počítače**: zdroj AD nově čte (jen pro čtení) i počítače – roli (řadič domény, server, stanice), operační systém a jeho podporu výrobcem, poslední přihlášení, LAPS, delegaci a OU. Souhrnné dlaždice (neaktivní, bez podpory, bez aktiva, servery bez sběru dat, podíl LAPS), filtry a export CSV / XLSX. Načítání lze u zdroje vypnout.
- **Vazba na aktiva**: počítač se sám spáruje s aktivem podle jména nebo DNS (jen jednoznačná shoda, údaje aktiva se nepřepisují, doplní se prázdné FQDN a systém); aktivum dostane zdroj „Active Directory“. Vybrané počítače bez aktiva lze **hromadně založit jako aktiva**.
- **Nové nálezy**: neaktivní počítač, systém bez podpory výrobce, neomezená delegace Kerberos, počítač bez LAPS, LAPS v doméně nenasazen, počítač ve výchozím kontejneru Computers a **server bez sběru dat** (bez agenta CONTIX, sběrače i Wazuhu). Nálezy ukazují počítač a odkaz na aktivum, filtrují se podle počítače a jdou do reportů, exportů i registru nálezů jako ostatní.
- **Mapa propojení**: karta pokrytí ukazuje aktivní servery z AD a kolik z nich nemá aktivum v CONTIXu.
- Nastavení zdroje AD: *Načítat počítače a servery* a *Počítač neaktivní po dnech*.

## 1.89.0

Identity a přístupy – práce s nálezy a reporty (ADR-184).

- **Počty u filtru**: volby *Pravidlo* a *Závažnost* ukazují počet nálezů (s ostatními filtry); nad tabulkou je řádek **dlaždic podle pravidla** – kliknutím se filtr nastaví nebo zruší.
- **Export CSV a XLSX podle aktuálního filtru** (stav, závažnost, pravidlo, zdroj, hledání) přímo nad tabulkou nálezů; CSV dřív bralo jen stav a zdroj.
- **Cílené reporty Word / PDF** z filtru: *Neaktivní a nikdy nepřihlášené účty* (seskupení podle útvaru nebo OU, privilegované nahoře, sloupec pro rozhodnutí vedoucího a podpis), *Privilegované účty* (skupiny, stáří hesla, SPN, delegace, MFA, otevřené nálezy) a *Souhrn pro vedení* (stav, počty podle pravidel, vývoj za 6 měsíců, největší rizika). PDF tiskem stránky, s převodní službou i přímo.
- **Měsíční rozesílání** vybraných reportů garantovi modulu (funkční místo z panelu *Jak postupovat*) od zvoleného dne v měsíci, Word nebo PDF v příloze; tlačítko *Odeslat teď*.
- **Hromadné akce v Nálezech**: výběr otevřených nálezů → hromadná výjimka se společným odůvodněním a termínem, nebo úkoly (uzavřou se samy po vyřešení nálezu).

## 1.88.0

Vazby a slepá místa (ADR-183) – zjištění teď dojdou tam, kde mají něco změnit.

- **Signály u opatření a požadavků (SoA)**: nesplněný nebo neproběhlý monitor, otevřená neshoda z auditu, kritický / vysoký nález testu, incident za 90 dní, neúčinný poslední test a prošlé důkazy se ukazují v seznamu opatření, v detailu opatření a u požadavku v SoA. Požadavek ve stavu splněno / částečně se závažným signálem je označen „k přehodnocení“. Míru shody CONTIX sám nemění – rozhoduje člověk.
- **Nepřímé podněty k přehodnocení rizika**: riziko nad primárním aktivem nebo procesem dostane podnět i z podpůrných aktiv (incident, zranitelnost, nález serveru, nález testu, SOC, změna) – v seznamu podnětů označené „nepřímo“. Nový podnět: zranitelnost vlastního produktu (CRA) navázaná na riziko.
- **Software ze serverů s agentem CONTIX a sběračem** se zapisuje k aktivu (při změně balíčků) – infoservis a vyhledávání podle softwaru servery vidí i bez Wazuhu.
- **Upozornění na zdroje dat**: nový druh upozornění – agent, koncentrátor, sběrač, Wazuh, konektor nebo nespárovaný server ve stavu chyba / varování na mapě propojení jde do souhrnu bezpečnostního týmu a Teams.
- **Servery bez aktiva**: v seznamu serverů tlačítko *Spárovat / založit aktiva* pro všechny nespárované najednou (jednoznačná shoda se spáruje, jinak se aktivum založí).
- **Identity v registru nálezů**: nálezy účtů a porušení oddělení povinností (SoD) jsou v registru nálezů, v metrikách nápravy a lze z nich založit úkol.
- **Úkoly ze zranitelností**: z registru nálezů lze založit úkol k zranitelnosti (garant aktiva, termín podle lhůt oprav). Úkoly ze zranitelností, nálezů identit a SoD se uzavřou samy, když zdroj přestane být otevřený. Krok plánu nápravy s jedním nálezem zakládá úkol navázaný na nález.
- **Souhrn pro garanty aktiv** obsahuje i kritické a vysoké zranitelnosti a neshody auditů k aktivu.
- **Úkoly projektů v Moje akce** (aktivní projekty).
- **Rozsah auditu**: audit se navazuje na procesy, opatření a aktiva; záložka *Pokrytí* ukazuje, co nebylo v rozsahu dokončeného auditu za 1–5 let. Audity jsou ve zpětných vazbách aktiva, procesu a opatření.
- **Kvalita dat**: nová kontrola *Aktiva s nižší kritičností než proces, který podporují* (priorita nálezů se řídí kritičností aktiva).
- **Úklid odkazů na smazané záznamy**: štítky, výjimky kompenzované opatřením, vazby infoservisu a tikety se po smazání záznamu odstraní, úkol ztratí jen zdroj; počty u štítků už smazané záznamy nezahrnují.

## 1.87.0

- **Hardening jako důkaz k opatřením** (ADR-182, fáze A): každá kontrola hardeningu je namapovaná na požadavky vyhlášky 409 a 410, ISO/IEC 27001:2022 (příloha A) a CIS Controls v8 – např. synchronizace času k § 22 odst. 6 vyhlášky 409, zamykání účtů k § 19 odst. 1 písm. b), slabé šifry SSH ke kryptografickým požadavkům.
- **Nové monitory opatření**: *Hardening serverů – skóre* (průměrné skóre serverů s agentem CONTIX, výjimky = servery pod prahem) a *Hardening serverů – vybrané kontroly* (podíl splněných kontrol na všech serverech; bez výběru se použijí kontroly podle požadavků opatření). Volitelně jen produkční servery a jen hlášení z posledních N dní. Každý běh je záznam pro test provozní účinnosti (SOC 2 Type II).
- **Detail opatření → Zajištění**: karta *Hardening serverů k opatření* – které kontroly patří k požadavkům opatření, kolik serverů je splňuje a které ne (s odkazem na server).

## 1.86.1

- **Mapa propojení**: barva agenta a serveru ukazuje jen stav spojení. Nízké skóre hardeningu a vysoké nálezy jsou v panelu detailu jako informace a skóre je u uzlu barevně (červeně pod 65 %, oranžově pod 85 %, jinak zeleně). Dlouhý název serveru se už nepřekrývá se skóre.

## 1.86.0

- **Mapa propojení po zónách** (ADR-181): každá zóna sítě je vlastní pruh s koncentrátorem a jeho agenty, zvlášť sběrače se servery, vpravo bezpečnostní monitoring (Wazuh, sondy, síťový sken), evidence a identity (NetBox, JIRA, AD / Entra ID) a služby (AI, CISA KEV / EPSS, e-Sbírka, e-mail / Teams, převod dokumentů, zálohy). U spojení protokol a port a počet zpráv za 24 hodin, u uzlů stav, odznak (skóre hardeningu, počet agentů) a první důvod problému.
- **Panel detailu**: klik na uzel ukáže, proč má daný stav (ticho, zastaralá verze, čekající nebo nespárovaný agent, fronta, končící certifikát CA zóny, selhaná synchronizace…), údaje, spojení a odkazy na server, hardening, aktivum nebo konektor. Přepínač *Jen problémy*, *Celá obrazovka*, sbalování zón s mnoha servery, ovládání klávesnicí.
- **Pokrytí serverů**: kolik aktivních serverů posílá data přes agenta, sběrač nebo Wazuh, které nemají žádný sběr a které hlásí agent i sběrač současně.
- **Přehled**: nová dlaždice *Stav sběru dat* (zmenšená mapa zón, souhrn, problémy, pokrytí) a samostatná stránka *Discovery → Mapa propojení* pro správu, discovery i SOC.
- **Kontrola vazeb**: servery se ke sběrači přiřazují podle ID připojení (dříve podle názvu – dva sběrače se stejným jménem se pletly), agenti ke koncentrátoru podle ID, zóny bez ohledu na velikost písmen; servery hlášené přes neexistující připojení se hlásí jako problém. Stav i vazby počítá server jednou funkcí (`buildIntegrationMap`), stejně pro všechna zobrazení.

## 1.85.0

- **Hardening serveru** (ADR-180): v detailu serveru nová záložka *Hardening* se skóre a kontrolami podle CIS Benchmark a doporučení NÚKIB – SSH (včetně šifer, MAC a výměny klíčů), parametry jádra a sítě (sysctl), volby připojení /tmp, /var/tmp a /dev/shm, práva citlivých souborů, politika hesel a zamykání účtů, sudo bez hesla, účty bez hesla, AppArmor / SELinux, auditd a centrální záznamy, synchronizace času, rizikové služby, agent detekce, moduly jádra (USB úložiště, nepoužívané protokoly a souborové systémy), heslo zavaděče, aktualizace a Docker. U každé kontroly očekávaný stav, zjištěná hodnota, proč to vadí a jak to opravit. Nesplněné kontroly vysoké a střední závažnosti jsou zároveň nálezy serveru (úkoly, přijetí rizika). Vyhodnocení je v CONTIXu – agent posílá jen hodnoty.
- **Kontejnery v detailu**: kontejnerový engine (verze, rootless / userns, API po síti, práva soketu, skupina docker, icc, live-restore), u každého kontejneru stav, health, uživatel, oprávnění jádra, síť / PID / IPC hostitele, seccomp / AppArmor, no-new-privileges, kořen jen pro čtení, zařízení, limity, připojené svazky a bezpečnostní nálezy; image s velikostí a použitím.
- **Nové nálezy serveru**: kontejner se soketem Dockeru, se sítí nebo procesy hostitele, s nebezpečnými oprávněními jádra, bez seccomp / AppArmor, se zapisovatelnou systémovou složkou hostitele; API Dockeru po síti bez TLS; uživatelé ve skupině docker.
- **Agent 0.3** posílá kontejnery, image a engine (Docker i Podman, jen čtení přes lokální soket), aktualizace a restart, nastavení SSH serveru a fakta pro hardening. Sběrač 1.2 posílá podrobnosti o kontejnerech.

## 1.84.0

- **Agenti a koncentrátory** (ADR-177): registrace koncentrátoru jednorázovým kódem, schvalování agentů, podepsané zprávy a dávkový příjem. Údaje agenta (systém, porty, služby, balíčky, přihlašovací účty, SSH klíče, firewall, plánované úlohy) se promítnou do inventáře serveru; při jednoznačné shodě se server spáruje s aktivem sám, jinak nabídne *Založit aktivum* nebo *Spárovat*. Nezpracované zprávy schválených agentů se dozpracují po startu API a každých 10 minut.
- **Mapa propojení** v Konektorech: co s čím komunikuje (CONTIX, Wazuh, sběrače, koncentrátory, agenti, skenery) včetně stavu spojení.
- **Detail aktiva** přeuspořádán: přehled ve dvou sloupcích, kompaktní karta inventáře serveru se seskupenými nálezy, zranitelnosti na vlastní záložce.
- **Jednotný vzhled** (ADR-179): výchozí motiv Noc v tónech přihlašovací obrazovky – v tmavém režimu soumračně levandulový podklad s tmavě modrými kartami, lištou a panelem, ve světlém jemně levandulový podklad s bílými kartami; přihlášení vypadá stejně v obou režimech. Jedna podoba KPI dlaždic na všech stránkách, název stránky v drobečkové navigaci místo „Detail“.
- **Detaily záznamů se otevírají jako přehled**, úpravy tlačítkem *Upravit* (*Uložit* / *Zrušit úpravy*): rizika, opatření, dodavatelé a GDPR mají přehled s dlaždicemi, ostatní detaily (incidenty, audity, plány kontinuity, BIA, změny ISMS, dokumenty, školení, CRA, AI Act, SOC 2, procesní karta) zobrazí formulář jen ke čtení. Průběžná práce (hlášení, zjištění, verze dokumentů, testy, úkoly) funguje bez přepnutí.

## 1.83.0

- **Příručka vedoucího útvaru a garanta** (ADR-176): nová role v nápovědě a v příručce ke stažení – za co odpovídá vedoucí, vlastník a technický garant, Moje práce, týdenní souhrn, lhůty a eskalace nálezů, přehled útvaru, chybějící údaje a hromadné úpravy, změny lidí, práce z telefonu. Role se nabídne každému, kdo vidí aktiva, procesy nebo úkoly.
- Nápověda doplněna o novinky 1.78–1.82 (import útvarů a štítků, hromadné úpravy procesů, dodavatelů a úkolů, útvar dodavatele).
- **Předvolba Mistral AI** v Administrace → AI: adresa OpenAI-kompatibilního rozhraní, model `mistral-small-latest` a vektory `mistral-embed` jedním kliknutím (cloudová služba – texty odcházejí ke zpracovateli).

## 1.82.0

- **Přístupnost (WCAG 2.1 AA)** (ADR-175): kontrola 80 obrazovek nástrojem axe na mobilu i počítači, ve světlém i tmavém režimu – opraveno vše nalezené. Tlumený text má dostatečný kontrast (dříve 2,6 : 1), výběrové filtry v lištách mají přístupný název (i budoucí – automaticky z první volby), posuvné tabulky jdou ovládat klávesnicí, graf vazeb a ukazatel stavu aktiva mají správné role, aktivní podsekce a odkazy čitelné i v tmavém režimu.
- **Mobil**: ověřeno, že žádná z kontrolovaných obrazovek na šířce telefonu (390 px) nevytváří vodorovný posun stránky; tabulky se posouvají uvnitř karty.
- Nový test hlídá obojí (posun stránky na mobilu a ovládací prvky bez názvu) na hlavních obrazovkách.

## 1.81.0

- **Ukázková data z Administrace** (ADR-174): v Administrace → Společnosti tlačítko *Založit ukázku* (fiktivní „Vzorová strojírna a.s. (ukázka)“ přes stejná API jako z aplikace) a *Odstranit ukázku* – smaže ukázkovou společnost se všemi jejími záznamy, ostatní společnosti se nedotkne. Odstranit lze jen společnost označenou jako ukázka.
- **Bohatší ukázka**: aktiva, dodavatelé a dokumenty mají odpovědné útvary, štítky a umístění – přehled útvaru, filtry a vazby jsou při předvádění hned vidět.

## 1.80.0

- **Odpovědný útvar dodavatele a dokumentu** (ADR-173): u dodavatele útvar, který vztah řídí; u dokumentu útvar, kterému patří (nový dokument bez volby převezme útvar gestora, stávající dokumenty se doplnily stejně). Útvar se vybírá ze struktury organizace a musí patřit do stejné společnosti.
- **Filtry a přehled útvaru**: seznamy dodavatelů a dokumentů se filtrují podle útvaru včetně podřízených; přehled útvaru v Organizaci ukazuje i počet aktivních dodavatelů a platných dokumentů s odkazem do filtrovaného seznamu.
- Útvar dodavatele lze nastavit i hromadně v seznamu a importem (sloupec *Útvar*).

## 1.79.0

- **Hromadné úpravy procesů a dodavatelů** (ADR-172): v seznamu procesů (zobrazení Seznam) zaškrtnout procesy a najednou nastavit vlastníka (funkční místo), útvar, kritičnost, typ procesu nebo přidat / odebrat štítky; u dodavatelů významnost, data mimo ČR, stav spolupráce, interval a datum posledního přezkumu a štítky. Stav procesu se dál mění jen schválením verze.
- **Úkoly**: hromadná lišta nově nastaví i prioritu a odpovědnou osobu (aktivní uživatel).

## 1.78.0

- **Import útvarů a štítků** (ADR-171): import aktiv rozpozná sloupec *Útvar* / *Odpovědný útvar* a přiřadí útvar ze struktury organizace (podle názvu nebo kódu, bez ohledu na diakritiku a velikost písmen); neznámý útvar se založí jednou a náhled na to upozorní. Dosavadní textový sloupec je nově *Správce (text)*, staré šablony se dál načtou.
- **Štítky v importu rizik, procesů, opatření a dodavatelů**: sloupec *Štítky* (oddělené čárkou) se zapíše do společného katalogu; při opakovaném importu vyplněný sloupec štítky záznamu nahradí.

## 1.77.0

- **Přihlášení v duchu loga** (ADR-170): logo nad kartou na střed, karta s tmavým zaobleným rámečkem jako značka „cx“, inkoustové tlačítko a zaměření polí bez ohledu na barevný motiv, jemný vodoznak značky; totéž u ověření MFA a změny hesla, světlý i tmavý režim a mobil.

## 1.76.0

- **Útvar jako centrum** (ADR-169): u útvaru v Organizaci počty aktiv, procesů, otevřených rizik, opatření a úkolů (s počtem po termínu) včetně podřízených útvarů – odkazy do seznamů filtrovaných podle útvaru; filtr *Útvar* v seznamech procesů, rizik a opatření.
- **Volné texty na výběry**: tým hodnoticího cyklu z funkčních míst (a nově vidět v detailu), dodavatel AI systému z evidence dodavatelů (doplní i vazbu), systémy kroku procesu nabízejí aktiva, umístění aktiva nabízí dosavadní lokality a místa z map.
- **Rychlé založení z výběru**: chybějící útvar, dodavatele nebo aktivum založíte přímo z rozbalovacího seznamu (napsat název → *Založit*).
- **Kontrola dat po aktualizaci**: v Kvalitě dat aktiva s útvarem jen jako text (hromadné přiřazení útvaru) a se štítky mimo katalog (sjednocení jedním tlačítkem); souhrn i v kontrole po aktualizaci serveru.

## 1.75.0

- **Vazby u všech hlavních evidencí** (ADR-168): detail procesu ukazuje podprocesy a smlouvy dodavatelů, které funkci pokrývají; riziko zranitelnosti produktů (CRA), útočné cesty a scénář, ze kterého vzniklo; opatření úkoly ze změn předpisů a automatické testy; dodavatel umístění dat a projekty i podle nákladů.
- **Hlídání vazeb testem**: každá tabulka s vazbou na aktivum, proces, riziko, opatření nebo dodavatele má určené místo zobrazení – nová vazba bez zobrazení neprojde testy.
- **Hromadné úpravy v seznamech** aktiv, rizik a opatření: zaškrtnout záznamy a najednou nastavit útvar, vlastníka, garanta, kritičnost, životní cyklus, prostředí, stav opatření nebo přidat / odebrat štítky; záznamy z jiné společnosti nebo bez oprávnění se přeskočí s důvodem, každá změna jde do auditu.

## 1.74.0

- **Kontrola vazeb** (ADR-167): **odpovědný útvar aktiva** se vybírá z organizační struktury (dřívější text se přiřadí, pokud název útvaru jednoznačně sedí), seznam aktiv se filtruje podle útvaru včetně podřízených a v Organizaci je u útvaru odkaz na jeho aktiva.
- **Štítky aktiv ze společného katalogu**: výběr ve formuláři (existující nebo nový), úprava přímo v detailu, štítky v seznamu aktiv s filtrem; nové štítky z formuláře i importu se objeví na stránce Štítky, různé pravopisy se sjednotí.
- **Výběry s vyhledáváním** ve všech formulářích s vazbami: útvary (strom s cestou), funkční místa (podle útvarů, s držiteli), osoby, opatření, rizika, procesy, dodavatelé a aktiva (rozbalení bez psaní, skupiny podle typu, hostname / IP); ovládání klávesnicí.
- **Detail aktiva** ukazuje i certifikáty (TLS), oprávnění ze žádostí o přístup a otevřené návrhy rizik ze scénářů.

## 1.73.0

- **Průvodce prvním nastavením** (ADR-166): na nové instalaci ho Přehled nabídne správci – pět kroků s ukazatelem postupu: organizace (název, IČO a sídlo z ARES), klíčoví uživatelé s rolí (SSO / AD bez hesla, jinak dočasné heslo), organizační struktura s vedoucími funkcemi, síťové rozsahy a první import aktiv ze šablony. Kroky lze přeskočit, stav se počítá z dat; kontrolní seznam a předávací protokol zůstávají.

## 1.72.0

- **Výkon při velkém objemu** (ADR-165): vypnutý JIT v PostgreSQL (přehledy s mnoha poddotazy byly kvůli překladu pomalé) – při 20 000 aktivech a 160 000 zranitelnostech průvodci 3× rychlejší, průvodce rizik 7×, eskalace 10×; seznam nálezů se načítá po 300 podle priority (*Zobrazit další*); zátěžový test s větším objemem.
- **Ověřený test obnovy**: služba záloh jednou týdně (`BACKUP_RESTORE_TEST`) obnoví čerstvou zálohu do dočasné databáze a ověří obsah (klíčové evidence nejsou prázdné, migrace sedí); doba a počty jdou do záznamu – doklad v Administrace → Provoz.
- **Bezpečnostní průchod**: omezení velikosti požadavku na API, esbuild na opravenou verzi (audit závislostí bez nálezů), test oprávnění rout přidaných ve verzích 1.65–1.71.

## 1.71.0

- **Úkoly z plánu oprav** (ADR-164): u kroku plánu tlačítko *Založit úkol* (nebo *Úkoly ze všech kroků*) – jeden úkol za krok se seznamem nálezů, řešitel = garant aktiva, termín podle náročnosti, priorita podle nejzávažnějšího nálezu. Karta ukazuje **plnění** (splněné kroky, vyřešené nálezy).
- **Lhůty a eskalace nálezů**: nález testu nebo serveru bez úkolu má lhůtu podle závažnosti od zjištění; nález po termínu déle než týden **eskaluje na vedoucího garanta** (každý další týden o úroveň výš) – karta *Eskalováno na vás* na stránce Nálezy a oddíl v pondělním souhrnu. Sloupec **Eskalováno** v nápravě nálezů, ve Zprávě pro vedení a nový trend.
- **Kvalita dat průběžně**: skóre a počet slabin v měsíčních **trendech** a vývoj na stránce Kvalita dat; v pondělním souhrnu každý dostane **své chybějící údaje** (aktiva bez hodnocení CIA, aktiva s nálezy bez technického garanta, jeho úkoly bez řešitele).

## 1.70.0

- **Kvalita dat** (nová stránka v menu Řízení, ADR-163): souhrnné kontroly slabin v evidenci – aktiva bez vlastníka, aktiva s nálezy bez technického garanta, primární aktiva bez CIA, rizika bez vlastníka / hodnocení, opatření bez odpovědné funkce / testu, procesy bez vlastníka, nálezy a servery bez aktiva, úkoly bez řešitele, významní dodavatelé bez smlouvy; **hromadné nastavení** osoby nebo funkčního místa vybraným položkám (s auditem).
- **Priorita oprav nálezů**: seznam Nálezy seřazený podle priority (závažnost, internet, kritičnost aktiva, po termínu); karta **Plán oprav** – lokální AI seskupí nálezy podle společné opravy a navrhne pořadí kroků (bez názvů serverů, aktiv a IP adres; jen doporučení).
- **Kontrola před vydáním**: aktualizace závislostí s bezpečnostními opravami (Hono 4.13.17, fast-xml-parser 5.12); z kódu, testů a dokumentace odstraněny interní adresy a názvy serverů (příklady z 192.0.2.0/24); výkonnostní test rozšířen o nálezy, nápravu, zprávu pro vedení a kvalitu dat; AGENTS.md doplněn o pravidla nálezů a kvality dat.

## 1.69.0

- **Náprava nálezů** (ADR-162): po zdrojích (testy, servery, zranitelnosti, audity) a závažnosti otevřené nálezy, po termínu, opravené za období, **průměrná doba opravy** a **podíl oprav v termínu** – karta na stránce Nálezy, oddíl a ukazatel ve **Zprávě pro vedení** (tisk i Word) a nové **trendy** (kritické a vysoké nálezy, opravy v termínu, doba opravy).
- **Moje nálezy a můj tým**: filtr odpovědnosti na stránce Nálezy – nálezy na aktivech, kde je uživatel garant / zástupce / vlastník, s jeho úkolem nebo funkcí; tým = podřízené útvary, které vede.
- **Týdenní souhrn garantům aktiv**: v pondělí e-mail *Nálezy na vašich aktivech* (počty podle aktiv, úkoly po termínu, odkaz na moje nálezy).
- **Přesun rozsahu bezpečnostních testů** do jiné společnosti skupiny včetně plánů pravidelných testů (schválení se ruší – pověření platí pro zdrojovou společnost).
- **Logo ve výstupech**: tiskové výstupy a Word bez vlastního vzhledu společnosti mají v záhlaví malé logo CONTIX; ikony pro mobil a připnutí na plochu (manifest).
- Oprava: seznam neevidovaných zařízení se po rychlém skenu segmentu nenačetl znovu.

## 1.68.0

- **Logo CONTIX v brandu DynamicData** (ADR-161): zaoblený rámeček a geometrické písmo z loga DynamicData, značka „cx“ a slovní značka *contix* dvoubarevně (con / tix jako dynamic / data). V menu, mobilní liště, na přihlášení a jako ikona prohlížeče; světlý i tmavý panel a tmavý režim. Zdrojové SVG v `docs/brand/`.
- **Nové uspořádání menu** podle práce s GRC: nahoře Přehled, Moje práce, Akce a úkoly a Zeptat se AI; skupiny *Řízení* (ISMS, cesta k souladu, zpráva pro vedení, skupina, projekty), *Evidence* (organizace, procesy, aktiva, mapy, dodavatelé, štítky), *Rizika a nálezy* (rizika, nálezy, zranitelnosti, bezpečnostní testy, výjimky), *Shoda a audit*, *Bezpečnostní provoz* (incidenty, SOC, identity, přístupy, discovery, kontinuita), *Regulace* (informační servis NÚKIB, legislativa, GDPR, AI Act, CRA), *Dokumentace* a *Nástroje a správa*.

## 1.67.1

- **Vzhled výstupů**: tlačítko Uložit počká na načtení vybraného loga – na pomalejším počítači se jinak uložilo bez loga (oprava i stabilita e2e testu v CI).

## 1.67.0

- **Nálezy jako důkaz účinnosti opatření** (ADR-160): otevřený kritický nález testu nebo zásadní zjištění auditu navázané na opatření = opatření se nezapočítá do návrhu zbytkového rizika, plán zvládání navrhne obnovit účinnost a pokrytí předpisu ukáže mezeru *Závažný nález k opatření*; vysoký nález nebo menší zjištění = nejvýš částečně účinné. Počet nálezů v seznamu opatření a u účinnosti v detailu.
- **CVE z bezpečnostních testů ve Zranitelnostech**: nález testu s CVE na aktivu se zrcadlí jako zranitelnost aktiva (zdroj *sectest*) se stavem nálezu; stejná CVE z jiného zdroje = automatická duplicita (a zpět na otevřenou, když se původní záznam vyřeší). Lhůty oprav, P1/KEV a semafor tak platí i pro CVE z testů.
- **Test TLS → inventář certifikátů**: testované TLS cíle se zapíší do kontroly certifikátů (s aktivem), takže se platnost hlídá průběžně.
- **Detail serveru ze sběrače**: stav nálezů (úkol, přijaté riziko, ověřená oprava); filtr nálezů podle serveru.

## 1.66.0

- **Nálezy v celém ekosystému** (ADR-159): rychlé hledání (Ctrl+K) najde nález testu podle názvu / IP a server ze sběrače podle hostname; nové nástroje pro dotazy v přirozeném jazyce a MCP *Nálezy bezpečnostních testů* a *Nálezy konfigurace serverů*; nálezy testů ve vektorovém indexu (hledání podle významu).
- **Trendy**: kritické a vysoké nálezy testů, vysoké nálezy serverů, úkoly z nálezů po termínu; výjimky v trendu zahrnují i přijaté nálezy testů, serverů a potlačení SOC.
- **Postup krok za krokem**: nový průvodce *Bezpečnostní testy* (schválený rozsah, testy za 90 dní, pravidelné testy, garanti aktiv s nálezy, úkoly k závažným nálezům, lhůty) a krok *Nálezy konfigurace serverů* u aktiv.
- **Balíček pro auditora** obsahuje zprávu z bezpečnostních testů (HTML a Word) za období balíčku.

## 1.65.0

- **Jednotný přehled nálezů** (stránka *Nálezy*, ADR-158): bezpečnostní testy, konfigurace serverů ze sběrače, zranitelnosti a zjištění auditů na jedné stupnici závažnosti a stavů, s odpovědnou osobou, úkolem, termínem a přijatým rizikem; filtry podle zdroje, stavu a závažnosti, souhrn otevřených nálezů. Na detailu aktiva záložka **Nálezy a úkoly**.
- **Nálezy serveru s životním cyklem** (migrace 0120): nález ze sběrače se ukládá, chybí-li v dalším hlášení, je opravený a jeho úkol se uzavře; znovu nalezený se otevře. Vysoké nálezy dostanou úkol technickému garantovi automaticky, ostatní ručně (i hromadně). Přijetí rizika se zdůvodněním a platností → Výjimky; falešný nález.
- **Semafor aktiva** zahrnuje otevřené nálezy testů (kritický = červená, vysoký = oranžová) a vysoké nálezy serveru; nové nálezy serveru na aktivech rizika jsou podnětem k přehodnocení rizika.
- **Předání odpovědností uživatele**: v kartě uživatele (Administrace → Uživatelé) přehled aktiv (business vlastník, garant, zástupce), úkolů a funkčních míst; při deaktivaci upozornění a předání jiné osobě – úkoly z nálezů se přepočítají.
- **Přesun aktiva do jiné společnosti** přesune i nálezy testů, inventáře a nálezy serveru a jejich úkoly.
- **Ohlášení NÚKIB**: režim vždy z regulatorního profilu společnosti s upozorněním na nesoulad s posledním posouzením; odpovědné funkční místo je v evidenci funkčních míst (lze předat).

## 1.64.0

- **Přijaté nálezy bezpečnostních testů ve Výjimkách a přijatých rizicích**: přijetí rizika u nálezu vyžaduje zdůvodnění a volitelně platnost; ukládá se kdo a kdy přijal (migrace 0119). Nález je ve Výjimkách (filtr, stav platnosti, kompenzační opatření, upozornění před vypršením) a po termínu ho další test znovu otevře. Úkol na odstranění se při přijetí zruší.

## 1.63.0

- **Zpráva z bezpečnostních testů** (PDF / Word, s logem společnosti): shrnutí, rozsah a podklad testů, přehled a popis nálezů s doporučením, stav nápravy (úkoly, odpovědné osoby) a ověřené opravy – za sadu nebo za období.
- **Ověření opravy opakovaným testem**: splněný úkol k nálezu zařadí opakovaný test sondou na cíl a port nálezu; nález zmizí → úkol splněn a nález opraven, nález trvá → úkol zpět odpovědné osobě s poznámkou.
- **Pravidelné testy**: plán sady (denně, týdně, 2 týdny, měsíčně, čtvrtletně), spuštění plánovačem i ručně, u sady nové a opravené nálezy proti minulému stavu, úkoly k novým nálezům automaticky.
- **Ohlášení regulované služby NÚKIB** (§ 6 zákona): údaje k ohlášení, podklad PDF / Word, záznam podaného ohlášení, změny k ohlášení (údaje, služby, režim) se lhůtou 30 dní a povinnost v Moje práce (ohlášení do 60 dní od posouzení).
- **Nálezy testů v rizicích a shodě**: vazba nálezu na opatření (ručně nebo z AI rozboru), nálezy na detailu opatření; nové závažné nálezy na aktivech nebo opatřeních rizika jsou podnětem k přehodnocení rizika (zranitelnost).

## 1.62.0

- **Úkoly z nálezů Kali na odpovědné osoby**: úkol dostane přímo technický garant aktiva (jinak business vlastník) jako osoba – i bez funkčního místa (nový sloupec `tasks.assignee_user_id`); zástupce garanta úkol vidí a může ho plnit; funkční místo osoby (nebo vlastníka) zůstává kvůli eskalaci. Nález ukazuje garanta, zástupce a business vlastníka z karty aktiva; po změně odpovědných osob nebo přiřazení nálezu k aktivu se otevřené úkoly přesunou; opakované „Založit úkoly“ doplní osobu i ke starším úkolům. Automatické úkoly v sadě testů jsou zapnuté ve výchozím stavu.
- **Formuláře**: jednotný vzhled výběrů (stejná výška jako pole i v Safari, vlastní šipka, zkrácení dlouhých voleb), popisky polí na jednom řádku (pole v řádku lícují), oddíly ve formuláři aktiva (Odpovědnost, Klasifikace, Provoz a označení), kritičnost a CIA v jednom řádku.

## 1.61.0

- **Určení regulace podle vyhlášky 408/2025** (ADR-156): údaje z Registru ekonomických subjektů ČSÚ přes ARES (činnosti CZ-NACE, institucionální sektor, kategorie zaměstnanců), návrh služeb z přílohy vyhlášky, velikost podniku podle doporučení 2003/361/ES (zaměstnanci, obrat, bilanční suma, kurz ČNB), potvrzení podmínek významnosti u všech 102 služeb a výpočet režimu (vyšší / nižší / neregulovaná, přednost vyšších povinností). Historie posouzení se snímkem RES; u vlastní společnosti volitelný zápis režimu a seznamu služeb do regulatorního profilu, u dodavatele zjištění, zda je sám regulovaný.

## 1.60.0

- **Rozšířené testy pro Kali Linux** (ADR-153, ADR-155): UDP služby (SNMP, TFTP, IPMI, SSDP, Memcached), citlivé soubory na webu (/.git, /.env, zálohy, phpinfo, server-status, Spring Actuator, administrace – jen GET), RDP a NLA, anonymní FTP, poštovní server (open relay, STARTTLS), databáze bez hesla (MySQL / MariaDB, MS SQL, MongoDB, Redis, Elasticsearch), SNMP s komunitou public, NFS exporty, VNC bez hesla, přenos DNS zóny (AXFR). Nové předvolby *Služby a databáze* a *Kompletní server*; navazující testy podle nalezených služeb. Sonda 1.1 (nový instalátor) – UDP sken jen se schopností CAP_NET_RAW, bez roota.
- **Úrovně vlastnictví aktiv**: business vlastník, **technický garant** a jeho **zástupce**; garant a zástupce upravují aktivum jako vlastník, opravy zranitelností jdou garantovi (jinak vlastníkovi). Sloupec v importu, filtr aktiv podle odpovědné osoby.
- **Úkoly na odstranění nálezů z Kali**: jednotlivě, hromadně nebo automaticky po sadě testů – na funkci technického garanta (zástupce, business vlastníka), termín podle závažnosti (7 / 14 / 30 / 90 dní). Opakovaný test, který nález nenajde, úkol sám uzavře; přijetí / falešně pozitivní úkol zruší. Odkaz z úkolu na nález.
- **Zjištění z auditu k aktivu** – bez odpovědné funkce připadne business vlastníkovi aktiva (jinak vlastníkovi opatření).
- **Eskalace v hierarchii**: povinnost 7 dní po termínu vidí vedoucí útvaru, každý další týden vedoucí o úroveň výš (fronta Moje práce i e-mail, štítek s úrovní a počtem dní). Počítá se z organizační struktury.

## 1.59.0

- **Logo a vzhled výstupů** (ADR-154, Administrace → Společnosti → Vzhled výstupů): logo, barva nadpisů a čar, text zápatí a název v záhlaví; náhled stránky; dceřiná společnost dědí od nadřazené. Platí pro všechny tiskové výstupy / PDF i Word (zpráva pro vedení, SoA, zprávy o rizicích, plán zvládání, přezkoumání ISMS, hlášení incidentů, oznámení dodavatelům a další).
- **Word – zpráva pro vedení**: souhrn stavů jako jednoduchá podbarvená tabulka (dřív rozpadlá), podbarvení řádků ukazatelů, vývoj ukazatelů jako kompaktní tabulka s malým grafem, hodnotou na začátku a teď, změnou a rozsahem (místo grafu přes celou šířku na každý ukazatel).
- Převod do Wordu umí podbarvení buněk a řádků; záhlaví tabulek v barvě společnosti.

## 1.58.1

- **Jednotný a lehčí vzhled stavu**: místo těžkých semaforů jemná barevná tečka a podbarvený štítek – stejně na Přehledu i ve Zprávě pro vedení (komponenta `StatusDot` / `StatusPill`).
- Zpráva pro vedení: ukazatele rozdělené na *Vyžaduje pozornost* (plně) a *V pořádku* (kompaktně, ztlumeně ve dvou sloupcích); souhrn tří stavů jako jemně podbarvené dlaždice; tisk a Word stejně (řádky v pořádku bez podbarvení a šedě).
- Nuly ztlumeně i na kartách Přehledu.
- Ukazatel *Aktiva v červeném stavu*: v podrobnostech i počet červených, celkem a hranice (pozor od 1, rozhodnutí od 5).

## 1.58.0

- **Zpráva pro vedení – semafory**: v záhlaví semafor celkového stavu, skóre a tři „světla“ s počty (vyžaduje rozhodnutí / pozor / v pořádku); karty k rozhodnutí s barevným okrajem a štítkem; **všechny ukazatele jako jedna přehledná tabulka se semaforem**, seřazená od nejhoršího (místo opakovaných karet); shoda s rámci s pruhem splněno / částečně / nesplněno / neposouzeno.
- Tisk / PDF a Word: souhrn tří světel, ukazatele od nejhoršího s podbarvením řádku a semaforem.
- Nový ukazatel **Kritické a vysoké nálezy bezpečnostních testů** (kritický nález = vyžaduje rozhodnutí, vysoký / střední = pozor; testy a opravy v období).

## 1.57.0

- **Přehled**: oblasti rozdělené na *Technická bezpečnost* a *Řízení a shoda* s počtem oblastí, které vyžadují pozornost; nevyplněné oblasti v jedné kompaktní kartě s odkazy.
- Nové karty **Bezpečnostní testy** (otevřené nálezy podle závažnosti, testy za 30 dní, opravené nálezy, sondy online) a **Servery ze sběrače** (servery s nálezy, čekající bezpečnostní aktualizace, servery, které se nehlásí).
- Vzhled karet: barevný proužek a štítek stavu, ikona v barvě stavu, zvýrazněné problémové hodnoty; míra shody jako prstenec s rozpadem splněno / částečně / nesplněno / neposouzeno. Stav „Po termínu“ přejmenován na „Vyžaduje řešení“.
- **Bezpečnostní testy**: dlaždice nahoře (nálezy podle závažnosti, testy za 30 dní, sondy); API `GET /api/security-tests/summary`.

## 1.56.1

- **Víc testů najednou** (sady): výběr testů nebo předvolba (Linux server, Webová aplikace, Windows a řadič domény, Průzkum sítě), cíle i z aktiv (IP adresy aktiva); webové testy si z IP / názvu udělají https://…; stránka sady s průběhem, nálezy a shrnutím.
- **Navazující testy**: po průzkumu portů sonda sama spustí SSH audit, TLS, hlavičky webu, SMB, anonymní sdílení a LDAP podle nalezených služeb – jen v rozsahu a bez duplicit.
- **Automatická AI** (volitelná u sady): po každém testu rozbor závažných nálezů (až 10), shrnutí testu; po dokončení sady shrnutí celé sady s doporučenými testy a tlačítkem **Spustit navržené testy** (i u rozboru nálezu).
- **Přiřazení nálezu k aktivu** ručně (i všech nálezů stejného cíle); adresa se aktivu doplní, takže další testy se spárují samy; ruční přiřazení nepřepíše další běh.

## 1.56.0

- **Bezpečnostní testy** (ADR-153, nový modul, menu Nástroje → Bezpečnostní testy): katalog testů – otevřené porty a verze služeb (nmap), TLS (testssl.sh), SSH (ssh-audit), bezpečnostní hlavičky webu, webový server (nikto), SMB podepisování a SMBv1, anonymní sdílené složky a LDAP podepisování (netexec).
- **Rozsah testů se schválením**: cíle (IP, CIDR, servery, *.doména, URL), výjimky, platnost a podklad; testovat lze jen ve schváleném a platném rozsahu, každá změna ruší schválení. Nová oprávnění *Číst / Spouštět bezpečnostní testy* a *Schvalovat rozsah*.
- **Sonda na Kali Linuxu** (Administrace → Konektory → Sondy bezpečnostních testů): instalátor jedním souborem, služba systemd pod uživatelem bez práv roota; sonda dostává jen ID testu, cíle a porty – příkaz si sestaví z vlastního katalogu.
- **Ruční import** výstupů nástrojů (nmap XML, testssl / ssh-audit / nikto JSON, netexec), nálezy s historií (opakovaný test opravené nálezy uzavře), přijetí rizika, falešně pozitivní, nálezy u aktiva.
- **AI (lokální model)**: vysvětlení nálezu s postupem nápravy a ověřením, navazující testy, vazba na opatření organizace, shrnutí běhu pro zprávu – bez názvů a IP serverů.

## 1.55.0

- **Detail serveru ze sběrače** (ADR-152, Discovery → Servery ze sběrače → název serveru): přehled v dlaždicích a záložky Nálezy (rozklik s vysvětlením a postupem nápravy), Účty a klíče (rozklik účtu s jeho klíči a posledním přihlášením), Kontejnery a image (použité / nepoužité), Porty a služby (porty na všech rozhraních, filtr služeb), Systém a SSH, Historie změn.
- **Sběrač 1.1**: efektivní nastavení SSH serveru (`sshd -T`), čekající a bezpečnostní aktualizace (apt / dnf), automatické aktualizace, potřeba restartu, doba běhu, poslední přihlášení; nové nálezy – root přes SSH heslem, přihlášení heslem, prázdná hesla, bezpečnostní aktualizace, restart, služba s chybou.
- **Historie změn**: při každém hlášení CONTIX uloží, co se od minula změnilo (nové účty, sudo, klíče, porty, kontejnery, firewall, nastavení SSH, nové a vyřešené nálezy).

## 1.54.0

- **Instalátor sběrače** (ADR-151, Administrace → Konektory → Sběrač ze serverů → Instalátor): jeden soubor `install-contix-collect.sh` pro všechny servery připojení – nainstaluje skript, adresu, token, certifikát CA, podle potřeby záznam do `/etc/hosts` a plán spouštění, hned pošle první inventář a smaže se. `--uninstall` sběrač odebere.
- Kořenový certifikát interní CA na `/.well-known/contix-ca.pem` (režim TLS `internal`) – instalátor ho načte sám.
- Token sběrače se nově ukládá šifrovaně (kvůli instalátoru); u připojení z doby před 1.54 vygenerujte nový token.

## 1.53.0

- **NetBox** (ADR-150, Administrace → Konektory): zařízení a virtuální stroje jako aktiva (výrobce, model, sériové číslo, lokalita, IP, platforma, štítky), tenant → společnost, synchronizace podle intervalu nebo z Discovery.
- **JIRA**: u úkolu tlačítko Založit v JIRA (Cloud i Data Center); stav issue se čte zpět a „hotovo“ úkol v CONTIXu uzavře.

## 1.52.0

- **Společné štítky** (ADR-149): jeden katalog pro aktiva, rizika, dodavatele, procesy, opatření a umístění dat; štítky nad detailem záznamu a stránka Štítky se všemi označenými záznamy.
- **Umístění dat** (Dodavatelé → Umístění dat): hosting, cloud a SaaS se zemí, druhy dat, zárukou předání a smlouvou o zpracování; pravidla podle země – EU/EHP, odpovídající ochrana, USA (DPF / SCC), třetí země bez záruk, čl. 28 GDPR, země se zvýšeným rizikem, DORA.

## 1.51.0

- **Sběrač ze serverů** (ADR-148, Administrace → Konektory): skript `contix-collect.py` (Python 3, jen čte) posílá z linuxových serverů účty, otisky SSH klíčů, Docker kontejnery a image, služby, porty a stav firewallu.
- **Shoda serveru u aktiva**: další účet s UID 0, slabé a neoznačené klíče, klíče roota, privilegované kontejnery, chybějící firewall, výchozí ACCEPT a pravidla, která se po restartu ztratí.
- Přehled serverů v Discovery; návod v docs/04_operations/collector.md.

## 1.50.0

- **Smluvní požadavky zákazníka** (ADR-147): nový typ rámce v knihovně rámců se zákazníkem, službou, číslem smlouvy a platností; požadavky se mapují na opatření a ukazují pokrytí jako předpis.
- **Doklady firmy jako důkazy**: nové typy Certifikát, Zpráva z penetračního testu a Bug bounty – s platností a upozorněním před koncem.

## 1.49.0

- **Víc Wazuhů** (ADR-146, Administrace → Konektory → Přidat Wazuh): každý Wazuh manager je samostatné připojení s názvem, rozsahem (jedna společnost, nebo celá skupina s přiřazením skupin agentů ke společnostem) a vlastním nastavením alertů a Active Response.
- Stejné ID agenta ve dvou Wazuzích už nekoliduje – aktivum si pamatuje připojení; párování s existujícími aktivy jen uvnitř přiřazené společnosti.
- Zranitelnosti, shoda konfigurace (SCA), alerty, hledání hrozeb, IOC a threat intel ze všech připojení; blokace IP do Wazuhu, ze kterého alert přišel.
- Discovery: synchronizace jednoho připojení nebo všech; Provoz ukazuje výsledek alertů za každé připojení.
- Stávající nastavení Wazuhu se při aktualizaci samo převede na první připojení.

## 1.48.0

- **Test obnovy v Provozu** (ADR-145): `restore.sh --test` zapíše výsledek, Administrace → Provoz upozorní, když test chybí, selhal nebo je starší než 92 dní.
- **CONTIX jako produkt (CRA)**: SBOM CONTIXu ve formátu CycloneDX 1.6 ke stažení v Provozu (i jako artefakt CI), `/.well-known/security.txt` s kontaktem pro hlášení zranitelností (`SECURITY_CONTACT`).
- **Kontrola závislostí v CI**: pipeline se zastaví při vysoké nebo kritické zranitelnosti (`bun audit`).
- **Přehled skupiny do Excelu**: ukazatele společností a Cesta k souladu po oblastech.
- **Import útvarů a funkčních míst** z Excelu / CSV: chybějící útvary se založí, držitelé podle e-mailu.
- Kontrolní seznam pilotního nasazení (docs/04_operations/pilot.md).

## 1.47.0

- **Průvodci SOC 2 a Trust Center** (ADR-144): panel „Jak postupovat“ na stránkách Zprávy SOC 2 (zakázka, popis systému, opatření ke kritériím, testy, výjimky, zpráva) a Dotazníky zákazníků / Trust Center (knihovna odpovědí, termíny, rozpracované dotazníky, zveřejnění, žádosti o přístup).
- **Koncept politiky s osnovou**: startovací balíček vytvoří verzi 0.1 s kapitolami podle hlavního předpisu společnosti (účel a rozsah, závazek vedení, cíle, role, rizika, zásady, výjimky, přezkum).
- **Export a import nastavení průvodců** (nabídka Další na Cestě k souladu): garanti podle názvu funkčního místa a profil hrozeb, pro přenos mezi instalacemi nebo pilotní zákazníky.
- Úvodní prohlídka manažera má krok Cesta k souladu; nápověda doplněna.
- Aktualizace závislostí (bezpečnostní opravy seroval, zod, nodemailer).

## 1.46.1

- Startovací balíček je dostupný vždy v nabídce **Další** na stránce Cesta k souladu (dosud jen ve fázi Základy).

## 1.46.0

- **Balíček pro auditora z Přípravy na audit** (ADR-143): ZIP se zprávou o připravenosti (HTML + Word), prohlášením o aplikovatelnosti, testy, důkazy, platnými dokumenty po oddílech předpisu a kontrolními součty.
- **Přesnější připravenost**: požadavky bez opatření a bez ručního posouzení jsou „neposouzené“, ne „nesplněné“.
- **Startovací balíček** na Cestě k souladu (fáze Základy): složky dokumentace, katalog opatření podle vyhlášky, koncept bezpečnostní politiky a vzorové cíle ISMS – jen co chybí.
- **Souhrnný e-mail**: další krok průvodce jen při změně kroku nebo počtu, jinak nejvýš jednou týdně.
- **Odkazy na předpisy u GDPR, AI Act a CRA** (např. GDPR čl. 30, AI Act čl. 4, CRA čl. 14).
- Výkon průvodců ověřen zátěžovým testem (5 000 aktiv, 40 000 zranitelností, 800 rizik): Cesta k souladu ~0,3 s, panel modulu ~0,1 s.

## 1.45.0

- **Příprava na audit** (ADR-142, Cesta k souladu → Příprava na audit): po oddílech vyhlášky 409 / 410, NIS2, ISO 27001 nebo DORA připravenost (shoda požadavků), opatření, dokumenty, mezery a kroky průvodců k dokončení; výstup do Wordu a k tisku.
- **Odkazy na předpis u kroků** průvodců (např. § 8, čl. 21 NIS2, A.5.9) podle hlavního rámce společnosti.
- **Doporučené pořadí zavádění** na Cestě k souladu: základy → analýza → opatření → provoz → ověření, s odkazem na Průvodce nastavením.
- **Kontrola kvality záznamů**: rizika bez úplného scénáře, neúplné plány kontinuity, dodavatelé s nedostatky § 9, dokumenty s nedostatky.
- **Průvodci Organizace a procesy a Výjimky**; přehled skupiny se počítá nejvýš jednou za 2 minuty.
- **Barva horní lišty**: volba v Můj profil → Vzhled; správce ji může nastavit celé společnosti (Administrace → Společnosti), např. pro rozlišení prostředí.

## 1.44.0

- **Garant postupu a Moje práce** (ADR-141): u každého průvodce lze určit funkční místo; jeho držitelé dostávají další krok (např. „Řízení rizik: Ochota riskovat“) do Moje práce a souhrnného e-mailu.
- **Vývoj Cesty k souladu v čase**: nový ukazatel „Cesta k souladu (%)“ v měsíčních snímcích a ve Zprávě pro vedení (graf i Word).
- **Průvodci SOC a Žádosti o přístup**: zdroje alertů, triáž do 24 h, hledání hrozeb, pokrytí detekcí; osoby, katalog oprávnění, vlastníci, business role, vyřizování žádostí, odchody, recertifikace.

## 1.43.0

- **Další průvodci „Jak postupovat“** (ADR-140): Aktiva, Zranitelnosti, Politiky a dokumentace, Povědomí a školení, Identity a přístupy, Významné změny a DORA (jen u finančního subjektu).
- **Přesnější kroky**: zvládání jen u rizik nad akceptovatelnou úrovní, přehodnocení rizik podle intervalu politiky, přezkum dokumentů, dodavatelů, záznamů o zpracování a testy plánů podle jejich vlastních intervalů, zmeškané lhůty hlášení incidentů, osoby po termínu školení, chybějící seznámení s dokumenty, zranitelnosti po lhůtě oprav.
- **Cesta k souladu za skupinu**: tabulka postupu každé společnosti po oblastech s přepnutím na společnost.

## 1.42.0

- **Postup krok za krokem v modulech** (ADR-139): panel „Jak postupovat“ na stránce Řízení ISMS, Rizik, Opatření, Auditů, Kontinuity (BIA), Incidentů, Dodavatelů, GDPR, AI Act, CRA a Legislativy – kroky v doporučeném pořadí, stav z dat (např. „2 rizika bez vlastníka“, „1 významný dodavatel bez smlouvy“) a tlačítko „Další krok“.
- **Cesta k souladu** (nová položka menu): stav všech oblastí na jednom místě – procento hotových kroků, další krok a co zbývá vyřídit.

## 1.41.0

- **Modelování hrozeb – postup krok za krokem** (ADR-138): panel „Jak postupovat“ s pěti kroky (odvětví → připravenost dat → útočné cesty → kalibrace → threat modely), stavem, počty k vyřízení a tlačítkem „Další krok“.
- **Připravenost dat**: co chybí pro přesné výsledky (korunní klenoty, aktiva z internetu, vazby, segmenty, zranitelnosti, identity, EDR, BIA, testovaná opatření) s odkazem, kde to doplnit.
- **Nápověda „Jak na to“** v každé záložce (lze skrýt) a vysvětlení pojmů.
- **Fronta rozhodnutí**: útočné cesty a odchylky kalibrace seřazené podle priority se značkou „Začněte tímto“, filtr k rozhodnutí / rozhodnuté a počty v záložkách.

## 1.40.0

- **Modelování hrozeb podle reality prostředí** (ADR-137, Rizika → Modelování hrozeb).
- **Útočné cesty**: z vazeb aktiv, segmentů, zranitelností KEV, EDR a identit nejschůdnější cesta z internetu nebo z phishingu ke korunním klenotům, kroky ATT&CK se zdůvodněním, úzká hrdla s doporučením, riziko z cesty jedním klikem.
- **Kalibrace z dat**: návrh dopadu a pravděpodobnosti rizik z BIA (MTPD), osobních údajů, incidentů, alertů, expozice a doložené účinnosti opatření; odchylky zvýrazněné, použití se zdůvodněním v historii.
- **Hrozby pro odvětví**: aktéři (ransomware, státní skupiny, hacktivisté) podle odvětví, zmínek NÚKIB / CERT, MISP a technik v SOC; posun úrovně hrozby scénářů z dat.
- **Threat model STRIDE**: průvodce pro aplikaci, aktivum, proces nebo projekt (předvyplnění z grafu aktiv) – prvky a toky se zónami důvěry, hrozby STRIDE, bezpečnostní požadavky, rizika a zpráva ve Wordu.

## 1.39.0

- **Volitelný formát grafů** (ADR-136): u karet Vývoj ukazatelů typ čára / plocha / sloupce / tabulka, období 6 / 12 / 24 měsíců, měřítko hodnoty nebo změna od začátku, výběr a pořadí ukazatelů – pamatuje si prohlížeč.
- **Export grafu** jako PNG, SVG (do prezentací) nebo CSV (Excel).
- **Grafy ve zprávě pro vedení** podle nastavení karty: v tisku vektorový graf, ve Wordu obrázek grafu u každého ukazatele s rozpětím min–max.

## 1.38.0

- **Klíčové údaje pod nadpisem** detailu rizika, aktiva, incidentu a projektu (vlastník, stav, termíny, kritičnost, rozpočet) – ADR-135.
- **Řídicí panel ve zprávě pro vedení**: celkový stav 0–100, souhrnná věta, karty „K rozhodnutí“ a schválení čekající na vás s akcemi v řádku.
- Oprava: pevné záhlaví detailu rizika a opatření se schovávalo pod horní lištu.

## 1.37.0

- **Moje práce jako fronta** (ADR-134): položky podle naléhavosti (po termínu → dnes → brzy), filtry s počty, schválení / zamítnutí žádosti o přístup a změny projektu a „Hotovo“ u úkolů přímo v řádku, ovládání klávesnicí (J / K, Enter, A).
- **Přehled – „Dnes pro vás“**: pět nejnaléhavějších osobních položek s akcemi nahoře na úvodní stránce.

## 1.36.0

- **Nový vzhled – kostra** (ADR-133): horní lišta s výběrem společnosti, hledáním (Ctrl K), počtem úkolů a nabídkou uživatele; o pruh méně nad obsahem.
- **Oblíbené** v menu (hvězdička u položky) a počet žádostí ke schválení u Žádostí o přístup.
- **Záhlaví stránek**: jedna hlavní akce, ostatní v nabídce „Další“; části modulu jako řádek odkazů (Rizika: registr, roční hodnocení, scénáře, ochota riskovat, kvantitativně, plán zvládání, katalog).
- Záložky se nezalamují, kompaktní drobečková navigace, ukazatele bez šumu „první měsíc“.

## 1.35.0

- **Projekty – portfolio** (ADR-132): karty projektů se semaforem stavu, postupem bran, úkoly, riziky, dalším milníkem a čerpáním; ukazatele (kritický stav, po termínu, překročený rozpočet, brány a změny ke schválení) a filtry.
- **Detail projektu v záložkách** s přehledem (stav, ukazatele, tým, co vyžaduje pozornost).
- **Tým a úkoly**: tým s RACI, tabule úkolů (K řešení / Probíhá / Blokováno / Hotovo) s přetahováním; řešitel vidí úkol v Moje práce a mění jeho stav.
- **Milníky** v harmonogramu, **rizika a problémy** projektu s mapou rizik.
- **Hlášení stavu (RAG)** předvyplněné návrhem z dat; **žádosti o změnu** termínu / rozpočtu / rozsahu se schválením sponzorem a automatickou úpravou projektu.
- **Stavová a závěrečná zpráva** do Wordu / k tisku (cs, en) a **poučení** (lessons learned).

## 1.34.0

- **Přehledné IDM** (ADR-131): nová záložka **Přehled** v Žádostech o přístup – co čeká na mě, tok žádostí (schválení → zápis do AD → vyřízeno) a rizika (členství bez schválení, odešlí v AD, SoD, recertifikace po termínu, chybějící přidělení z rolí, konce platnosti), vše proklikatelné.
- **Business role**: balíček oprávnění přiřazený podle útvaru a funkce z personalistiky; chybějící přidělení jedním kliknutím jako žádosti.
- **Matice osoby × oprávnění** s barevnými stavy (přiděleno, chybí v AD, v AD bez schválení, žádost běží, role očekává) a akcemi z buňky.
- **Detail osoby 360°**: role, oprávnění s důvodem a stavem v AD, účet a skupiny v AD, žádosti, podřízení, historie; rychlé odebrání a prodloužení.
- **Průvodce nástup / přesun / odchod**: návrh z rolí, při přesunu odebrání oprávnění ze starých rolí, odchod k datu.
- **Toxické kombinace (SoD) už při žádosti**: varování žadateli i schvalovatelům, žádost s konfliktem vždy schvaluje správce se zdůvodněním.

## 1.33.0

- **Skupiny z AD do katalogu oprávnění** (ADR-130): synchronizace zdroje identit nově načítá skupiny AD (DN, popis, privilegovaná / chráněná, počet členů); v katalogu výběr podle OU, hromadné založení oprávnění a volitelně převzetí stávajících členů.
- **Nové skupiny v AD**: oprávnění „skupina ještě neexistuje“ s názvem a OU ze seznamu; CONTIX ji vytvoří skriptem (`New-ADGroup`) nebo zápisem před přidáním členů.
- Snazší a bezpečnější nastavení zápisu do AD: povolená OU výběrem ze seznamu OU, odmítnutí neúplného DN a vestavěného účtu správce; při psaní DN skupiny se nabízejí skupiny z AD.

## 1.32.0

- **Projekty – harmonogram** (ADR-129): plánovaný začátek a konec fází, Gantt fází se značkou schválení brány a čarou dneška; společný harmonogram všech projektů v přehledu.
- **Rozpočet a náklady**: rozpočet v Kč, náklady s fází a dodavatelem (dobropis zápornou částkou), čerpání s varováním od 90 % a překročením nad 100 %.
- **Vlastní šablony** organizace (fáze a požadované dokumenty, kopie vestavěné šablony, vyřazení místo smazání).
- **Vazby projektu** na aktiva, rizika, dodavatele a procesy; projekt se zobrazí ve zpětných vazbách těchto záznamů.

## 1.31.0

- **Projekty** (nový modul, ADR-128): projekt ze šablony (IT projekt, bezpečnostní projekt, pořízení) s fázemi a branami; v každé fázi požadované dokumenty včetně bezpečnostních požadavků (security by design, § 13 vyhl. 409/2025).
- Dokumenty: nahrání souboru nebo odkaz = předložení; schvaluje jiný uživatel než předkladatel, vrácení i „netýká se“ s důvodem.
- Brány: schvaluje sponzor (stačí čtení projektů), jen bez chybějících povinných dokumentů; další fáze začne automaticky; Moje práce (sponzor – brána ke schválení, manažer – termín fáze); úkoly navázané na projekt.
- Oprávnění `projects:read` / `projects:write` doplněna systémovým rolím.

## 1.30.0

- **CRA – dokumenty výrobce** (ADR-127): EU prohlášení o shodě (příloha V), zjednodušené prohlášení (příloha VI), informace a pokyny pro uživatele – bezpečnostní informace o produktu (příloha II) a přehled technické dokumentace (příloha VII s plněním požadavků přílohy I); česky i anglicky, tisk do PDF nebo Word, chybějící povinné údaje zvýrazněné jako koncept.
- Údaje pro dokumenty u produktu (adresa výrobce, identifikace, podepisující osoba, pokyny pro instalaci, aktualizace a vyřazení, adresa prohlášení, SBOM…).

## 1.29.0

- **Nastavení skupin v AD** (Žádosti o přístup, ADR-126): režimy vypnuto / jen skript PowerShell / přímo v AD odděleným zapisovacím účtem; náhled změn s kontrolou (povolená OU, nikdy privilegované skupiny podle názvu, SID a adminCount, účet osoby), zápis jen po výběru a potvrzení, denní limit, záznam každého zápisu.
- Ověření podle AD: schválené žádosti, které už v AD platí, se po synchronizaci zdroje identit vyřídí samy (i pro režim skript).
- Návod k instalaci 8c: zapisovací účet s delegací jen „Write Members“ na OU.

## 1.28.0

- **Soulad s AD** (Žádosti o přístup, ADR-125): členství ve skupinách AD / Entra ID z posledního načtení zdroje identit porovnané s evidovanými přiděleními – člen bez schválení, odešlá osoba ve skupině, účet bez osoby, přidělení chybějící ve skupině, osoba bez účtu. Převzetí stávajícího členství do evidence a žádost o odebrání; do AD se nezapisuje.
- Menu: na stránce Mapy a půdorysy už není zvýrazněná i položka Aktiva.

## 1.27.0

- **Automatický import osob z personalistiky** (PERM a jiné, ADR-124): export CSV / XLSX v adresáři `import/` na serveru se načte při změně; volitelně se chybějící osoby označí jako odešlé (s pojistkou proti neúplnému exportu). Nová kapitola 8b návodu k instalaci; `docker-compose.yml` připojuje `./import` do API jen pro čtení.
- Import pozná záhlaví pod titulkem sestavy, celé jméno v jednom sloupci (tituly vynechá), středisko a jeho název; sloupce s citlivými údaji (rodné číslo, adresa, mzda, účet…) nikdy nenačte a upozorní na ně.
- **Recertifikace oprávnění**: pravidelný přezkum přidělení vlastníkem oprávnění nebo nadřízeným, „Odebrat“ rovnou založí žádost o odebrání; položky v Moje práce, protokol CSV pro auditora.

## 1.26.0

- **Žádosti o přístup** (nový modul, ADR-123): žádost o přidělení nebo odebrání oprávnění za sebe nebo přímé podřízené, schválení vedoucím a vlastníkem oprávnění, vyřízení správcem přístupů, evidence přidělených oprávnění; čtyři oči (žadatel ani dotčená osoba neschvalují, nikdo nevyřizuje sám sobě).
- Katalog oprávnění: skupiny AD, aplikace, role a fyzické přístupy s vlastníkem, pravidly schválení, nejdelší platností a příznakem privilegovaného přístupu.
- Evidence osob a **import z personalistiky** (CSV / XLSX, např. export z PERM) s náhledem změn, párováním podle osobního čísla nebo e-mailu a nadřízenými.
- Denní kontrola: přidělení po platnosti a oprávnění odešlých osob → žádosti o odebrání.
- Čekající schválení v Moje práce a v souhrnném e-mailu; nová oprávnění `access:request` a `access:manage` doplněna systémovým rolím.

## 1.25.0

- **Mapy a půdorysy** (Aktiva → Mapy a půdorysy, ADR-122): nahrání půdorysu nebo mapy areálu v PDF, DWG, DXF nebo jako obrázek, seskupení podle areálu, budovy a podlaží, zoom, stažení původního souboru.
- Umísťování aktiv kliknutím a tažením; barva bodu podle stavu – červená (incident, závažný alert SOC, zranitelnost KEV, kritický stav), oranžová (alert, kritické / vysoké zranitelnosti, nepřijatelné riziko), zelená (v pořádku), šedá (bez dat); důvody a odkaz na aktivum, filtr barev, obnova každou minutu.
- Karta „Na mapě“ v detailu aktiva; nové typy aktiv **Datová zásuvka** a **Rack / rozvaděč**.
- Převodní služba: nový endpoint `/image` (PDF → PNG, DXF přes LibreOffice Draw, DWG přes LibreDWG, je-li k dispozici); obraz převodní služby nově obsahuje `libreoffice-draw-nogui` – po aktualizaci se znovu sestaví.

## 1.24.6

- README: postup instalace Dockeru (oficiální skript get.docker.com, ruční instalace v návodu), požadavky na server a příprava adresáře `/opt/contix` před `git clone`; instalace zůstává na větvi `main` (aktualizace přes `update.sh`).

## 1.24.5

- `publish.sh`, `bundle.sh`, `lib.sh`: proměnné před znakem „…“ ve složených závorkách – výchozí bash 3.2 na macOS jinak hlásil „unbound variable“.

## 1.24.4

- Veřejný repozitář: `github.com/dynamicdata-cz/contix` – adresa v README, návodu k instalaci, dokumentaci CI, `publish.sh` a `server.env.example`.
- Odkaz na zdrojový kód (AGPL) v `/api/health` a v menu je výchozí `https://github.com/dynamicdata-cz/contix`; `CONTIX_SOURCE_URL` ho přepíše (např. u upravené verze).

## 1.24.3

- Administrace: boční menu se skupinami a ikonami (Uživatelé a přístup, Organizace, Integrace, Provoz), obsah vpravo; na úzké obrazovce rozbalovací výběr stránky.

## 1.24.2

- Administrace: odkazy seskupené podle oblasti (Uživatelé a přístup, Organizace, Integrace, Provoz) a zalomené do řádků – bez vodorovného posuvníku, i na menších obrazovkách.

## 1.24.1

- Pravidla projektu přejmenována z `CLAUDE.md` na `AGENTS.md` (otevřená konvence pro AI asistenty, nezávislá na dodavateli); odkazy v README, CONTRIBUTING, SECURITY a dokumentaci upraveny.

## 1.24.0

Vývoj rizik v čase a přehled skupiny (ADR-121).

- Nové měsíční ukazatele trendů: střední a nízká rizika, pokrytí katalogu hrozeb, neposouzené hrozby, slabé schopnosti, rizika nad ochotou, překročené KRI, slepá místa detekce.
- Karta **Vývoj rizik v čase** na stránce Ochota riskovat a KRI.
- **Přehled skupiny společností** z posledních měsíčních snímků (jen společnosti s oprávněním číst rizika).

## 1.23.0

Ochota riskovat a klíčové ukazatele rizik (ADR-120).

- Nová stránka **Ochota riskovat a KRI** (Rizika → tlačítko): nejvyšší přijatelná úroveň rizika pro důvěrnost, integritu, dostupnost a dodavatele s vyjádřením vedení, schválení (kdo a kdy), označení změny po schválení.
- Přehled rizik nad ochotou riskovat (kategorie z CIA hrozeb a vazby na dodavatele), upozornění u rizik bez zvládání.
- Sedm KRI z dat (MFA, EDR, KEV z internetu, zranitelnosti po termínu, neotestovaná obnova, neposouzené hrozby, podněty po termínu) s nastavitelnými prahy; datum překročení, denní přepočet v plánovači.
- Nový podnět k přehodnocení **Překročený ukazatel KRI** u rizik s přijatým scénářem, jehož schopnost ukazatel sleduje.
- Ochota a KRI ve zprávě o hodnocení rizik (část 8) a ve zprávě o přezkoumání ISMS.

## 1.22.0

Pokrytí technik MITRE ATT&CK detekcí (ADR-119).

- Nová záložka **Detekce ATT&CK** u scénářů z dat: techniky ze šablon se stavem zachyceno (alerty SOC za 90 dní), plánované hledání hrozeb, deklarované pravidlo SIEM / EDR, slepé místo; deklarace se zdrojem, poznámkou, autorem a auditem.
- Slepá místa ovlivní scénáře: když se detekce měří a většina technik scénáře je slepá, úroveň zranitelnosti návrhu +1 se zdůvodněním.
- Zpráva o hodnocení rizik: část 7.7 s pokrytím technik a výčtem slepých míst.

## 1.21.0

Rozšířená knihovna scénářů z dat (ADR-118).

- Šest nových šablon: zneužití oprávnění zevnitř, výpadek služby dostupné z internetu, chybná konfigurace cloudu a Microsoft 365, kompromitace softwarové komponenty / dodavatele softwaru, napadení OT a průmyslových systémů, ztráta nebo krádež zařízení (celkem 14).
- Nové signály z dat: podpůrná aktiva s vysokou dostupností bez redundance, nesplněný monitor Microsoft Secure Score, kritické / vysoké zranitelnosti v aplikacích a komponentách, zranitelná nebo vystavená OT / IoT zařízení.
- Šablony s podmínkou rozsahu (typ aktiva, dostupnost z internetu) – návrh vznikne jen tam, kde dává smysl.

## 1.20.0

Plán zvládání a zbytkové riziko z dat (ADR-117).

- Návrh zbytkového rizika bere v úvahu důkazy: opatření s neúčinným posledním testem nebo nesplněným průběžným monitorem se nezapočte, poslední test „účinné s výjimkami“ sníží účinnost na částečnou; zdůvodnění je v návrhu.
- Nový podnět k přehodnocení rizika **Nesplněný monitor opatření** (silný u opatření vedeného jako účinné; zvyšuje návrh úrovně zranitelnosti).
- **Návrhy akcí plánu z dat** na záložce Zvládání: zavést navázané opatření, obnovit účinnost opatření, posílit / doložit slabé schopnosti z přijatých scénářů – výběr, odpovědné místo a termín, akce vzniknou až po potvrzení, bez duplicit.
- Pokrytí katalogu hrozeb: u neposouzené hrozby tlačítko **Úkol** (úkol navázaný na aktivum).

## 1.19.0

Analýza rizik z dat ve zprávě o hodnocení rizik (ADR-116).

- Zpráva o hodnocení rizik má novou část **7. Analýza rizik z dat**: profil bezpečnostních schopností (stav, zdroj – změřeno / deklarováno, pokrytí, produkt a platnost deklarace), pokrytí katalogu hrozeb po primárních aktivech s výčtem neposouzených hrozeb, hrozby vyloučené jako nerelevantní se zdůvodněním a autorem, rozhodnuté scénáře z dat, přehodnocení rizik v hodnoceném období s podněty a otevřené podněty s termínem.
- Stav se zmrazí ve snímku verze (náhled, tisk, Word); část se přidá jen u společností s primárními aktivy nebo scénáři z dat.
- Ukazatele verzí: pokrytí katalogu hrozeb (%) a neposouzené hrozby s rozdílem proti předchozí verzi.

## 1.18.0

Pokrytí katalogu hrozeb a průběžné přehodnocení scénářů z dat (ADR-115).

- Nová záložka **Pokrytí katalogu hrozeb** u rizikových scénářů: primární aktivum × aktivní hrozba z katalogu se stavem pokryto rizikem (i přes podpůrná aktiva a další hrozby scénáře), návrh z dat, nerelevantní se zdůvodněním, neposouzeno; souhrn podílu posouzených kombinací.
- Zdůvodnění „nerelevantní hrozby“ s autorem a datem, zápis do auditního záznamu; při přesunu aktiva do jiné společnosti jde s aktivem.
- Nový podnět k přehodnocení rizika **Změna dat scénáře**: u přijatých a navázaných návrhů, když se doložené skutečnosti změní po posledním hodnocení rizika (silný, když návrh vychází výš). Potvrzení nebo změna hodnocení podnět uzavře.
- Plánovač jednou denně obnoví návrhy scénářů u společností, které je používají (jen návrhy, nikdy rizika).

## 1.17.0

Rizikové scénáře z dat (ADR-114).

- Profil bezpečnostních schopností měřený z dat CONTIXu: EDR (agent Wazuh), MFA a privilegované přístupy (AD / Entra ID), segmentace, správa zranitelností (KEV z internetu, po termínu, EOL), hardening (SCA), zálohy a obnova (BIA a testy plánů), dodavatelé – stav, pokrytí, odkaz na zdroj a související požadavky ISO / NIS2 / CIS / vyhlášky.
- Deklarace schopností s produktem, poznámkou, důkazem a platností tam, kde data chybí; upozornění na rozpor s daty.
- Knihovna 8 šablon scénářů s hrozbami a zranitelnostmi z katalogu vyhlášky a technikami ATT&CK; návrhy pro primární aktiva jen tam, kde data dokládají slabinu – dopad, hrozba a zranitelnost se zdůvodněním a doklady, stávající opatření.
- Rozhodnutí: přijmout jako riziko, navázat na existující, zamítnout se zdůvodněním (při nové skutečnosti se návrh znovu otevře).
- Ukázková data obsahují deklarace schopností a návrhy scénářů.

## 1.16.0

CRA pro dovozce a distributory (ADR-113).

- Kontrola dokladů výrobce u produktů s rolí dovozce / distributor: označení CE, EU prohlášení o shodě, informace a pokyny podle přílohy II, údaje dovozce, u dovozce technická dokumentace a posouzení shody – stav, poznámka, odkaz, přiložené soubory, kdo a kdy ověřil.
- Nové mezery: neověřené doklady, chybějící datum konce podpory výrobce, chybějící zdroj informací o zranitelnostech; konec podpory se hlídá i u dovozce / distributora.
- Oznámení výrobců ve formátu CSAF 2.0 (záložka Oznámení výrobců): párování na produkty podle CPE nebo výrobce, názvu a verze (i rozsahy verzí), nálezy se stavem a nápravou podle výrobce; vlastní posouzení VEX se novou revizí nepřepíše.
- CPE 2.3 u produktu a volitelné dohledání zranitelností v NVD (výchozí vypnuto, odchází jen CPE).
- Přesun produktu do jiné společnosti přenese i nálezy zranitelností.

## 1.15.4

- E2E: bez opakování testů (navazují na sebe), test síťového skenu se bez nmap přeskočí.

## 1.15.3

- E2E: výsledek externí kontroly se v testu posílá přes Playwright (v kontejneru CI poslouchá náhled jen na IPv6), test aktiva odolný proti opakování v CI.

## 1.15.2

- CI: adresář pro výsledky testů (JUnit) se vytvoří před spuštěním testů.

## 1.15.1

- CI: kontrola tajemství v repozitáři se bez gitu v obrazu (oven/bun) přeskočí místo pádu testů.

## 1.15.0

Otevřené vydání – CONTIX pod licencí AGPL-3.0 (ADR-112).

- Licence AGPL-3.0, verze, licence a odkaz na zdrojový kód v menu aplikace (`CONTIX_SOURCE_URL`).
- Ukázková data `bun run demo:seed` – fiktivní společnost s organizací, aktivy, procesy, riziky, opatřeními, dodavateli a úkoly.
- Zveřejnění vydání do veřejného repozitáře `infra/scripts/publish.sh` s kontrolou tajemství a interních údajů.
- Dokumentace pro veřejný repozitář: README, SECURITY, CONTRIBUTING, šablony hlášení, GitHub Actions.

## 1.14.1 (2026-10-25)

- CI stability - no source request spacing in tests, longer per-test timeout in GitLab CI

## 1.14 (2026-10-23)

- Wazuh rule tuning agent phase 1 - data-driven proposals, indexer simulation, four-eyes approval, rules export

## 1.13.2 (2026-10-23)

- legal text sources - no false changes on source switch, source shown, admin choice, ops warning

## 1.13.1 (2026-10-23)

- e-Sbirka open data - designations as literals or in named graphs, keyless web JSON fallback

## 1.13 (2026-10-23)

- automated evidence - GRC data monitors, external checks with token, task on failure

## 1.12.3 (2026-10-23)

- e-Sbirka open data - discover renamed fragment properties, work without order property

## 1.12.2 (2026-10-23)

- legislation sync - fix open data regression, fall back to older version until new text arrives, diagnostics

## 1.12.1 (2026-10-23)

- e-Sbirka fragments - tolerant response parsing, 1-based paging, base URL fallback, diagnostics

## 1.12 (2026-10-23)

- CONTIX security - dependency updates, SBOM from lock files, CSP and security headers

## 1.11 (2026-10-23)

- more links and exceptions - compensating controls, AI system risks and controls, SOC 2 CSOC from supplier reports

## 1.10 (2026-10-23)

- one work queue - My work tabs, bulk task changes, position page with handover

## 1.09 (2026-10-23)

- performance and lists - route-level code splitting, lazy English pack, sorting and saved views for risks, controls and suppliers

## 1.08 (2026-10-23)

- visual refresh - dark mode, refined UI primitives, KPI strip with sparklines, record detail sticky header and tabs

## 1.07 (2026-10-23)

- AI knowledge base - new vector kinds, knowledge articles, index management, HNSW and prefix full-text search

## 1.06 (2026-10-23)

- UI comfort - Ctrl+K quick search, list filters and tabs in URL, confirm dialog and toasts, modal focus/Escape, unsaved-changes guard, mobile menu

## 1.05 (2026-10-23)

- record links - clickable linked records, backlinks card (where is this record used), CRA product links and risk from finding, audit finding to control

## 1.04.1 (2026-10-23)

- OSV download runs in background (202 + status polling, lease), no empty network errors

## 1.04 (2026-10-23)

- customer security questionnaires (import, answer library, AI proposals with sources, approval, XLSX export) and Trust Center (public page, NDA access requests, tokenized stamped PDFs)

## 1.03 (2026-10-23)

- supplier assurance reports (SOC 2/SOC 1/ISO 27001) – CUEC mapping to own controls, exceptions to supplier risks, AI extraction, gaps, validity obligations

## 1.02 (2026-10-23)

- vuln import from CI/CD (API token, failOn gate), metrics, Qualys and Dependency-Track parsers, read-only DefectDojo connector, regrouped navigation

## 1.01 (2026-10-23)

- continuous control monitoring (monitors, immutable runs, period tests for SOC 2 Type II, Secure Score)

## 1.00 (2026-10-22)

- scanner imports (Nessus, OpenVAS, Burp, ZAP, Nuclei, Trivy, Grype, SARIF, CSV), reimport lifecycle, dedup, triage states, exposure priority, AI scan triage

## 0.99 (2026-10-22)

- AI automatizace (screening AI Act, triáž VEX, triáž incidentů), vektory a vazby modulů

## 0.98 (2026-10-22)

- CRA component vulnerabilities – offline OSV database (download per ecosystem or upload), local SBOM matching by purl and version, KEV / EPSS flags, VEX statements and OpenVEX / CycloneDX VEX export, Art. 14 notification from KEV findings (ADR-093)

## 0.97 (2026-10-22)

- Cyber Resilience Act – products with digital elements (role, Annex III/IV category, conformity assessment options, support period, CVD contact), Annex I and role-based requirements, SBOM import (CycloneDX / SPDX JSON), Art. 14 notifications with 24 h / 72 h / final report deadlines and SRP text, obligations (ADR-092)

## 0.96 (2026-10-22)

- SOC 2 engagement – Type I / Type II scope, criteria matrix (controls, tests in scope, samples, exceptions), auditor workpapers, standard PBC requests, system description with CUECs and subservice organisations, readiness check, Word report (sections I–V), TSC ↔ Decree 409 / ISO 27001 mapping (ADR-091)

## 0.95 (2026-10-22)

- AI Act module – AI system register, prohibited practices screening, risk classification (Annex I/III, Art. 6(3), Art. 50), deployer and provider obligations, approval of use, FRIA, AI directive template with employee summary and AI literacy course (ADR-090)

## 0.94 (2026-10-22)

- info service – DE/EN/SK item recognition, default kind per feed, web page sources without RSS (CSIRT.CZ), bulk NÚKIB PDF reports (ADR-089)

## 0.93 (2026-10-22)

- impact review of regulator warnings – status, owner, due date, affected assets with suggestions, follow-up risk / task / event; feed publisher and country (ADR-088)

## 0.92.5 (2026-10-22)

- info service – clearer error when a feed address returns a web page instead of RSS

## 0.92.4 (2026-10-22)

- NÚKIB month entry – month picker first, one "Propose figures for <month>" button (news item or website lookup), optional PDF upload

## 0.92.3 (2026-10-22)

- AI proposal for any month – NÚKIB monthly report looked up by file naming on nukib.gov.cz

## 0.92.2 (2026-10-22)

- NÚKIB month entry – month and year pickers (Safari), report and month stay in sync, form resets on month change

## 0.92.1 (2026-10-22)

- NÚKIB monthly report proposal – canonical severity and class names, no remainder into "Ostatní", swapped-severity check

## 0.92 (2026-10-22)

- current NÚKIB incident statistics – manual monthly figures and AI proposal from the monthly PDF report (ADR-087)

## 0.91.2 (2026-10-22)

- incident open data – stale data notice, distinct label for grouped categories

## 0.91.1 (2026-10-22)

- NÚKIB information service moved to the top menu next to Overview

## 0.91 (2026-10-21)

- NÚKIB information service – RSS news and warnings, incident open data, National MISP status (ADR-087)

## 0.90 (2026-10-21)

- outputs and reports by company framework, DORA incident report, tracked frameworks first (ADR-086)

## 0.89 (2026-10-21)

- shared group assets, risk scenarios with multiple threats and vulnerabilities (ADR-085)

## 0.88 (2026-10-21)

- DORA financial entity flag, DORA incident reporting, framework badge in module headers (ADR-084)

## 0.87 (2026-10-21)

- heatmap for matrix risk methodologies (5x5, imported with axes), clearer group mapping placeholder (ADR-083)

## 0.86 (2026-10-21)

- country packs SK, PL, DE, AT – entity categories, NIS2 main framework, national reporting references (ADR-082)

## 0.85 (2026-10-21)

- profile-driven incident reporting (CZ act / NIS2 Art. 23), legal references only in CZ pack, profile labels in outputs (ADR-081)

## 0.84 (2026-10-21)

- regulatory profile per company – country pack (CZ, generic), main framework from library, audit checklists from any framework, risk methodology from profile (ADR-080)

## 0.83 (2026-10-21)

- framework library – jurisdiction/type metadata, custom frameworks with CSV/XLSX/YAML/JSON/XML/OSCAL import and export, bidirectional mappings (ADR-079)

## 0.82 (2026-10-21)

- sign-in with Active Directory accounts (LDAPS) and SSO providers in administration (ADR-078)

## 0.81 (2026-10-21)

- CIS Controls v8.1 with implementation groups, framework selection in company dialog (ADR-077)

## 0.71.0 (2026-10-17)

- cvičení a tabletop scénáře – šablony, průběh se vstupy, vyhodnocení, test plánů, úkoly, záznam (ADR-066)

## 0.70.0 (2026-10-17)

- analýza odolnosti – RTO/RPO z BIA po grafu, jediné body selhání, kritičnost, mezery v plánech (ADR-065)

## 0.69.0 (2026-10-17)

- shoda konfigurace z Wazuh SCA – politiky, kontroly s rámci, skóre, automatický test opatření (ADR-064)

## 0.68.0 (2026-10-17)

- graf vazeb aktiv – vrstvy, technické závislosti, překryvy, detail uzlu a analýza dopadu výpadku (ADR-063)

## 0.67.0 (2026-10-17)

- napojení Microsoft Sentinel a Elastic Security – webhook i stahování, kurzor, šifrované tajemství (ADR-062)

## 0.66.0 (2026-10-17)

- pohled SOC na hostitele – aktivita v čase, alerty, zranitelnosti, IOC, incidenty, rizika, úkoly (ADR-061)

## 0.65.0 (2026-10-17)

- playbooky SOC s úkoly pro tým – playbooky organizace, úkoly z kroků, splnění = hotový krok (ADR-060)

## 0.64.0 (2026-10-16)

- plánované hledání hrozeb – knihovna dotazů, zkušební běh, alerty nad prahem, plánovač (ADR-059)

## 0.63.0 (2026-10-16)

- přehodnocení rizik z podnětů – incidenty, audity, změny, SOC, zranitelnosti, rozhodnutí vlastníka a historie (ADR-058)

## 0.62.0 (2026-10-16)

- veřejné zdroje hrozeb – abuse.ch a vlastní seznamy, shoda s alerty a hledání ve Wazuhu (ADR-057)

## 0.61.0 (2026-10-16)

- incident × SOC – podklady, doplnění ze SOC a záznam o zvládání incidentu (ADR-056)

## 0.60.0 (2026-10-16)

- reakce s potvrzením – okamžitá upozornění a zásahy SOC se schválením (ADR-055)

## 0.59.0 (2026-10-16)

- indikátory kompromitace (IOC), zpětné hledání a feed k blokaci (ADR-054)

## 0.58.0 (2026-10-16)

- výkonnost SOC a shoda AI triáže s analytiky (ADR-053)

## 0.57.0 (2026-10-16)

- zdroje alertů SOC (webhook s tokenem) a hlášení phishingu (ADR-052)

## 0.56.0 (2026-10-16)

- AI předběžná triáž alertů SOC (ADR-051)

## 0.1–0.55

Základ platformy: aktiva a discovery, zranitelnosti, organizace a procesy, rizika podle vyhlášky, opatření a shoda, dokumentace (DMS), incidenty, audity, kontinuita, dodavatelé, skupina společností, AI asistent na lokálním modelu, SOC. Viz [roadmapa](docs/00_overview/roadmap.md).
