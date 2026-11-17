# CONTIX 1.40 – 1.53: Co je nového

Shrnutí pro zákazníky a uživatele. Technické podrobnosti najdete v CHANGELOG.md.

## Modelování hrozeb podle reality vašeho prostředí (1.40 – 1.41)

Najdete ho v menu **Rizika → Modelování hrozeb**.

- **Útočné cesty.** CONTIX z vazeb aktiv, síťových segmentů, zranitelností a identit najde nejschůdnější cestu útočníka z internetu nebo z phishingu k vašim nejcennějším aktivům. Ukáže úzká hrdla s doporučením, kde zasáhnout. Riziko z cesty vytvoříte jedním klikem.
- **Kalibrace rizik z dat.** Systém navrhne dopad a pravděpodobnost rizik. Vychází z BIA, osobních údajů, incidentů, alertů SOC a doložené účinnosti opatření. Návrh vždy schvaluje člověk a zdůvodnění se ukládá do historie.
- **Hrozby pro vaše odvětví.** Přehled ransomwarových, státních a hacktivistických skupin, které působí ve vašem odvětví. Vychází z upozornění NÚKIB a CERT, z indikátorů MISP a z technik zachycených v SOC.
- **Threat model STRIDE.** Průvodce pro aplikaci, aktivum, proces nebo projekt. Výstupem je zpráva ve Wordu.
- **Postup krok za krokem.** Pět kroků s nápovědou „Jak na to“ a frontou rozhodnutí, která vám řekne, čím začít.

## Postup krok za krokem v celém CONTIXu (1.42 – 1.44)

- **Panel „Jak postupovat“** je na hlavní stránce většiny modulů: ISMS, rizika, opatření, audity, kontinuita, incidenty, dodavatelé, GDPR, AI Act, CRA, legislativa, aktiva, zranitelnosti, dokumentace, školení, identity, SOC a další.
  - Kroky jsou v doporučeném pořadí.
  - Stav se počítá z vašich dat, například „2 rizika bez vlastníka“.
  - Tlačítko **Další krok** vás vezme rovnou tam, kde se krok vyřizuje.
- **Cesta k souladu** (nová položka menu) ukazuje stav všech oblastí na jednom místě. Pokud spravujete více společností, uvidíte i přehled celé skupiny.
- **Garant postupu.** U každého průvodce lze určit funkční místo. Jeho držitelé pak dostávají další krok do **Moje práce** a do souhrnného e-mailu.
- **Vývoj v čase.** Ukazatel „Cesta k souladu (%)“ najdete v měsíčních snímcích a ve Zprávě pro vedení.

## Příprava na audit (1.45 – 1.46)

- **Příprava na audit** (Cesta k souladu → Příprava na audit) ukazuje připravenost po oddílech vyhlášky 409/410, NIS2, ISO 27001 nebo DORA. U každého oddílu vidíte:
  - opatření a dokumenty,
  - mezery,
  - kroky, které zbývá dokončit.
- **Odkazy na předpis** jsou přímo u kroků, například § 8 vyhlášky nebo čl. 21 NIS2.
- **Balíček pro auditora** je jeden ZIP. Obsahuje zprávu o připravenosti, prohlášení o aplikovatelnosti, testy, důkazy a platné dokumenty po oddílech, vše s kontrolními součty.
- **Požadavky bez posouzení** se počítají jako „neposouzené“, ne jako nesplněné.
- **Doporučené pořadí zavádění:** základy → analýza → opatření → provoz → ověření.
- **Startovací balíček** (nabídka **Další** na Cestě k souladu) připraví pro novou společnost:
  - složky dokumentace,
  - katalog opatření,
  - koncept bezpečnostní politiky,
  - vzorové cíle ISMS.
- **Souhrnný e-mail** posílá další krok jen při změně, jinak nejvýše jednou týdně.
- **Barva horní lišty.** Každý uživatel si ji může zvolit sám a správce ji může nastavit celé společnosti. Hodí se například k odlišení testovacího a produkčního prostředí.

## Novinky ve verzi 1.47

