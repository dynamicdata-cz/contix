/**
 * NIS2 – směrnice (EU) 2022/2555 (čl. 20, 21 a 23 – povinnosti subjektů) a prováděcí nařízení Komise (EU) 2024/2690
 * (příloha – technické a metodické požadavky na opatření podle čl. 21 odst. 2 směrnice).
 * Úřední české znění z EUR-Lex (CELLAR, CELEX 32022L2555 a 32024R2690); opakované použití dle rozhodnutí 2011/833/EU.
 * Formát směrnice: "#článek|nadpis" a "odstavec|písmeno|text" („-“ = navazující pododstavec).
 * Formát přílohy: "#oddíl|nadpis", "##bod|nadpis", "bod||text" a "bod|písmeno|text" („-“ = navazující text).
 */

export const NIS2_DIRECTIVE = `#20|Řízení
1||Členské státy zajistí, aby řídící orgány základních a důležitých subjektů schválily opatření k řízení kybernetických bezpečnostních rizik přijatá těmito subjekty za účelem dosažení souladu s článkem 21, dohlížely nad jeho uplatňováním a mohly nést odpovědnost, poruší-li subjekty uvedený článek. Uplatňováním tohoto odstavce není dotčeno vnitrostátní právo, pokud jde o pravidla odpovědnosti vztahující se na veřejné orgány, odpovědnost úředníků veřejné správy a odpovědnost volených veřejných činitelů nebo jmenovaných úředníků.
2||Členské státy zajistí, aby členové řídících orgánů základních a důležitých subjektů museli absolvovat školení, a vybízí základní a důležité subjekty, aby pravidelně nabízely podobné školení svým zaměstnancům, aby tak získali dostatečné znalosti a dovednosti, aby mohli identifikovat rizika a posoudit postupy řízení kybernetických bezpečnostních rizik a jejich dopad na služby poskytované subjektem.
#21|Opatření k řízení kybernetických bezpečnostních rizik
1||Členské státy zajistí, aby základní a důležité subjekty přijaly vhodná a přiměřená technická, provozní a organizační opatření k řízení bezpečnostních rizik, jimž čelí sítě a informační systémy, jež tyto subjekty používají pro svůj provoz nebo poskytování svých služeb, a k předcházení incidentům nebo minimalizaci jejich dopadů na příjemce jejich služeb a na další služby. S ohledem na nejnovější technický vývoj a případně na příslušné evropské a mezinárodní normy a na náklady na provádění musí opatření uvedená v prvním pododstavci zajišťovat úroveň bezpečnosti sítí a informačních systémů odpovídající existující míře rizika. Při posuzování přiměřenosti těchto opatření je třeba náležitě zohlednit míru vystavení subjektu rizikům, jeho velikost a pravděpodobnost výskytu incidentů, jejich závažnost a společenský a ekonomický dopad.
2||Opatření uvedená v odstavci 1 jsou založena na přístupu zohledňujícím všechny druhy rizik, jehož cílem je chránit sítě a informační systémy a fyzické prostředí těchto systémů před incidenty, a zahrnují alespoň:
2|a|politiku analýzy rizik a politiku bezpečnosti informačních systémů;
2|b|řešení incidentů;
2|c|řízení kontinuity provozu, jako je například správa zálohování a obnova provozu po havárii, a krizové řízení;
2|d|bezpečnost dodavatelského řetězce včetně bezpečnostních aspektů týkajících se vztahů mezi každým subjektem a jeho přímými dodavateli nebo poskytovateli služeb;
2|e|zabezpečení pořizování, vývoje a údržby sítí a informačních systémů, včetně zveřejňování zranitelností a jejich řešení;
2|f|politiky a postupy za účelem posouzení účinnosti opatření k řízení kybernetických bezpečnostních rizik;
2|g|základní postupy kybernetické hygieny a školení v oblasti kybernetické bezpečnosti;
2|h|politiky a postupy týkající se používání kryptografie a případně šifrování;
2|i|bezpečnost lidských zdrojů, postupy kontroly přístupu a správa aktiv;
2|j|v příslušných případech používání vícefaktorových autentizačních řešení nebo trvalých autentizačních řešení, zabezpečené hlasové, obrazové a textové komunikace a zabezpečených systémů nouzové komunikace v rámci subjektu.
3||Členské státy zajistí, aby při zvažování vhodných opatření uvedených v odst. 2 písm. d) tohoto článku subjekty zohlednily zranitelnosti specifické pro každého přímého dodavatele a poskytovatele služeb a celkovou kvalitu produktů a postupů v oblasti kybernetické bezpečnosti svých dodavatelů a poskytovatelů služeb, včetně jejich postupů bezpečného vývoje. Členské státy rovněž zajistí, aby při zvažování vhodných opatření podle uvedeného písmene subjekty měly povinnost zohlednit výsledky koordinovaného posouzení bezpečnostních rizik kritických dodavatelských řetězců, které bylo provedeno v souladu s čl. 22 odst. 1.
4||Členské státy zajistí, aby v případě, že subjekt zjistí, že neodpovídá požadavkům stanoveným v odstavci 2, přijal bez zbytečného odkladu všechna nezbytná, vhodná a přiměřená nápravná opatření.
#23|Oznamovací povinnosti
1||Členské státy zajistí, aby základní a důležité subjekty oznamovaly bez zbytečného odkladu svému týmu CSIRT nebo případně svému příslušnému orgánu v souladu s odstavcem 4 každý incident, který má významný dopad na poskytování jejich služeb, jak je uvedeno v odstavci 3 (významný incident). V příslušných případech dotčené subjekty oznámí bez zbytečného odkladu příjemci svých služeb významné incidenty, které by mohly negativně ovlivnit poskytování těchto služeb. Každý členský stát zajistí, aby tyto subjekty oznamovaly mimo jiné všechny informace, které týmu CSIRT nebo případně příslušnému orgánu umožní posoudit případný přeshraniční dopad daného incidentu. Pouhé oznámení nepředstavuje pro oznamující subjekt vyšší míru právní odpovědnosti. Pokud dotčené subjekty oznámí příslušnému orgánu významný incident podle prvního pododstavce, členský stát zajistí, aby příslušný orgán toto oznámení po jeho obdržení předal týmu CSIRT. V případě přeshraničního nebo meziodvětvového významného incidentu členské státy zajistí, aby jejich jednotná kontaktní místa včas obdržela příslušné informace v souladu s odstavcem 4.
2||Členské státy příslušně zajistí, aby základní a důležité subjekty informovaly bez zbytečného odkladu příjemce svých služeb, kteří mohou být ovlivněni významnou kybernetickou hrozbou, o všech krocích nebo nápravných opatřeních, jež příjemci mohou v reakci na danou hrozbu učinit. Subjekty příjemce příslušně uvědomí také o významné kybernetické hrozbě samotné.
3||Incident se považuje za významný, jestliže:
3|a|dotčenému subjektu způsobil nebo může způsobit závažné provozní narušení služeb nebo finanční ztráty;
3|b|způsobil nebo může způsobit jiným fyzickým nebo právnickým osobám značnou hmotnou nebo nehmotnou újmu.
4||Členské státy zajistí, aby za účelem oznámení podle odstavce 1 dotčené subjekty předložily týmu CSIRT nebo případně příslušnému orgánu:
4|a|bez zbytečného odkladu, nejpozději však do 24 hodin po zjištění významného incidentu, včasné varování, v němž případně uvedou, zda se domnívají, že byl významný incident způsoben nezákonným nebo svévolným zásahem nebo že by mohl mít přeshraniční dopad;
4|b|bez zbytečného odkladu, nejpozději však do 72 hodin po zjištění významného incidentu, oznámení incidentu, v němž případně aktualizují informace uvedené v písmenu a), předloží prvotní posouzení významného incidentu včetně jeho závažnosti a dopadu a – pokud jsou k dispozici – indikátory kompromitace;
4|c|na žádost týmu CSIRT nebo případně příslušného orgánu průběžnou zprávu o podstatných aktualizacích stavu;
4|d|nejpozději do jednoho měsíce od předložení oznámení incidentu podle písmene b) závěrečnou zprávu zahrnující: i) podrobný popis incidentu včetně jeho závažnosti a dopadu; ii) druh hrozby nebo základní příčinu, která incident pravděpodobně spustila; iii) učiněná a probíhající opatření ke zmírnění následků; iv) případně přeshraniční dopad incidentu;
4|e|v případě, že v okamžiku, kdy by měla být předložena závěrečná zpráva podle písmene d), incident stále trvá, členské státy zajistí, aby dotčené subjekty v uvedené lhůtě předložily zprávu o pokroku a následně, nejpozději jeden měsíc po tom, co incident vyřešily, závěrečnou zprávu.
4|-|Odchylně od prvního pododstavce písm. b) poskytovatel služby vytvářející důvěru oznámí týmu CSIRT nebo případně příslušnému orgánu významné incidenty, které mají dopad na jím poskytované služby, a to bez zbytečného odkladu, nejpozději však do 24 hodin od okamžiku, kdy se o významném incidentu dozvěděl.`;