- **Průvodci pro Zprávy SOC 2 a pro Dotazníky zákazníků / Trust Center.**
- **Koncept politiky s osnovou kapitol** podle hlavního předpisu vaší společnosti (verze 0.1 k doplnění a schválení).
- **Export a import nastavení průvodců** mezi instalacemi. Přenáší se garanti podle názvu funkčního místa a profil hrozeb.
- **Krok Cesta k souladu v úvodní prohlídce** a doplněná nápověda.
- **Bezpečnostní aktualizace** knihoven.

## Novinky ve verzi 1.48

- **Test obnovy zálohy** se eviduje a Administrace → Provoz upozorní, když chybí, selhal nebo je starší než 92 dní.
- **Soupis komponent CONTIXu (SBOM)** ke stažení v Administrace → Provoz a kontakt pro hlášení zranitelností na adrese `/.well-known/security.txt`.
- **Přehled skupiny do Excelu** včetně Cesty k souladu po oblastech.
- **Import útvarů a funkčních míst** z Excelu: chybějící útvary se založí, držitelé se přiřadí podle e-mailu.

## Novinky ve verzi 1.49

- **Víc Wazuhů najednou**: každý Wazuh manager je samostatné připojení. Může patřit jedné společnosti, nebo celé skupině s přiřazením skupin agentů ke společnostem.
- Stejná čísla agentů ve dvou Wazuzích se už nepletou a aktiva různých zákazníků se stejným názvem serveru se neslučují.
- Alerty, zranitelnosti a hledání hrozeb se načítají ze všech připojení. Stávající nastavení se při aktualizaci převede samo.

## Novinky ve verzi 1.50

- **Smluvní požadavky zákazníků**: bezpečnostní přílohu smlouvy nahrajete do knihovny rámců jako tabulku, se zákazníkem, službou a platností. Požadavky namapujete na opatření a vidíte, co je pokryté.
- **Certifikáty, pentesty a bug bounty** evidujete jako důkazy s platností; před koncem platnosti přijde upozornění.

## Novinky ve verzi 1.51

- **Sběrač ze serverů**: malý skript na linuxovém serveru pošle účty, otisky SSH klíčů, Docker kontejnery, služby a stav firewallu. U aktiva pak vidíte nálezy – slabé klíče, klíče roota, privilegované kontejnery nebo pravidla firewallu, která by se po restartu ztratila.

## Novinky ve verzi 1.52

- **Společné štítky** pro aktiva, rizika, dodavatele, procesy, opatření a umístění dat – na jedné stránce vidíte vše se štítkem, např. „dostupné z internetu“.
- **Umístění dat**: kde běží vaše data (hosting, cloud, SaaS) a v jaké zemi. CONTIX upozorní na předání osobních údajů mimo EU bez záruk, chybějící smlouvu o zpracování nebo zemi se zvýšeným rizikem.

## Novinky ve verzi 1.53

- **NetBox**: zařízení a virtuální stroje z NetBoxu se načítají jako aktiva, včetně přiřazení tenantů ke společnostem.
- **JIRA**: úkol z CONTIXu založíte jedním klikem jako issue; když ho v JIRA dokončíte, úkol se v CONTIXu sám uzavře.

## Novinky ve verzi 1.54

- **Instalátor sběrače**: místo ručních kroků stáhnete v CONTIXu jeden soubor, zkopírujete ho na server a spustíte. Sám nastaví adresu, token, certifikát i plán a hned pošle první inventář. Stejný soubor poslouží pro všechny servery.

## Novinky ve verzi 1.55

- **Detail serveru**: u každého serveru ze sběrače se dá rozkliknout každý nález (proč vadí a jak ho opravit), každý účet s jeho SSH klíči, kontejnery, porty a služby. Nová historie ukáže, co se na serveru změnilo – nový účet, nový klíč, otevřený port nebo změna firewallu.
- Sběrač nově hlásí i nastavení SSH a čekající bezpečnostní aktualizace – stačí ho přeinstalovat instalátorem.

## Novinky ve verzi 1.56

- **Bezpečnostní testy**: z Kali Linuxu spustíte v CONTIXu základní testy – otevřené porty, TLS, SSH, bezpečnostní hlavičky webu, webový server, SMB a anonymní sdílení, LDAP. Testovat jde jen ve schváleném rozsahu (co, kdy, na základě čeho). Výstupy nástrojů spuštěných ručně jde i nahrát. Každý nález vysvětlí lokální AI – co znamená, jak ho opravit a co testovat dál – a k běhu připraví shrnutí do zprávy.

## Novinky ve verzi 1.56.1

- **Víc testů najednou**: vyberete sadu (např. „Linux server“) a cíle třeba přímo z aktiv. Po průzkumu portů se samy spustí navazující testy podle nalezených služeb a – pokud chcete – AI rovnou rozebere nálezy a shrne celou sadu včetně doporučení, co testovat dál (jedním tlačítkem).
- **Nález k aktivu**: nespárovaný nález přiřadíte k aktivu ručně; CONTIX si adresu zapamatuje pro příští testy.

## Novinky ve verzi 1.57

- **Přehlednější Přehled**: oblasti jsou rozdělené na technickou bezpečnost a řízení a shodu, problémové oblasti jsou vidět na první pohled (barevný proužek a štítek), nevyplněné oblasti jsou shrnuté do jednoho řádku. Míra shody je nově jako prstenec s rozpadem.
- Na Přehledu přibyly **Bezpečnostní testy** a **Servery ze sběrače**.

## Novinky ve verzi 1.58

- **Zpráva pro vedení se semafory**: nahoře celkový stav a tři světla s počty, pod tím jen to, o čem má vedení rozhodnout, a všechny ukazatele v jedné tabulce se semaforem od nejhoršího. Stejně vypadá i tisk a Word. Nově je ve zprávě i stav bezpečnostních testů.

## Novinky ve verzi 1.59

- **Logo společnosti ve výstupech**: v Administraci nahrajete logo, zvolíte barvu a text zápatí – a všechny výstupy do PDF i Wordu (zpráva pro vedení, SoA, zprávy, hlášení incidentů…) je převezmou. Dceřiné společnosti mohou mít vlastní, nebo převezmou logo holdingu.
- **Hezčí zpráva pro vedení ve Wordu**: přehledné souhrny, podbarvené ukazatele a vývoj v kompaktní tabulce s malými grafy.

## Novinky ve verzi 1.60

- **Víc testů z Kali Linuxu**: UDP služby, citlivé soubory na webu, RDP, FTP, pošta, databáze bez hesla, SNMP, NFS, VNC a přenos DNS zóny. Po aktualizaci stáhněte a spusťte nový instalátor sondy.
- **Business vlastník a technický garant aktiva**: technické nálezy řeší garant (nebo jeho zástupce), za aktivum a audity odpovídá business vlastník.
- **Úkoly z nálezů**: nález z testu jedním kliknutím (nebo automaticky) založí úkol technickému garantovi s termínem podle závažnosti; po úspěšném opakovaném testu se úkol uzavře sám.
- **Eskalace**: co je týden po termínu, vidí vedoucí útvaru, a dál postupně vyšší vedení.

## Novinky ve verzi 1.61

- **Určení regulace z RES**: podle IČO se načtou údaje z Registru ekonomických subjektů ČSÚ, CONTIX navrhne regulované služby podle vyhlášky 408/2025, spočítá velikost podniku a po potvrzení podmínek určí režim vyšších nebo nižších povinností. Funguje pro vlastní společnosti (výsledek lze zapsat do profilu) i pro dodavatele.

## Novinky ve verzi 1.62

- **Úkoly z bezpečnostních testů jdou konkrétním lidem**: technický garant aktiva dostane úkol přímo, i když nemá v organizační struktuře funkci; zástupce ho vidí také. U nálezu jsou vidět odpovědné osoby z karty aktiva.
- **Úhlednější formuláře**: výběry mají stejnou výšku jako ostatní pole a pole v řádku lícují.

## Novinky ve verzi 1.63

- **Zpráva z bezpečnostních testů pro zákazníka** jedním kliknutím ve Wordu i PDF.
- **Oprava se ověří sama**: po splnění úkolu sonda test zopakuje a úkol uzavře, nebo vrátí.
- **Pravidelné testy** podle plánu s přehledem nových a opravených nálezů.
- **Ohlášení regulované služby NÚKIB**: podklad, záznam ohlášení a hlídání změn s lhůtou.
- **Nálezy v rizicích a opatřeních**: podnět k přehodnocení rizika a doklad účinnosti opatření.

Žádná z těchto verzí nevyžaduje zásah do dat. Databázové migrace proběhnou automaticky při aktualizaci.