export const NIS2_IR = `#1|Politika bezpečnosti sítí a informačních systémů (čl. 21 odst. 2 písm. a) směrnice (EU) 2022/2555)
##1.1|Politika bezpečnosti sítí a informačních systémů
1.1.1||Pro účely čl. 21 odst. 2 písm. a) směrnice (EU) 2022/2555 politika bezpečnosti sítí a informačních systémů:
1.1.1|a|stanoví přístup příslušných subjektů k řízení bezpečnosti jejich sítí a informačních systémů;
1.1.1|b|odpovídá obchodní strategii a cílům příslušných subjektů a doplňuje je;
1.1.1|c|stanoví cíle bezpečnosti sítí a informací;
1.1.1|d|obsahuje závazek k neustálému zlepšování bezpečnosti sítí a informačních systémů;
1.1.1|e|obsahuje závazek poskytnout odpovídající zdroje potřebné pro její provedení, včetně potřebných zaměstnanců, finančních zdrojů, postupů, nástrojů a technologií;
1.1.1|f|je sdělena příslušným zaměstnancům a dotčeným zúčastněným externím stranám a je jimi uznána;
1.1.1|g|stanoví role a odpovědnosti podle bodu 1.2.;
1.1.1|h|uvádí seznam dokumentace, která má být uchovávána, a dobu jejího uchovávání;
1.1.1|i|uvádí seznam politik specifických pro toto téma;
1.1.1|j|stanoví ukazatele a opatření ke sledování jejího provádění a aktuálního stavu úrovně vyspělosti bezpečnosti sítí a informací příslušných subjektů;
1.1.1|k|uvádí datum formálního schválení řídícími orgány příslušných subjektů (dále jen „řídící orgány“).
1.1.2||Bezpečnostní politiku v oblasti sítí a informačních systémů řídící orgány přezkoumávají a v případě potřeby aktualizují nejméně každý rok a vždy v případě výskytu významných incidentů nebo významných změn operací či rizik. Výsledky přezkumů se zdokumentují.
##1.2|Úkoly, odpovědnosti a pravomoci
1.2.1||Příslušné subjekty v rámci své politiky bezpečnosti sítí a informačních systémů uvedené v bodě 1.1 stanoví odpovědnosti a pravomoci v oblasti bezpečnosti sítí a informačních systémů, přidělí je k úkolům, rozdělí je podle potřeb příslušných subjektů a sdělí je řídícím orgánům.
1.2.2||Příslušné subjekty vyžadují, aby všichni zaměstnanci a třetí strany uplatňovali bezpečnost sítí a informačních systémů v souladu se zavedenou politikou bezpečnosti sítí a informací, tematicky zaměřenými politikami a postupy příslušných subjektů.
1.2.3||Řídícím orgánům je v otázkách bezpečnosti sítí a informačních systémů přímo podřízena alespoň jedna osoba.
1.2.4||V závislosti na velikosti příslušných subjektů spadá bezpečnost sítí a informačních systémů pod specializované úkoly nebo povinnosti, které jsou vykonávány nad rámec stávajících úkolů.
1.2.5||Kolidující povinnosti a protichůdné oblasti odpovědnosti budou v příslušných případech odděleny.
1.2.6||Řídící orgány úkoly, odpovědnosti a pravomoci přezkoumávají a v případě potřeby aktualizují v plánovaných intervalech a při výskytu významných incidentů nebo významných změn operací či rizik.
#2|Politika řízení rizik (čl. 21 odst. 2 bod a) směrnice (EU) 2022/2555)
##2.1|Rámec pro řízení rizik
2.1.1||Pro účely čl. 21 odst. 2 písm. a) směrnice (EU) 2022/2555 příslušné subjekty zřídí a spravují vhodný rámec řízení rizik, aby identifikovaly a řešily rizika pro bezpečnost sítí a informačních systémů. Příslušné subjekty provedou a zdokumentují posouzení rizik a na základě výsledků vypracují, zavedou a sledují plán ošetření rizik. Výsledky posouzení rizik a zbytková rizika přijímají řídící orgány nebo v příslušných případech osoby, které jsou odpovědné a mají pravomoc řídit rizika, za předpokladu, že příslušné subjekty zajistí odpovídající podávání zpráv řídícím orgánům.
2.1.2||Pro účely bodu 2.1.1 příslušné subjekty stanoví postupy pro identifikaci, analýzu, posouzení a ošetření rizik (dále jen „proces řízení rizik v oblasti kybernetické bezpečnosti“). Proces řízení rizik v oblasti kybernetické bezpečnosti musí být v příslušných případech nedílnou součástí celkového procesu řízení rizik příslušných subjektů. V rámci procesu řízení rizik v oblasti kybernetické bezpečnosti příslušné subjekty:
2.1.2|a|dodržují metodiku řízení rizik;
2.1.2|b|stanoví úroveň tolerance rizika v souladu s ochotou příslušných subjektů riskovat;
2.1.2|c|stanoví a spravují příslušná kritéria rizik;
2.1.2|d|v souladu s přístupem zohledňujícím všechny druhy rizik identifikují a dokumentují rizika pro bezpečnost sítí a informačních systémů, zejména ve vztahu ke třetím stranám, a rizika, která by mohla vést k narušení dostupnosti, integrity, autenticity a důvěrnosti sítí a informačních systémů, včetně identifikace kritického místa (tzv. single point of failures);
2.1.2|e|analyzují rizika pro bezpečnost sítí a informačních systémů, včetně hrozby, pravděpodobnosti, dopadu a úrovně rizika, s přihlédnutím k informacím o kybernetických hrozbách a zranitelnostech;
2.1.2|f|vyhodnotí identifikovaná rizika na základě kritérií rizik;
2.1.2|g|identifikují vhodné možnosti a opatření k ošetření rizik a stanoví pořadí jejich důležitosti;
2.1.2|h|průběžně sledují provádění opatření k ošetření rizik;
2.1.2|i|určí, kdo je odpovědný za provádění opatření k ošetření rizik a kdy by tato opatření měla být provedena;
2.1.2|j|komplexně zdokumentují zvolená opatření k ošetření rizik v plánu ošetření rizik a důvody, které vedly k akceptaci zbytkových rizik.
2.1.3||Při identifikování vhodných možností a opatření k ošetření rizik a stanovení pořadí jejich důležitosti příslušné subjekty zohlední výsledky posouzení rizik, výsledky postupu pro zhodnocení účinnosti opatření k řízení kybernetických bezpečnostních rizik, náklady na provedení ve vztahu k očekávanému přínosu, klasifikaci aktiv uvedenou v bodě 12.1 a analýzu obchodního dopadu uvedenou v bodě 4.1.3.
2.1.4||Příslušné subjekty výsledky posouzení rizik a plán ošetření rizik přezkoumají a v případě potřeby aktualizují v plánovaných intervalech alespoň jednou ročně a při výskytu významných incidentů nebo významných změn operací či rizik.
##2.2|Sledování souladu
2.2.1||Příslušné subjekty pravidelně přezkoumávají dodržování svých politik bezpečnosti sítí a informačních systémů, tematicky zaměřených politik, pravidel a norem. Řídící orgány jsou informovány o stavu bezpečnosti sítí a informací na základě přezkumů dodržování souladu prostřednictvím pravidelných zpráv.
2.2.2||Příslušné subjekty zavedou účinný systém podávání zpráv o dodržování souladu, který bude odpovídat jejich struktuře, provoznímu prostředí a prostředí hrozeb. Systém podávání zpráv o dodržování souladu musí být schopen poskytovat řídicím orgánům informovaný přehled o aktuálním stavu řízení rizik příslušnými subjekty.
2.2.3||Příslušné subjekty provádějí sledování souladu v plánovaných intervalech a při výskytu významných incidentů nebo významných změn operací či rizik.
##2.3|Nezávislý přezkum bezpečnosti informací a sítí
2.3.1||Příslušné subjekty nezávisle přezkoumávají svůj přístup k řízení bezpečnosti sítí a informačních systémů a jeho provádění, včetně lidí, procesů a technologií.
2.3.2||Příslušné subjekty vypracovávají a spravují postupy pro provádění nezávislých přezkumů, které vykonávají osoby s patřičnou kvalifikací pro audit. Pokud nezávislý přezkum vykonávají zaměstnanci příslušného subjektu, nesmí být osoby provádějící přezkumy podřízeny zaměstnancům přezkoumávané oblasti. V případě, že velikost příslušných subjektů neumožňuje takové oddělení pravomocí, zavedou příslušné subjekty alternativní opatření, která zaručí nestrannost přezkumů.
2.3.3||Výsledky nezávislých přezkumů, včetně výsledků sledování souladu podle bodu 2.2 a monitorování a měření podle bodu 7, se oznamují řídícím orgánům. Přijmou se nápravná opatření nebo se akceptuje zbytkové riziko podle kritérií, které si příslušné subjekty stanovily pro přijatelnost rizika.
2.3.4||Nezávislé přezkumy se provádějí v plánovaných intervalech a při výskytu významných incidentů nebo významných změn operací či rizik.
#3|Řešení incidentů (čl. 21 odst. 2 písm. b) směrnice (EU) 2022/2555)
##3.1|Politika řešení incidentů
3.1.1||Pro účely čl. 21 odst. 2 písm. b) směrnice (EU) 2022/2555 příslušné subjekty vypracují a zavedou politiku řešení incidentů, která stanoví úkoly, odpovědnosti a postupy pro včasné odhalování, analýzu a omezování incidentů nebo reagování na ně, obnovu po incidentech, dokumentování a oznamování incidentů.
3.1.2||Politika uvedená v bodě 3.1.1 musí být v souladu s plánem kontinuity provozu a plánem pro obnovu po havárii uvedeným v bodě 4.1. Politika obsahuje:
3.1.2|a|systém klasifikace incidentů, který je v souladu s hodnocením a klasifikací událostí provedenými podle bodu 3.4.1;
3.1.2|b|účinné komunikační plány, včetně plánů pro eskalaci a podávání zpráv;
3.1.2|c|přidělení úkolů týkajících se odhalování incidentů a vhodné reakce na ně kompetentním zaměstnancům;
3.1.2|d|dokumenty, které se používají při odhalování incidentů a reakci na ně, jako jsou příručky pro reakci na incidenty, eskalační matice, seznamy kontaktů a šablony.
3.1.3||Úkoly, odpovědnosti a postupy stanovené v politice se testují, přezkoumávají a v případě potřeby aktualizují v plánovaných intervalech a po významných incidentech nebo významných změnách operací či rizik.
##3.2|Monitorování a vedení protokolů
3.2.1||Příslušné subjekty stanoví postupy a používají nástroje pro činnosti v rámci monitorování a vedení protokolů ve svých sítích a informačních systémech s cílem odhalit události, které by mohly být považovány za incidenty, a odpovídajícím způsobem na ně reagovat, aby bylo možné zmírnit dopad.
3.2.2||Monitorování musí být v proveditelném rozsahu automatizované a v závislosti na kapacitách podniku prováděné buď nepřetržitě, nebo v pravidelných intervalech. Příslušné subjekty provádějí své monitorovací činnosti způsobem, který minimalizuje falešně pozitivní a falešně negativní výsledky.
3.2.3||Na základě postupů uvedených v bodě 3.2.1 příslušné subjekty vedou, dokumentují a přezkoumávají protokoly. Příslušné subjekty sestaví seznam aktiv, o kterých mají být vedeny protokoly, na základě výsledků posouzení rizik provedeného podle bodu 2.1. Protokoly musí případně obsahovat:
3.2.3|a|příslušný odchozí a příchozí síťový provoz;
3.2.3|b|vytváření, změny nebo odstraňování uživatelů sítí a informačních systémů příslušných subjektů a rozšiřování oprávnění;
3.2.3|c|přístup k systémům a aplikacím;
3.2.3|d|události související s autentizací;
3.2.3|e|veškerý administrátorský přístup k systémům a aplikacím a činnosti prováděné prostřednictvím účtů správce;
3.2.3|f|přístup k důležitým konfiguračním a záložním souborům nebo jejich změny;
3.2.3|g|protokoly událostí a protokoly z bezpečnostních nástrojů, jako jsou antivirové programy, systémy detekce narušení nebo brány firewall;
3.2.3|h|využití systémových prostředků a jejich výkonnost;
3.2.3|i|fyzický přístup k zařízením;
3.2.3|j|přístup k jejich síťovému vybavení a zařízením a jejich používání;
3.2.3|k|aktivace, zastavení a pozastavení různých protokolů;
3.2.3|l|environmentální události.
3.2.4||Protokoly se pravidelně přezkoumávají, zda se v nich neobjevují neobvyklé nebo nežádoucí trendy. Příslušné subjekty v případě potřeby stanoví vhodné hodnoty výstražných prahů. Pokud jsou překročeny stanovené hodnoty výstražných prahů, spustí se v případě potřeby automaticky alarm. Příslušné subjekty zajistí, aby v případě spuštění alarmu byla včas zahájena kvalifikovaná a vhodná reakce.
3.2.5||Příslušné subjekty uchovávají a zálohují protokoly po předem stanovenou dobu a chrání je před neoprávněným přístupem nebo změnami.
3.2.6||Příslušné subjekty v proveditelném rozsahu zajistí, aby všechny systémy měly synchronizované zdroje času, a aby tak bylo možné propojovat protokoly mezi systémy za účelem vyhodnocení události. Příslušné subjekty vytvářejí a vedou seznam všech aktiv, o kterých mají být vedeny protokoly, a zajistí, aby systémy monitorování a vedení protokolů byly redundantní. Dostupnost systémů monitorování a vedení protokolů se sleduje nezávisle na systémech, které monitorují.
3.2.7||Postupy i seznam aktiv, o kterých mají být vedeny protokoly, se přezkoumávají a v případě potřeby aktualizují pravidelně a po významných incidentech.
##3.3|Oznamování událostí
3.3.1||Příslušné subjekty zavedou jednoduchý mechanismus, který umožní jejich zaměstnancům, dodavatelům a zákazníkům oznamovat podezřelé události.
3.3.2||Příslušné subjekty v případě potřeby informují své dodavatele a zákazníky o mechanismu pro oznamování událostí a pravidelně školí své zaměstnance, jak tento mechanismus používat.
##3.4|Hodnocení a klasifikace událostí
3.4.1||Příslušné subjekty posoudí podezřelé události, aby určily, zda se jedná o incidenty, a pokud ano, určí jejich povahu a závažnost.
3.4.2||Pro účely bodu 3.4.1 postupují příslušné subjekty takto:
3.4.2|a|provedení hodnocení na základě předem stanovených kritérií a na základě roztřídění s cílem určit priority, pokud jde o zamezení šíření incidentu a jeho odstranění;
3.4.2|b|zhodnocení existence opakujících se incidentů podle článku 4 tohoto nařízení jednou za čtvrtletí;
3.4.2|c|přezkoumání příslušných protokolů pro účely hodnocení a klasifikace událostí;
3.4.2|d|zavedení postupu pro propojení a analýzu protokolů a
3.4.2|e|přehodnocení a překlasifikování událostí v případě, že se objeví nové informace, nebo po analýze dříve dostupných informací.
##3.5|Reakce na incident
3.5.1||Příslušné subjekty reagují na incidenty včas a v souladu se zdokumentovanými postupy.
3.5.2||Postupy reakce na incident zahrnují tyto fáze:
3.5.2|a|zamezení šíření incidentu s cílem předejít důsledkům incidentu způsobeným jeho rozšířením;
3.5.2|b|odstranění incidentu, aby se zabránilo jeho pokračování nebo opětovnému výskytu;
3.5.2|c|případně obnova po incidentu.
3.5.3||Příslušné subjekty stanoví komunikační plány a postupy:
3.5.3|a|s týmy pro reakce na počítačové bezpečnostní incidenty (CSIRT) nebo v příslušných případech s příslušnými orgány v souvislosti s oznamováním incidentů;
3.5.3|b|pro komunikaci mezi zaměstnanci příslušného subjektu a pro komunikaci s příslušnými zúčastněnými stranami mimo subjekt.
3.5.4||Příslušné subjekty vedou protokoly o činnostech v rámce reakce na incident v souladu s postupy uvedenými v bodě 3.2.1 a zaznamenávají důkazy.
3.5.5||Příslušné subjekty v plánovaných intervalech testují své postupy reakce na incidenty.
##3.6|Přezkumy po incidentu
3.6.1||V případě potřeby příslušné subjekty provádějí po obnově přezkumy po incidentu. Přezkumy po incidentu musí pokud možno identifikovat hlavní příčinu incidentu a vést ke zdokumentování získaných zkušeností s cílem omezit výskyt a následky incidentů v budoucnu.
3.6.2||Příslušné subjekty zajistí, aby přezkumy po incidentu přispěly ke zlepšení jejich přístupu k bezpečnosti sítí a informací, k opatřením pro ošetření rizik a k postupům pro řešení a odhalování incidentů a reakci na ně.
3.6.3||Příslušné subjekty v plánovaných intervalech přezkoumávají, zda incidenty vedly k přezkumu po incidentu.
#4|Kontinuita podnikání a krizové řízení (čl. 21 odst. 2 písm. c) směrnice (EU) 2022/2555)
##4.1|Plán kontinuity provozu a obnovy provozu po havárii
4.1.1||Pro účely čl. 21 odst. 2 písm. c) směrnice (EU) 2022/2555 příslušné subjekty stanoví a udržují plán kontinuity provozu a obnovy provozu po havárii, který se použije v případě incidentů.
4.1.2||Provoz příslušných subjektů se obnoví v souladu s plánem kontinuity provozu a obnovy provozu po havárii. Plán se zakládá na výsledcích posouzení rizik provedeného podle bodu 2.1 a obsahuje v případě potřeby tyto údaje:
4.1.2|a|účel, oblast působnosti a cílová skupina;
4.1.2|b|úkoly a povinnosti;
4.1.2|c|hlavní kontaktní osoby a (interní a externí) komunikační kanály;
4.1.2|d|podmínky pro aktivaci a deaktivaci plánu;
4.1.2|e|postup obnovy pro operace;
4.1.2|f|plány obnovy pro konkrétní operace, včetně cílů obnovy;
4.1.2|g|požadované zdroje, včetně záloh a redundancí;
4.1.2|h|obnovení činností po dočasných opatřeních a pokračování v těchto činnostech.
4.1.3||Příslušné subjekty provedou analýzu obchodního dopadu, aby posoudily potenciální dopady závažných narušení na jejich obchodní operace, a na základě výsledků analýzy obchodního dopadu stanoví požadavky na zachování provozu pro sítě a informační systémy.
4.1.4||Plán kontinuity provozu a obnovy provozu po havárii se testuje, přezkoumává a v případě potřeby aktualizuje v plánovaných intervalech a po významných incidentech nebo významných změnách operací nebo rizik. Příslušné subjekty zajistí, aby plány zohledňovaly poznatky získané z těchto testů.
##4.2|Správa zálohování a redundance
4.2.1||Příslušné subjekty uchovávají záložní kopie údajů a poskytují dostatečné dostupné zdroje, včetně zařízení, sítí a informačních systémů a zaměstnanců, aby zajistily odpovídající úroveň redundance.
4.2.2||Na základě výsledků posouzení rizik provedeného podle bodu 2.1 a plánu kontinuity provozu stanoví příslušné subjekty plány zálohování, které obsahují tyto skutečnosti:
4.2.2|a|doby obnovy;
4.2.2|b|ujištění, že záložní kopie jsou úplné a správné, včetně konfiguračních dat a údajů uložených v prostředí služby cloud computingu;
4.2.2|c|uložení záložních kopií (online nebo offline) na bezpečném místě nebo místech, která nejsou ve stejné síti jako systém a jsou v dostatečné vzdálenosti, aby nedošlo k poškození v případě havárie v hlavní provozovně;
4.2.2|d|vhodné kontroly fyzického a logického přístupu k záložním kopiím v souladu se stupněm utajení dat;
4.2.2|e|obnovení údajů ze záložních kopií;
4.2.2|f|doby uchovávání na základě obchodních a regulačních požadavků.
4.2.3||Příslušné subjekty provádějí pravidelné kontroly integrity záložních kopií.
4.2.4||Na základě výsledků posouzení rizik provedeného podle bodu 2.1 a plánu kontinuity provozu zajistí příslušné subjekty dostatečnou dostupnost zdrojů alespoň částečnou redundancí těchto zdrojů:
4.2.4|a|sítě a informační systémy;
4.2.4|b|aktiva, včetně zařízení, vybavení a zásob;
4.2.4|c|pracovníci s potřebnou odpovědností, pravomocemi a kompetencemi;
4.2.4|d|vhodné komunikační kanály.
4.2.5||Příslušné subjekty v případě potřeby zajistí, aby sledování a přizpůsobení zdrojů, včetně zařízení, systémů a zaměstnanců, byly řádně podloženy požadavky na zálohování a redundanci.
4.2.6||Příslušné subjekty provádějí pravidelné testování obnovy záložních kopií a redundancí, aby bylo zajištěno, že se na ně lze v podmínkách obnovy spoléhat a že zahrnují kopie, postupy a znalosti k provedení účinné obnovy. Příslušné subjekty zdokumentují výsledky testů a v případě potřeby přijmou nápravná opatření.
##4.3|Krizové řízení
4.3.1||Příslušné subjekty zavedou postup pro krizové řízení.
4.3.2||Příslušné subjekty zajistí, aby postup krizových řízení zahrnoval alespoň tyto prvky:
4.3.2|a|úlohy a odpovědnost zaměstnanců a v případě potřeby dodavatelů a poskytovatelů služeb s uvedením rozdělení úkolů v krizových situacích, včetně konkrétních kroků, které je třeba dodržovat;
4.3.2|b|vhodné komunikační prostředky mezi příslušnými subjekty a příslušnými orgány;
4.3.2|c|uplatňování vhodných opatření k zajištění zachování bezpečnosti sítí a informačních systémů v krizových situacích.
4.3.2|-|Pro účely písmene b) zahrnuje tok informací mezi příslušnými subjekty a příslušnými orgány jak povinná sdělení, jako jsou oznámení o incidentech a související časové plány, tak nepovinná sdělení.
4.3.3||Příslušné subjekty zavedou postup pro správu a využívání informací obdržených od týmů CSIRT nebo v příslušných případech od příslušných orgánů, které se týkají incidentů, zranitelností, hrozeb nebo možných zmírňujících opatření.
4.3.4||Příslušné subjekty plán krizového řízení pravidelně nebo po významných incidentech nebo významných změnách operací či rizik testují, přezkoumávají a v případě potřeby aktualizují.
#5|Bezpečnost dodavatelského řetězce (čl. 21 odst. 2 písm. d) směrnice (EU) 2022/2555)
##5.1|Politika bezpečnosti dodavatelského řetězce
5.1.1||Pro účely čl. 21 odst. 2 písm. d) směrnice (EU) 2022/2555 příslušné subjekty stanoví, zavedou a uplatňují politiku bezpečnosti dodavatelského řetězce, která upravuje vztahy s jejich přímými dodavateli a poskytovateli služeb s cílem zmírnit zjištěná rizika pro bezpečnost sítí a informačních systémů. V politice bezpečnosti dodavatelského řetězce příslušné subjekty určí svou úlohu v dodavatelském řetězci a sdělí ji svým přímým dodavatelům a poskytovatelům služeb.
5.1.2||V rámci politiky bezpečnosti dodavatelského řetězce uvedené v bodě 5.1.1 stanoví příslušné subjekty kritéria pro výběr dodavatelů a poskytovatelů služeb a uzavírání smluv s nimi. Tato kritéria zahrnují:
5.1.2|a|postupy kybernetické bezpečnosti dodavatelů a poskytovatelů služeb, včetně jejich postupů k zajištění bezpečného vývoje;
5.1.2|b|schopnost dodavatelů a poskytovatelů služeb splňovat specifikace v oblasti kybernetické bezpečnosti stanovené příslušnými subjekty;
5.1.2|c|celkovou kvalitu a odolnost produktů a služeb IKT a v nich obsažených opatření pro řízení kybernetických bezpečnostních rizik, včetně rizik a úrovně klasifikace produktů IKT a služeb IKT;
5.1.2|d|schopnost příslušných subjektů diverzifikovat zdroje dodávek a v příslušných případech omezit závislost na dodavateli.
5.1.3||Při vytváření své politiky bezpečnosti dodavatelského řetězce příslušné subjekty v příslušných případech zohlední výsledky koordinovaného posouzení bezpečnostních rizik kritických dodavatelských řetězců provedeného v souladu s čl. 22 odst. 1 směrnice (EU) 2022/2555.
5.1.4||Na základě politiky bezpečnosti dodavatelského řetězce a s přihlédnutím k výsledkům posouzení rizik provedeného podle bodu 2.1 této přílohy příslušné subjekty zajistí, aby jejich smlouvy s dodavateli a poskytovateli služeb, a to v případě potřeby prostřednictvím dohod o úrovni služeb, stanovovaly:
5.1.4|a|požadavky na kybernetickou bezpečnost pro dodavatele nebo poskytovatele služeb, včetně požadavků na bezpečnost při pořizování služeb IKT nebo produktů IKT uvedených v bodě 6.1;
5.1.4|b|požadavky na informovanost, dovednosti a školení a v případě potřeby osvědčení, která se vyžadují od zaměstnanců dodavatelů nebo poskytovatelů služeb;
5.1.4|c|požadavky na ověřování spolehlivosti zaměstnanců dodavatelů a poskytovatelů služeb;
5.1.4|d|povinnost dodavatelů a poskytovatelů služeb bez zbytečného odkladu informovat příslušné subjekty o incidentech, které představují riziko pro bezpečnost sítě a informačních systémů těchto subjektů;
5.1.4|e|právo provést audit nebo právo obdržet auditní zprávy;
5.1.4|f|povinnost dodavatelů a poskytovatelů služeb řešit zranitelnosti, které představují riziko pro bezpečnost sítí a informačních systémů příslušných subjektů;
5.1.4|g|požadavky týkající se subdodávek, a pokud příslušné subjekty subdodávky umožňují, požadavky na kybernetickou bezpečnost subdodavatelů v souladu s požadavky na kybernetickou bezpečnost uvedenými v písmenu a);
5.1.4|h|povinnosti dodavatelů a poskytovatelů služeb při ukončení smlouvy, jako je vyhledání a zničení informací, které dodavatelé a poskytovatelé služeb získali při plnění svých úkolů.
5.1.5||Příslušné subjekty zohlední prvky uvedené v bodech 5.1.2 a 5.1.3 v rámci procesu výběru nových dodavatelů a poskytovatelů služeb, ale i v rámci procesu zadávání zakázek uvedeného v bodě 6.1.
5.1.6||Příslušné subjekty politiku bezpečnosti dodavatelského řetězce přezkoumávají, sledují a vyhodnocují v plánovaných intervalech a v případě, že dojde k významným změnám operací nebo rizik nebo k významným incidentům souvisejícím s poskytováním služeb IKT nebo majícím dopad na bezpečnost produktů IKT od dodavatelů a poskytovatelů služeb, a v případě potřeby jednají v návaznosti na změny postupů kybernetické bezpečnosti dodavatelů a poskytovatelů služeb.
5.1.7||Pro účely bodu 5.1.6 příslušné subjekty:
5.1.7|a|v příslušných případech pravidelně monitorují zprávy o provádění dohod o úrovni služeb;
5.1.7|b|přezkoumávají incidenty týkající se produktů IKT a služeb ICT od dodavatelů a poskytovatelů služeb;
5.1.7|c|posuzují potřebu neplánovaných přezkumů a komplexně dokumentují zjištění;
5.1.7|d|analyzují rizika, která představují změny související s produkty IKT a službami IKT od dodavatelů a poskytovatelů služeb, a v případě potřeby včas přijímají zmírňující opatření.
##5.2|Seznam dodavatelů a poskytovatelů služeb
5.2||Příslušné subjekty vedou a průběžně aktualizují registr svých přímých dodavatelů a poskytovatelů služeb, který obsahuje:
5.2|a|kontaktní místa pro každého přímého dodavatele a poskytovatele služeb;
5.2|b|seznam produktů IKT, služeb IKT a procesů IKT poskytovaných přímým dodavatelem nebo poskytovatelem služeb příslušným subjektům.
#6|Zabezpečení pořizování, vývoje a údržby sítí a informačních systémů (čl. 21 odst. 2 písm. e) směrnice (EU) 2022/2555)
##6.1|Zabezpečení pořizování služeb IKT nebo produktů IKT
6.1.1||Pro účely čl. 21 odst. 2 písm. e) směrnice (EU) 2022/2555 příslušné subjekty stanoví a zavedou procesy řízení rizik vyplývajících z pořizování služeb IKT nebo produktů IKT pro komponenty, které jsou kritické pro bezpečnost sítí a informačních systémů příslušných subjektů a které pocházejí od dodavatelů nebo poskytovatelů služeb, po celou dobu jejich životnosti na základě posouzení rizik provedeného podle bodu 2.1.
6.1.2||Pro účely bodu 6.1.1 procesy uvedené v bodě 6.1.1 zahrnují:
6.1.2|a|bezpečnostní požadavky, které se mají vztahovat na pořizované služby IKT nebo produkty IKT;
6.1.2|b|požadavky týkající se bezpečnostních aktualizací po celou dobu životnosti služeb IKT nebo produktů IKT nebo nahrazení po skončení doby podpory;
6.1.2|c|informace popisující hardwarové a softwarové komponenty používané ve službách IKT nebo produktech IKT;
6.1.2|d|informace popisující zavedené funkce kybernetické bezpečnosti ve službách IKT nebo produktech ICT a konfiguraci potřebnou pro jejich bezpečný provoz;
6.1.2|e|ujištění, že služby IKT nebo produkty IKT splňují bezpečnostní požadavky podle písmene a);
6.1.2|f|metody ověřování, zda dodané služby IKT nebo produkty IKT splňují stanovené bezpečnostní požadavky, a zdokumentování výsledků ověřování.
6.1.3||Příslušné subjekty procesy přezkoumávají a v případě potřeby aktualizují v plánovaných intervalech a při výskytu významných incidentů.
##6.2|Životní cyklus bezpečného vývoje
6.2.1||Před vývojem sítě a informačního systému, včetně softwaru, stanoví příslušné subjekty pravidla pro bezpečný vývoj sítí a informačních systémů a uplatňují je při vývoji sítí a informačních systémů v rámci podniku nebo při zadávání vývoje sítí a informačních systémů externím dodavatelům. Pravidla se vztahují na všechny fáze vývoje, včetně specifikace, návrhu, vývoje, implementace a testování.
6.2.2||Pro účely bodu 6.2.1 příslušné subjekty:
6.2.2|a|provádějí analýzu bezpečnostních požadavků ve fázích specifikace a návrhu jakéhokoli projektu vývoje nebo pořízení realizovaného příslušnými subjekty nebo jejich jménem;
6.2.2|b|uplatňují zásady pro inženýring bezpečných systémů a zásady bezpečného kódování na všechny činnosti spojené s vývojem informačních systémů, jako je podpora kybernetické bezpečnosti již od návrhu a architektury nulové důvěry;
6.2.2|c|stanoví bezpečnostní požadavky týkající se prostředí vývoje;
6.2.2|d|zavádějí a implementují procesy testování bezpečnosti během životního cyklu vývoje;
6.2.2|e|vhodným způsobem vybírají, chrání a spravují údajů o bezpečnostních testech;
6.2.2|f|opravují a anonymizují údaje o testování podle posouzení rizik provedeného podle bodu 2.1.
6.2.3||Při externě zajišťovaném vývoji sítí a informačních systémů příslušné subjekty uplatňují rovněž zásady a postupy uvedené v bodech 5 a 6.1.
6.2.4||Příslušné subjekty v plánovaných intervalech přezkoumají a, je-li to nutné, aktualizují svá pravidla bezpečného vývoje.
##6.3|Správa konfigurace
6.3.1||Příslušné subjekty přijmou vhodná opatření k vytvoření, zdokumentování, zavedení a monitorování konfigurací, včetně bezpečnostních konfigurací hardwaru, softwaru, služeb a sítí.
6.3.2||Pro účely bodu 6.3.1 příslušné subjekty:
6.3.2|a|stanoví a zajistí bezpečnost konfigurací pro svůj hardware, software, služby a sítě;
6.3.2|b|stanoví a zavedou procesy a nástroje pro vynucování stanovených bezpečných konfigurací pro hardware, software, služby a sítě, pro nově instalované systémy i pro systémy v provozu, a to po celou dobu jejich životnosti.
6.3.3||Příslušné subjekty konfigurace přezkoumávají a v případě potřeby aktualizují v plánovaných intervalech nebo při výskytu významných incidentů nebo významných změn operací či rizik.
##6.4|Řízení změn, opravy a údržba
6.4.1||Při řízení změn v sítích a informačních systémech příslušné subjekty uplatňují postupy řízení změn. V příslušných případech musí být takové postupy v souladu s obecnými politikami řízení změn příslušných subjektů.
6.4.2||Postupy uvedené v bodě 6.4.1. se uplatní na vydání, úpravy a mimořádné změny jakéhokoli softwaru a hardwaru při provozu a změnách konfigurace. Postupy zajistí, aby tyto změny byly zdokumentovány a na základě posouzení rizik provedeného podle bodu 2.1 byly před provedením testovány a posouzeny z hlediska možného dopadu.
6.4.3||V případě, že nebylo možné dodržet standardní postupy řízení změn z důvodu mimořádné události, příslušné subjekty zdokumentují výsledek změny a vysvětlení, proč nebylo možné postupy dodržet.
6.4.4||Příslušné subjekty postupy přezkoumávají a v případě potřeby aktualizují v plánovaných intervalech a při významných incidentech nebo významných změnách operací či rizik.
##6.5|Testování bezpečnosti
6.5.1||Příslušné subjekty stanoví, zavedou a uplatňují politiku a postupy pro testování bezpečnosti.
6.5.2||Příslušné subjekty:
6.5.2|a|na základě posouzení rizik provedeného podle bodu 2.1 stanoví potřebu, rozsah, četnost a typ bezpečnostních testů;
6.5.2|b|provádějí bezpečnostní testy podle zdokumentované metodiky testování, která se vztahuje na složky identifikované v analýze rizik jako důležité pro bezpečný provoz;
6.5.2|c|dokumentují typ, rozsah, čas a výsledky testů, včetně posouzení kritičnosti a zmírňujících opatření pro každé zjištění;
6.5.2|d|v případě kritických zjištění uplatní zmírňující opatření.
6.5.3||Příslušné subjekty své politiky testování bezpečnosti přezkoumají a v případě potřeby aktualizují v plánovaných intervalech.
##6.6|Řízení bezpečnostních záplat
6.6.1||Příslušné subjekty stanoví a uplatňují postupy, které jsou v souladu s postupy řízení změn uvedenými v bodě 6.4.1, jakož i s postupy řízení zranitelností, řízení rizik a dalšími příslušnými postupy., a to s cílem zajistit, že:
6.6.1|a|bezpečnostní záplaty se použijí v přiměřené době poté, co začaly být k dispozici;
6.6.1|b|bezpečnostní záplaty se před použitím v produkčních systémech otestují;
6.6.1|c|bezpečnostní záplaty pocházejí z důvěryhodných zdrojů a jejich integrita je kontrolována;
6.6.1|d|v případech, kdy záplata není k dispozici nebo kdy není nepoužita podle bodu 6.6.2, jsou zavedena další opatření a akceptována zbytková rizika.
6.6.2||Odchylně od bodu 6.6.1 písm. a) se příslušné subjekty mohou rozhodnout bezpečnostní záplaty nepoužít, pokud nevýhody použití bezpečnostních záplat převažují nad přínosy pro kybernetickou bezpečnost. Příslušné subjekty každé takové rozhodnutí řádně zdokumentují a zdůvodní.
##6.7|Bezpečnost sítí
6.7.1||Příslušné subjekty přijmou vhodná opatření na ochranu svých sítí a informačních systémů před kybernetickými hrozbami.
6.7.2||Pro účely bodu 6.7.1 příslušné subjekty:
6.7.2|a|v komplexní a aktuální podobě zdokumentují architekturu sítě;
6.7.2|b|určí a uplatní kontrolní mechanismy na ochranu vnitřních síťových domén příslušných subjektů před neoprávněným přístupem;
6.7.2|c|nakonfigurují kontroly, které zabrání přístupům a síťové komunikaci, jež nejsou nutné pro provoz příslušných subjektů;
6.7.2|d|určí a uplatní kontroly vzdáleného přístupu k sítím a informačním systémům, včetně přístupu ze strany poskytovatelů služeb;
6.7.2|e|nevyužijí systémy používané pro správu provádění zásad zabezpečení k jiným účelům;
6.7.2|f|výslovně zakážou nebo deaktivují nepotřebná připojení a služby;
6.7.2|g|v případě potřeby umožní přístup k sítím a informačním systémům příslušných subjektů výhradně prostřednictvím zařízení, která jsou těmito subjekty autorizována;
6.7.2|h|povolí připojení poskytovatelů služeb pouze na základě žádosti o povolení a po stanovenou dobu, například po dobu trvání údržby;
6.7.2|i|zavedou spojení mezi různými systémy pouze prostřednictvím důvěryhodných kanálů, které jsou logicky, kryptograficky nebo fyzicky odděleny od ostatních komunikačních kanálů a zajišťují zaručenou identifikaci jejich koncových bodů a ochranu dat kanálu před modifikací nebo vyzrazením;
6.7.2|j|přijmou prováděcí plán pro úplný přechod na nejnovější generaci komunikačních protokolů síťové vrstvy bezpečným, vhodným a postupným způsobem a zavedou opatření k urychlení tohoto přechodu;
6.7.2|k|přijmou prováděcí plán pro zavedení mezinárodně dohodnutých a interoperabilních moderních standardů pro e-mailovou komunikaci, aby se zabezpečila e-mailová komunikace a zmírnila zranitelnost spojená s hrozbami souvisejícími s elektronickou poštou, a zavedou opatření k urychlení tohoto zavádění;
6.7.2|l|uplatňují osvědčené postupy pro zabezpečení DNS a pro zabezpečení směrování na internetu a hygienu směrování provozu vycházejícího ze sítě a směřujícího do sítě.
6.7.3||Příslušné subjekty tato opatření přezkoumávají a v případě potřeby aktualizují v plánovaných intervalech a při výskytu významných incidentů nebo významných změn operací či rizik.
##6.8|Segmentace sítě
6.8.1||Příslušné subjekty rozdělí systémy na sítě nebo zóny v souladu s výsledky posouzení rizik podle bodu 2.1. Oddělí své systémy a sítě od systémů a sítí třetích stran.
6.8.2||Za tímto účelem příslušné subjekty:
6.8.2|a|zohlední funkční, logické a fyzické vztahy mezi důvěryhodnými systémy a službami, včetně jejich umístění;
6.8.2|b|udělí přístup do sítě nebo zóny na základě posouzení jejich bezpečnostních požadavků;
6.8.2|c|uchovávají systémy, které jsou kritické pro provoz příslušných subjektů nebo pro bezpečnost, v zabezpečených zónách;
6.8.2|d|zavedou ve svých komunikačních sítích demilitarizovanou zónu, která zajistí bezpečnou komunikaci vycházející z jejich sítí nebo směřující do jejich sítí;
6.8.2|e|omezí přístup a komunikaci mezi zónami a uvnitř zón na ty, které jsou nezbytné pro provoz příslušných subjektů nebo pro bezpečnost;
6.8.2|f|oddělí specializovanou síť pro správu sítí a informačních systémů od provozní sítě příslušných subjektů;
6.8.2|g|oddělí kanály pro správu sítě od ostatního provozu v síti;
6.8.2|h|oddělí produkční systémy pro útvary příslušných subjektů od systémů používaných pro vývoj a testování, včetně záloh.
6.8.3||Příslušné subjekty segmentaci sítě přezkoumávají a v případě potřeby aktualizují v plánovaných intervalech a při významných incidentech nebo významných změnách operací či rizik.
##6.9|Ochrana před škodlivým a neautorizovaným softwarem
6.9.1||Příslušné subjekty chrání své sítě a informační systémy před škodlivým a neautorizovaným softwarem.
6.9.2||Za tímto účelem příslušné subjekty zejména zavedou opatření, která odhalí nebo zabrání používání škodlivého nebo neoprávněného softwaru. Příslušné subjekty v případě potřeby zajistí, aby jejich sítě a informační systémy byly vybaveny softwarem pro detekci a reakci, který je pravidelně aktualizován v souladu s posouzením rizik provedeným podle bodu 2.1 a se smluvními ujednáními s poskytovateli.
##6.10|Řešení a zveřejňování zranitelností
6.10.1||Příslušné subjekty získají informace o technických zranitelnostech svých sítí a informačních systémů, vyhodnotí, zda jsou těmto zranitelnostem vystaveny, a přijmou vhodná opatření k řízení těchto zranitelností.
6.10.2||Pro účely bodu 6.10.1 příslušné subjekty:
6.10.2|a|sledují informace o zranitelnostech prostřednictvím vhodných kanálů, jako jsou oznámení týmů CSIRT, příslušných orgánů nebo informace poskytované dodavateli či poskytovateli služeb;
6.10.2|b|v případě potřeby provádějí v plánovaných intervalech kontroly zranitelnosti a zaznamenávají důkazy o výsledcích těchto kontrol;
6.10.2|c|bez zbytečného odkladu řeší zranitelnosti, které příslušné subjekty označily za kritické pro své operace;
6.10.2|d|zajistí, aby jejich postupy pro řešení zranitelností byly v souladu s jejich postupy pro řízení změn, řízení bezpečnostních oprav, řízení rizik a řízení incidentů;
6.10.2|e|stanoví postup pro zveřejňování zranitelností v souladu s platnou vnitrostátní koordinovanou politikou zveřejňování zranitelností.
6.10.3||Pokud je to odůvodněno potenciálním dopadem zranitelnosti, příslušné subjekty vypracují a zavedou plán na její zmírnění. V ostatních případech příslušné subjekty zdokumentují a zdůvodní, proč zranitelnost nevyžaduje nápravu.
6.10.4||Příslušné subjekty přezkoumají a v případě potřeby v plánovaných intervalech aktualizují kanály, které používají pro sledování informací o zranitelnosti.
#7|Politiky a postupy za účelem posouzení účinnosti opatření k řízení kybernetických bezpečnostních rizik (čl. 21 odst. 2 písm. f) směrnice (EU) 2022/2555)
7.1||Pro účely čl. 21 odst. 2 písm. f) směrnice (EU) 2022/2555 příslušné subjekty stanoví, zavedou a uplatňují politiku a postupy za účelem posouzení, zda jsou opatření k řízení kybernetických bezpečnostních rizik přijatá příslušným subjektem účinně prováděna a udržována.
7.2||Politika a postupy uvedené v bodě 7.1. zohledňují výsledky posouzení rizik podle bodu 2.1. a minulé významné incidenty. Příslušné subjekty určí:
7.2|a|jaká opatření pro řízení kybernetických bezpečnostních rizik mají být sledována a měřena, včetně procesů a kontrol;
7.2|b|případně metody monitorování, měření, analyzování a hodnocení, s cílem zajistit platné výsledky;
7.2|c|kdy se má provádět monitorování a měření;
7.2|d|kdo je odpovědný za monitorování a měření účinnosti opatření k řízení kybernetických bezpečnostních rizik;
7.2|e|kdy se mají výsledky monitorování a měření analyzovat a vyhodnocovat;
7.2|f|kdo musí tyto výsledky analyzovat a vyhodnotit.
7.3||Příslušné subjekty politiku a postupy přezkoumávají a v případě potřeby aktualizují v plánovaných intervalech a při významných incidentech nebo významných změnách operací či rizik.
#8|Základní postupy v oblasti kybernetické hygieny a bezpečnostní školení (čl. 21 odst. 2 písm. g) směrnice (EU) 2022/2555)
##8.1|Zvyšování povědomí a základní postupy v oblasti kybernetické hygieny
8.1.1||Pro účely čl. 21 odst. 2 písm. g) směrnice (EU) 2022/2555 příslušné subjekty zajistí, aby si jejich zaměstnanci, včetně členů řídících orgánů, ale i přímí dodavatelé a poskytovatelé služeb byli vědomi rizik, byli informováni o významu kybernetické bezpečnosti a uplatňovali postupy v oblasti kybernetické hygieny.
8.1.2||Pro účely bodu 8.1.1 poskytnou příslušné subjekty svým zaměstnancům, včetně členů řídících orgánů, a v případě potřeby přímým dodavatelům a poskytovatelům služeb v souladu s bodem 5.1.4. program zvyšování informovanosti, který:
8.1.2|a|je naplánován v čase tak, aby se činnosti opakovaly a zahrnovaly nové zaměstnance;
8.1.2|b|bude vytvořen v souladu s politikou bezpečnosti sítí a informací, tematicky zaměřenými politikami a příslušnými postupy bezpečnosti sítí a informací;
8.1.2|c|zahrnuje relevantní kybernetické hrozby, zavedená opatření k řízení kybernetických bezpečnostních rizik, kontaktní místa a zdroje pro další informace a poradenství v otázkách kybernetické bezpečnosti a rovněž postupy v oblasti kybernetické hygieny pro uživatele.
8.1.3||Program zvyšování povědomí se v případě potřeby testuje z hlediska účinnosti. Program zvyšování informovanosti se v plánovaných intervalech aktualizuje a nabízí, a to s přihlédnutím ke změnám postupů v oblasti kybernetické hygieny a k aktuálním hrozbám a rizikům pro příslušné subjekty.
##8.2|Bezpečnostní školení
8.2.1||Příslušné subjekty určí zaměstnance, jejichž funkce vyžadují dovednosti a odborné znalosti v oblasti bezpečnosti, a zajistí, aby pravidelně absolvovali školení v oblasti bezpečnosti sítí a informačních systémů.
8.2.2||Příslušné subjekty vytvoří, zavedou a použijí program školení v souladu s politikou bezpečnosti sítí a informací, tematicky zaměřenými politikami a dalšími příslušnými postupy v oblasti bezpečnosti sítí a informací, který na základě kritérií stanoví potřeby školení pro určité funkce a pozice.
8.2.3||Školení uvedené v bodě 8.2.1 musí být relevantní pro pracovní funkci zaměstnance a musí být posouzena jeho účinnost. Školení by mělo zohledňovat zavedená bezpečnostní opatření a zahrnovat:
8.2.3|a|pokyny týkající se bezpečné konfigurace a provozu sítí a informačních systémů, včetně mobilních zařízení;
8.2.3|b|informování o známých kybernetických hrozbách;
8.2.3|c|školení týkající se chování v případě výskytu bezpečnostních událostí.
8.2.4||Příslušné subjekty vztáhnou školení na zaměstnance, kteří přecházejí na nové pozice nebo funkce vyžadující dovednosti a odborné znalosti v oblasti bezpečnosti.
8.2.5||Program je pravidelně aktualizován a prováděn s přihlédnutím k platným politikám a pravidlům, přiděleným úkolům a odpovědnostem, ale i ke známým kybernetickým hrozbám a technologickému vývoji.
#9|Kryptografie (čl. 21 odst. 2 písm. h) směrnice (EU) 2022/2555)
9.1||Pro účely čl. 21 odst. 2 písm. h) směrnice (EU) 2022/2555 příslušné subjekty stanoví, zavedou a uplatňují politiku a postupy týkající se kryptografie s cílem zajistit přiměřené a účinné používání kryptografie k ochraně důvěrnosti, autenticity a integrity informací v souladu s klasifikací aktiv příslušných subjektů a výsledky posouzení rizik provedeného podle bodu 2.1.
9.2||Politika a postupy uvedené v bodě 9.1 stanoví:
9.2|a|v souladu s klasifikací aktiv příslušných subjektů typ, sílu a kvalitu kryptografických opatření potřebných k ochraně aktiv příslušných subjektů, včetně údajů, které jsou uloženy a předávány;
9.2|b|na základě písmene a) protokoly nebo rodiny protokolů, které mají být přijaty, a dále kryptografické algoritmy, úroveň šifrování, kryptografická řešení a postupy používání, které mají být schváleny a jejichž použití v příslušných subjektech se požaduje, případně v souladu s přístupem založeným na kryptografické agilitě;
9.2|c|přístup příslušných subjektů k řízení klíčů, včetně případných metod pro: i) generování různých klíčů pro kryptografické systémy a aplikace; ii) vydávání a získávání certifikátů veřejných klíčů; iii) distribuci klíčů určeným subjektům, včetně způsobu aktivace klíčů po jejich obdržení; iv) ukládání klíčů, včetně způsobu, jakým oprávnění uživatelé získávají přístup ke klíčům; v) změnu nebo aktualizaci klíčů, včetně pravidel, kdy a jak klíče měnit; vi) nakládání s napadenými klíči; vii) zrušení klíčů včetně způsobu jejich odebrání nebo deaktivace; viii) obnovení ztracených nebo poškozených klíčů; ix) zálohování nebo archivaci klíčů; x) ničení klíčů; xi) vedení protokolů a provádění auditu klíčových činností souvisejících s řízením; xii) nastavení dat pro aktivaci a deaktivaci klíčů, aby se zajistilo, že klíče lze používat pouze po stanovenou dobu v souladu s pravidly organizace pro správu klíčů.
9.3||Příslušné subjekty v plánovaných intervalech přezkoumávají a v případě potřeby aktualizují své zásady a postupy s ohledem na nejnovější poznatky v oblasti kryptografie.
#10|Bezpečnost lidských zdrojů (čl. 21 odst. 2 písm. i) směrnice (EU) 2022/2555)
##10.1|Bezpečnost lidských zdrojů
10.1.1||Pro účely čl. 21 odst. 2 písm. i) směrnice (EU) 2022/2555 příslušné subjekty zajistí, aby jejich zaměstnanci a případně přímí dodavatelé a poskytovatelé služeb porozuměli svým povinnostem týkajícím se bezpečnosti a aby se k jejich dodržování zavázali, a to v návaznosti na poskytované služby a pracovní místa a v souladu s politikou příslušných subjektů v oblasti bezpečnosti sítí a informačních systémů.
10.1.2||Požadavek uvedený v bodě 10.1.1 musí zahrnovat:
10.1.2|a|mechanismy, které zajistí, aby všichni zaměstnanci, případně přímí dodavatelé a poskytovatelé služeb porozuměli standardním postupům v oblasti kybernetické hygieny, které příslušné subjekty uplatňují podle bodu 8.1, a aby je dodržovali;
10.1.2|b|mechanismy, které zajistí, aby si všichni uživatelé s administrátorským nebo privilegovaným přístupem byli vědomi svých úkolů, odpovědností a pravomocí a jednali v souladu s nimi;
10.1.2|c|mechanismy, které zajistí, aby členové řídících orgánů porozuměli svým úkolům, odpovědnostem a pravomocím v oblasti bezpečnosti sítí a informačních systémů a aby jednali v souladu s nimi;
10.1.2|d|mechanismy pro nábor pracovníků majících kvalifikaci pro příslušné funkce, jako jsou ověření referencí, postupy prověřování, ověřování certifikátů nebo písemné testy.
10.1.3||Příslušné subjekty v plánovaných intervalech, nejméně však jednou ročně, přezkoumají zařazení pracovníků na konkrétní funkce uvedené v bodě 1.2 a vyčlenění lidských zdrojů v tomto ohledu. V případě potřeby zařazení aktualizují.
##10.2|Ověření spolehlivosti
10.2.1||Příslušné subjekty v proveditelném rozsahu zajistí, aby se u jejich zaměstnanců a v příslušných případech u přímých dodavatelů a poskytovatelů služeb provádělo ověřování spolehlivosti v souladu s bodem 5.1.4, pokud to vyžadují jejich úkoly, povinnosti a oprávnění.
10.2.2||Pro účely bodu 10.2.1 příslušné subjekty:
10.2.2|a|zavedou kritéria, která stanoví, které úkoly, odpovědnosti a pravomoci mohou vykonávat pouze osoby, jejichž spolehlivost byla ověřena;
10.2.2|b|zajistí, aby ověření spolehlivosti těchto osob uvedené v bodě 10.2.1, které vezme v potaz platné zákony, předpisy a etické zásady úměrně k obchodním požadavkům, ke klasifikaci aktiv podle bodu 12.1, k sítím a informačním systémům, k nimž mají mít přístup, a vnímaným rizikům bylo provedeno před tím, než tyto osoby začnou vykonávat dané úkoly, odpovědnosti a pravomoci.
10.2.3||Příslušné subjekty tuto politiku v plánovaných intervalech přezkoumávají a v případě potřeby aktualizují a v případě potřeby ji aktualizují.
##10.3|Postup při ukončení nebo změně pracovního poměru
10.3.1||Příslušné subjekty zajistí, aby byly smluvně vymezeny a vymáhány odpovědnosti a povinnosti v oblasti bezpečnosti sítí a informačních systémů, které zůstávají v platnosti i po ukončení nebo změně pracovního poměru jejich zaměstnanců.
10.3.2||Pro účely bodu 10.3.1 příslušné subjekty začlení do pracovních podmínek, smlouvy nebo dohody fyzické osoby odpovědnosti a povinnosti, které zůstávají v platnosti i po ukončení pracovního poměru nebo smlouvy, například ustanovení o důvěrnosti.
##10.4|Disciplinární řízení
10.4.1||Příslušné subjekty zavedou, sdělí a udržují disciplinární postup pro řešení porušení politik bezpečnosti sítí a informačních systémů. Tento postup zohledňuje příslušné právní, zákonné, smluvní a obchodní požadavky.
10.4.2||Příslušné subjekty v plánovaných intervalech a v případě potřeby v důsledku právních změn nebo významných změn operací či rizik disciplinární postup přezkoumávají a v případě potřeby aktualizují.
#11|Kontrola přístupu (čl. 21 odst. 2 písm. i) a j) směrnice (EU) 2022/2555)
##11.1|Postup kontroly přístupu
11.1.1||Pro účely čl. 21 odst. 2 písm. i) směrnice (EU) 2022/2555 příslušné subjekty stanoví, zdokumentují a zavedou politiky řízení logického a fyzického přístupu k jejich sítím a informačním systémům na základě obchodních požadavků a požadavků na bezpečnost sítí a informačního systému.
11.1.2||Politiky uvedené v bodě 11.1.1:
11.1.2|a|řeší přístup ze strany osob, včetně zaměstnanců, návštěvníků a externích subjektů, jako jsou dodavatelé a poskytovatelé služeb;
11.1.2|b|řeší přístup prostřednictvím sítí a informačních systémů;
11.1.2|c|zajistí, aby byl přístup udělen pouze uživatelům, kteří byli řádně ověřeni.
11.1.3||Příslušné subjekty tyto politiky přezkoumávají a v případě potřeby aktualizují v plánovaných intervalech a při výskytu významných incidentů nebo významných změn operací či rizik.
##11.2|Správa přístupových práv
11.2.1||Příslušné subjekty poskytují, upravují, odebírají a dokumentují přístupová práva k sítím a informačním systémům v souladu s politikou řízení přístupu uvedenou v bodě 11.1.
11.2.2||Příslušné subjekty:
11.2.2|a|přidělují a odebírají přístupová práva podle zásady „potřeba vědět“, zásady minimálních práv a zásady oddělení funkcí;
11.2.2|b|zajistí, aby byla přístupová práva při ukončení nebo změně pracovního poměru odpovídajícím způsobem upravena;
11.2.2|c|zajistí, aby přístup k sítím a informačním systémům byl autorizován příslušnými osobami;
11.2.2|d|zajistí, aby přístupová práva vhodně řešila přístup třetích stran, jako jsou návštěvníci, dodavatelé a poskytovatelé služeb, zejména omezením rozsahu a doby trvání přístupových práv;
11.2.2|e|vedou registr udělených přístupových práv;
11.2.2|f|používají vedení protokolů pro správu přístupových práv.
11.2.3||Příslušné subjekty v plánovaných intervalech přezkoumávají přístupová práva a upravují je na základě organizačních změn. Příslušné subjekty zdokumentují výsledky přezkumu včetně nezbytných změn přístupových práv.
##11.3|Administrátorské účty a účty pro správu systému
11.3.1||Příslušné subjekty udržují politiky pro správu administrátorských účtů a účtů pro správu systému jako součást politiky řízení přístupu uvedenou v bodě 11.1.
11.3.2||Politiky uvedené v bodě 11.3.1:
11.3.2|a|zavádějí silnou identifikaci, autentizaci, jako je např. vícefaktorová autentizace, a postupy schvalování pro administrátorské účty a účty pro správu systému;
11.3.2|b|zřizují specifické účty, které se budou používat výhradně pro operace správy systému, jako je instalace, konfigurace, správa nebo údržba;
11.3.2|c|v maximální možné míře individualizují a omezují oprávnění pro správu systému;
11.3.2|d|zajistí, aby se účty pro správu systému používaly pouze pro připojení k systémům pro správu systému.
11.3.3||Příslušné subjekty v plánovaných intervalech přezkoumávají přístupová práva administrátorských účtů a účtů pro správu systému, která upravují na základě organizačních změn, a výsledky přezkumu, včetně nezbytných změn přístupových práv, dokumentují.
##11.4|Systémy správy
11.4.1||Příslušné subjekty omezí a řídí používání systémů pro správu systému v souladu s politikou řízení přístupu uvedenou v bodě 11.1.
11.4.2||Za tímto účelem příslušné subjekty:
11.4.2|a|používají systémy pro správu systému pouze pro účely správy systému, a nikoli pro jiné operace;
11.4.2|b|logicky oddělí tyto systémy od aplikačního softwaru, který se nepoužívá pro účely správy systému,
11.4.2|c|chrání přístup k systémům správy pomocí ověřování a šifrování.
##11.5|Identifikace
11.5.1||Příslušné subjekty řídí celý životní cyklus identit sítí a informačních systémů a jejich uživatelů.
11.5.2||Za tímto účelem příslušné subjekty:
11.5.2|a|nastaví jedinečné identity pro sítě a informační systémy a jejich uživatele;
11.5.2|b|spojí identitu uživatelů s jedinou osobou;
11.5.2|c|zajistí dohled nad identitami sítí a informačních systémů;
11.5.2|d|použijí vedení protokolů pro řízení identit.
11.5.3||Příslušné subjekty povolí identitu přidělenou více osobám, například sdílenou identitu, pouze v případě, že je to nezbytné z obchodních nebo provozních důvodů a že jsou tyto případy podrobeny postupu a zdokumentování udělení výslovného souhlasu. Příslušné subjekty zohlední identity přidělené více osobám v rámci řízení rizik v oblasti kybernetické bezpečnosti uvedeném v bodě 2.1.
11.5.4||Příslušné subjekty pravidelně přezkoumávají identity sítí a informačních systémů a jejich uživatelů, a pokud již nejsou potřebné, neprodleně je deaktivují.
##11.6|Ověření
11.6.1||Příslušné subjekty zavedou bezpečné ověřovací postupy a technologie založené na omezení přístupu a politice řízení přístupu.
11.6.2||Za tímto účelem příslušné subjekty:
11.6.2|a|zajistí, aby úroveň ověření odpovídala klasifikaci aktiva, k němuž má být poskytnut přístup;
11.6.2|b|kontrolují přidělování tajných ověřovacích údajů uživatelům a jejich správu postupem, který zajišťuje důvěrnost údajů, což zahrnuje i poskytování poradenství pracovníkům ohledně vhodného zacházení s ověřovacími údaji;
11.6.2|c|vyžadují změnu ověřovacích údajů na počátku, v předem stanovených intervalech a v případě podezření, že tyto údaje byly ohroženy;
11.6.2|d|vyžadují obnovení ověřovacích údajů a zablokování uživatelů po předem stanoveném počtu neúspěšných pokusů o přihlášení;
11.6.2|e|ukončí neaktivní relace po uplynutí předem stanovené doby nečinnosti a
11.6.2|f|vyžadují zvláštní ověřovací údaje pro přístup k administrátorskému přístupu nebo k účtu pro správu systému.
11.6.3||Příslušné subjekty v proveditelném rozsahu používají nejmodernější metody ověřování, a to v souladu se souvisejícím posouzeným rizikem a klasifikací aktiva, k němuž má být poskytnut přístup, a jedinečné ověřovací informace.
11.6.4||Příslušné subjekty v plánovaných intervalech přezkoumávají postupy a technologie ověřování.
##11.7|Vícefaktorová autentizace
11.7.1||Příslušné subjekty zajistí, aby uživatelé byli při přístupu do sítě a informačních systémů subjektů ověřováni pomocí více autentizačních faktorů nebo mechanismů trvalé autentizace, případně v souladu s klasifikací aktiva, k němuž mají mít přístup.
11.7.2||Příslušné subjekty zajistí, aby úroveň ověření odpovídala klasifikaci aktiva, k němuž má být poskytnut přístup.
#12|Správa aktiv (čl. 21 odst. 2 písm. i) směrnice (EU) 2022/2555)
##12.1|Klasifikace aktiv
12.1.1||Pro účely čl. 21 odst. 2 písm. i) směrnice (EU) 2022/2555 příslušné subjekty stanoví stupně utajení všech aktiv, včetně informací, v oblasti působnosti svých sítí a informačních systémů pro požadovanou úroveň ochrany.
12.1.2||Pro účely bodu 12.1.1 příslušné subjekty:
12.1.2|a|stanoví systém stupňů utajení aktiv;
12.1.2|b|přiřadí všem aktivům stupeň utajení, a to na základě požadavků na důvěrnost, integritu, autenticitu a dostupnost, s cílem určit požadovanou ochranu podle jejich citlivosti, kritičnosti, rizika a obchodní hodnoty;
12.1.2|c|uvedou do souladu požadavky na dostupnost aktiv a cíle v oblasti poskytování a obnovy stanovené v jejich plánu kontinuity a obnovy provozu po havárii.
12.1.3||Příslušné subjekty provádějí pravidelné přezkumy stupňů utajení aktiv a v případě potřeby je aktualizují.
##12.2|Zacházení s aktivy
12.2.1||Příslušné subjekty vytvoří, zavedou a uplatňují politiku správného zacházení s aktivy, včetně informací, která je v souladu s jejich politikou bezpečnosti sítí a informací, a sdělí politiku správného nakládání s aktivy všem, kteří aktiva používají nebo s nimi nakládají.
12.2.2||Tato politika:
12.2.2|a|pokrývá celý životní cyklus aktiv, včetně pořízení, používání, uchovávání, přepravy a likvidace;
12.2.2|b|poskytuje pravidla bezpečného používání, bezpečné skladování, bezpečnou přepravu a nevratné vymazání a zničení aktiv.
12.2.2|c|stanoví, že převod se uskuteční bezpečným způsobem v souladu s typem převáděného aktiva.
12.2.3||Příslušné subjekty tuto politiku přezkoumávají a v případě potřeby aktualizují v plánovaných intervalech a při výskytu významných incidentů nebo významných změn operací či rizik.
##12.3|Politika týkající se vyměnitelných médií
12.3.1||Příslušné subjekty stanoví, zavedou a uplatňují politiku správy vyměnitelných paměťových médií a sdělí ji svým zaměstnancům a třetím stranám, které s vyměnitelnými paměťovými médii nakládají v prostorách příslušných subjektů nebo na jiných místech, kde jsou vyměnitelná média připojena k sítím a informačním systémům příslušných subjektů.
12.3.2||Tato politika:
12.3.2|a|stanoví technický zákaz připojení vyměnitelných médií, pokud pro použití neexistují organizační důvody;
12.3.2|b|zajistí, aby bylo zakázáno samospouštění z takových médií a aby byla média před jejich použitím v systémech příslušných subjektů prověřována na přítomnost škodlivého kódu;
12.3.2|c|poskytuje opatření pro zajištění kontroly a ochrany přenosných paměťových zařízení obsahujících data při přepravě a skladování;
12.3.2|d|v případě potřeby stanoví opatření pro použití kryptografických technik s cílem chránit údaje na vyměnitelných paměťových médiích.
12.3.3||Příslušné subjekty tuto politiku přezkoumávají a v případě potřeby aktualizují v plánovaných intervalech a při výskytu významných incidentů nebo významných změn operací či rizik.
##12.4|Soupis aktiv
12.4.1||Příslušné subjekty vypracují a udržují úplný, přesný, aktuální a ucelený soupis svých aktiv. Dohledatelným způsobem zaznamenávají změny položek v soupisu.
12.4.2||Podrobnost soupisu aktiv by měla být na úrovni odpovídající potřebám příslušných subjektů. Soupis obsahuje:
12.4.2|a|seznam operací a služeb a jejich popis;
12.4.2|b|seznam sítí a informačních systémů a dalších souvisejících aktiv podporujících operace a služby příslušných subjektů.
12.4.3||Příslušné subjekty pravidelně přezkoumávají a aktualizují soupis a svá aktiva a dokumentují historii změn.
##12.5|Uložení, vrácení nebo smazání aktiv po ukončení pracovního poměru
12.5||Příslušné subjekty stanoví, zavedou a uplatňují postupy, které zajistí, aby jejich aktiva, která mají zaměstnanci v úschově, byla po skončení pracovního poměru uložena, vrácena nebo smazána, a zdokumentují uložení, vrácení a smazání těchto aktiv. Pokud uložení, vrácení nebo vymazání aktiv není možné, příslušné subjekty zajistí, aby aktiva již neměla přístup do sítě a informačních systémů příslušných subjektů v souladu s bodem 12.2.2.
#13|Environmentální a fyzická bezpečnost (čl. 21 odst. 2 písm. c), e) a i) směrnice (EU) 2022/2555)
##13.1|Podpůrné služby
13.1.1||Pro účely čl. 21 odst. 2 písm. c) směrnice (EU) 2022/2555 příslušné subjekty zabrání ztrátě, poškození nebo ohrožení sítí a informačních systémů nebo přerušení jejich provozu v důsledku selhání a narušení podpůrných služeb.
13.1.2||Za tímto účelem příslušné subjekty v případě potřeby:
13.1.2|a|chrání zařízení před výpadky napájení a dalšími narušeními způsobenými výpadky podpůrných služeb, jako jsou elektřina, telekomunikace, dodávky vody, plynu, kanalizace, ventilace a klimatizace;
13.1.2|b|zváží využití redundance v oblasti veřejných služeb;
13.1.2|c|chrání služby v oblasti elektřiny a telekomunikací, které přenášejí data nebo zásobují sítě a informační systémy, proti přerušení a poškození;
13.1.2|d|sleduje služby uvedené v písmenu c) a oznamuje příslušným interním nebo externím pracovníkům události, které překračují minimální a maximální prahové hodnoty kontroly uvedené v bodě 13.2.2 písm. b) a které ovlivňují tyto služby;
13.1.2|e|uzavírají smlouvy na nouzové dodávky s odpovídajícími službami, například pokud jde o pohonné hmoty pro nouzové zásobování elektřinou;
13.1.2|f|zajišťují trvalou účinnost, sledují, udržují a testují dodávky pro sítě a informační systémy nezbytné pro provoz nabízené služby, zejména v oblasti elektrické energie, regulace teploty a vlhkosti, telekomunikací a internetového připojení.
13.1.3||Příslušné subjekty pravidelně nebo po významných incidentech nebo významných změnách operací či rizik tato ochranná opatření testují, přezkoumávají a v případě potřeby aktualizují.
##13.2|Ochrana před fyzickými a environmentálními hrozbami
13.2.1||Pro účely čl. 21 odst. 2 písm. e) směrnice (EU) 2022/2555 příslušné subjekty na základě výsledků posouzení rizik provedeného podle bodu 2.1 předcházejí následkům událostí, které mají původ ve fyzických a environmentálních hrozbách, jako jsou přírodní katastrofy a jiné úmyslné nebo neúmyslné hrozby, nebo následky těchto událostí omezují.
13.2.2||Za tímto účelem příslušné subjekty v případě potřeby:
13.2.2|a|navrhují a provádějí ochranná opatření proti fyzickým a environmentálním hrozbám;
13.2.2|b|stanoví minimální a maximální prahové hodnoty kontrol pro fyzické a environmentální hrozby;
13.2.2|c|sledují parametry prostředí a oznamují příslušným interním nebo externím pracovníkům události, kdy jsou překračovány minimální a maximální prahové hodnoty kontrol uvedené v písmenu b).
13.2.3||Příslušné subjekty pravidelně nebo po významných incidentech nebo významných změnách operací nebo rizik testují, přezkoumávají a v případě potřeby aktualizují ochranná opatření proti fyzickým a environmentálním hrozbám.
##13.3|Kontrola vnějšího a fyzického přístupu
13.3.1||Pro účely čl. 21 odst. 2 písm. i) směrnice (EU) 2022/2555 příslušné subjekty předcházejí neoprávněnému fyzickému přístupu k sítím a informačním systémům, jejich poškození a zásahům do nich a předešle uvedené sledují.
13.3.2||Za tímto účelem příslušné subjekty:
13.3.2|a|na základě posouzení rizik provedeného podle bodu 2.1 stanoví a používají bezpečnostní zóny s cílem chránit oblasti, kde se nacházejí sítě a informační systémy a další související aktiva;
13.3.2|b|chrání oblasti uvedené v písmenu a) vhodnými kontrolami vstupu a přístupovými body;
13.3.2|c|navrhují a provádějí fyzické zabezpečení kanceláří, místností a zařízení;
13.3.2|d|průběžně monitorují své prostory, zda v nich nedochází k neoprávněnému fyzickému přístupu.
13.3.3||Příslušné subjekty opatření ke kontrole fyzického přístupu testují, přezkoumávají a v případě potřeby aktualizují pravidelně nebo po významných incidentech nebo významných změnách operací nebo rizik.`;
