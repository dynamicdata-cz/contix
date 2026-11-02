/* ============================================================
 * Nápověda a uživatelská příručka (v0.26) – jeden zdroj pro panel „Nápověda“ v aplikaci,
 * úvodní prohlídku a příručku ke stažení (Word / tisk do PDF).
 * Text: jednoduchý Markdown (## nadpis, odstavce, - odrážky, 1. kroky, **tučně**).
 * ============================================================ */

export const HELP_AUDIENCES = ["employee", "gestor", "manager", "admin"] as const;
export type HelpAudience = (typeof HELP_AUDIENCES)[number];
export const HELP_AUDIENCE_LABELS: Record<HelpAudience, string> = {
  employee: "Zaměstnanec",
  gestor: "Gestor a schvalovatel dokumentů",
  manager: "Manažer kybernetické bezpečnosti",
  admin: "Správce systému",
};

export interface HelpTopic {
  id: string;
  title: string;
  /** Pro koho je téma (příručka se skládá podle role). */
  audience: HelpAudience[];
  /** Cesty v aplikaci, na kterých se téma nabídne jako první (prefix). */
  routes: string[];
  /** Modul, bez kterého téma nedává smysl (klíč z MODULES). */
  module?: string;
  summary: string;
  body: string;
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "start",
    title: "Začínáme s CONTIXem",
    audience: ["employee", "gestor", "manager", "admin"],
    routes: ["/"],
    summary: "Přihlášení, menu, výběr společnosti a kde najdete své úkoly.",
    body: `
## Přihlášení
Přihlaste se firemním účtem (tlačítko SSO, pokud ho organizace používá), nebo e-mailem a heslem. Pokud máte zapnuté dvoufázové ověření, zadejte kód z aplikace v telefonu. Po nečinnosti se z bezpečnostních důvodů odhlásíte automaticky.

## Orientace v aplikaci
- **Menu vlevo** obsahuje jen části, ke kterým máte oprávnění – každý uživatel ho vidí jinak.
- **Moje práce** – vše, co máte udělat: dokumenty k seznámení, školení a úkoly s termínem za vaše funkční místa.
- **Dokumenty** – platné politiky, směrnice a postupy organizace.
- **Nahlásit událost** – když si všimnete něčeho podezřelého (ztráta notebooku, neobvyklé chování systému).
- **Nahlásit phishing** – podezřelý e-mail předáte bezpečnostnímu týmu, nejlépe jako soubor .eml (v Outlooku přetáhněte zprávu na plochu). Na odkazy neklikejte a přílohy neotevírejte.
- Tlačítko **Nápověda** (otazník vpravo dole) ukáže postupy k obrazovce, na které právě jste.
- **Rychlé hledání** – klávesy **Ctrl+K** (na Macu **⌘K**) nebo pole **Hledat…** nahoře v menu: napište název nebo kód rizika, aktiva, dodavatele, opatření, incidentu, dokumentu, číslo CVE nebo název stránky a Enterem ji otevřete. Bez zadání ukáže naposledy otevřené záznamy; s AI asistentem nabídne i položení otázky.
- **Filtry seznamů** (rizika, aktiva, opatření, dodavatelé) a vybraná záložka se ukládají do adresy stránky – po návratu z detailu zůstanou a odkaz můžete poslat kolegovi. U rizik, opatření a dodavatelů řadíte kliknutím na záhlaví sloupce a kombinaci filtrů a řazení si uložíte jako **pohled** (i sdílený s kolegy).
- Před smazáním nebo schválením se CONTIX zeptá v potvrzovacím okně (Esc = zrušit). Když ve formuláři zůstanou neuložené změny, při odchodu ze stránky vás upozorní.
- Na telefonu otevřete menu tlačítkem ☰ vlevo nahoře.
- **Vzhled**: v **Můj profil → Vzhled** zvolíte barevný motiv a **světlý, tmavý** nebo **podle systému** režim. Detail rizika, aktiva a opatření má pevnou hlavičku se stavem a akcemi a obsah rozdělený do záložek (Přehled, Zvládání / Testy, Vazby, Úkoly); vybraná záložka je v adrese stránky.

## Vazby mezi záznamy
Navázané záznamy (procesy, rizika, opatření, dodavatelé, aktiva) jsou v detailu klikací – vedou rovnou na jejich detail. Karta **Kde je záznam použit** u aktiva, procesu, rizika, opatření a dodavatele ukazuje opačný směr: které incidenty, změny, plány kontinuity, BIA, AI systémy, činnosti zpracování, audity a jejich zjištění, zprávy a dotazníky dodavatelů, akce plánu zvládání nebo produkty CRA na záznam odkazují. Vidíte jen záznamy, ke kterým máte oprávnění.

## Skupina společností
Pokud CONTIX spravuje více společností, zvolíte v horní části menu společnost, se kterou pracujete. Volba „celá skupina“ ukazuje souhrnné přehledy; nové záznamy se zakládají vždy do jedné konkrétní společnosti.

## Upozornění
CONTIX vám může posílat e-maily nebo zprávy do Teams o blížících se termínech. Souhrn je ve **Moje povinnosti**; číslo u položky v menu ukazuje, kolik úkolů čeká.
`,
  },
  {
    id: "profile",
    title: "Můj profil: heslo a dvoufázové ověření",
    audience: ["employee", "gestor", "manager", "admin"],
    routes: ["/profile"],
    summary: "Změna hesla, zapnutí dvoufázového ověření (MFA) a údaje o účtu.",
    body: `
## Můj profil
Odkaz se jménem vlevo dole otevře **Můj profil** – způsob přihlášení, poslední přihlášení a nastavení zabezpečení účtu.

## Dvoufázové ověření (MFA)
1. Klikněte na **Nastavit MFA**.
2. V telefonu otevřete aplikaci Authenticator (Microsoft, Google…) a naskenujte QR kód.
3. Opište šestimístný kód z aplikace a potvrďte. Uložte si záložní kódy na bezpečné místo.
Při dalším přihlášení zadáte po hesle kód z aplikace. Pro vypnutí MFA je potřeba heslo; o ztraceném telefonu informujte správce, který MFA resetuje.

## Změna hesla
U lokálního účtu zadejte současné a nové heslo. Po změně budete odhlášeni z ostatních zařízení. Firemní účet (SSO) se přihlašuje přes poskytovatele identity (např. Entra ID) – heslo a MFA se tam mění podle pravidel organizace.
`,
  },
  {
    id: "dashboard",
    title: "Přehled: stav kybernetické bezpečnosti",
    audience: ["manager", "admin"],
    routes: ["/"],
    summary: "Co ukazují dlaždice na úvodní obrazovce a jak z nich přejít k řešení.",
    body: `
## Dlaždice oblastí
Úvodní **Přehled** shrnuje stav všech zapnutých oblastí: aktiva a zranitelnosti (kritické, bez podpory OS, v červeném stavu), rizika (nad hranicí bez ošetření, k přehodnocení, akce plánu po termínu), opatření a shoda (míra shody, neúčinné testy, prošlé důkazy), incidenty (otevřené události, hlášení po termínu), audity, dokumentace, školení, kontinuita, dodavatelé a GDPR. Z dlaždic se proklikem dostanete k příslušným záznamům.

## Lhůty a úkoly
Karta **Lhůty a úkoly ze všech oblastí** ukazuje, co je po termínu nebo se blíží – za celou organizaci, ne jen za vás. Vlastní úkoly jsou ve **Moje povinnosti**.

## Vývoj ukazatelů
Karta **Vývoj ukazatelů** ukazuje měsíční historii hlavních čísel – míru shody, nepřijatelná rizika, kritické zranitelnosti, povinnosti a výjimky po termínu, zjištění auditů. CONTIX ukládá jeden snímek za měsíc a společnost (běžný měsíc se průběžně aktualizuje, uzavřené měsíce se nemění); u každého ukazatele je změna proti předchozímu měsíci se slovem zlepšení / zhoršení. Přepínač **Tabulka** zobrazí čísla po měsících. Historie začíná dnem nasazení této verze. Podrobnější vývoj za 12 měsíců je ve **Zprávě pro vedení** (i v tisku a Wordu).

## Návrhy a skupina
**Návrhy záznamů** počítají návrhy AI a Wazuhu čekající na posouzení (najdete je u příslušných záznamů). Při volbě „celá skupina“ ukazuje přehled souhrn za všechny společnosti a míru shody každé z nich podle jejího režimu.
`,
  },
  {
    id: "my",
    title: "Moje práce",
    audience: ["employee", "gestor", "manager"],
    routes: ["/my"],
    summary: "Přehled všeho, co máte udělat, a jak úkol splnit.",
    body: `
## Co tu najdete
Stránka **Moje práce** má záložky: **Moje povinnosti** (níže), **Úkoly a akce** (přehled akcí a úkolů s výchozím filtrem Moje) a **Tým** (lhůty v rozsahu vašich oprávnění).
- **Dokumenty k seznámení** – nové nebo změněné dokumenty, které se týkají vaší funkce. Otevřete dokument, přečtěte ho a potvrďte seznámení.
- **Moje školení** – kurzy, které máte absolvovat, s termínem.
- **Úkoly mých funkčních míst** – termíny, za které odpovídá vaše funkční místo (přezkum dokumentu, akce plánu zvládání rizik, nápravné opatření z auditu, schválení dokumentu…).

## Jak úkol splnit
Klikněte na položku – otevře se přímo místo, kde se úkol plní. Úkol z přehledu zmizí sám, jakmile je hotový (potvrzené seznámení, schválený dokument, uzavřené opatření). Barva ukazuje naléhavost: červeně je po termínu, oranžově se termín blíží. Na záložce **Úkoly a akce** zaškrtněte více úkolů a označte je najednou jako hotové nebo rozpracované.
`,
  },
  {
    id: "docs-read",
    title: "Dokumenty: čtení, seznámení a test",
    audience: ["employee", "gestor", "manager"],
    routes: ["/docs"],
    module: "policies",
    summary: "Jak najít platný dokument, potvrdit seznámení a absolvovat test porozumění.",
    body: `
## Najít dokument
V části **Dokumenty** jsou jen platné (schválené) verze. Hledat můžete v názvu i v textu dokumentů – i bez diakritiky. Dokumenty lze filtrovat podle složek; přepínač **K seznámení** ukáže jen ty, které máte potvrdit.

## Přečíst dokument
- **Číst (PDF)** otevře dokument v prohlížeči s doložkou platnosti (verze, kdo a kdy schválil, účinnost). Vytištěná kopie je neřízená – platnou verzi vždy ověřte v CONTIXu.
- **Stáhnout** stáhne originál (Word, Excel).
- U změněného dokumentu tlačítko **Co se změnilo oproti verzi …** zvýrazní přidaný a odebraný text.

## Potvrdit seznámení
1. Dokument si přečtěte.
2. Pokud má dokument **test porozumění**, odpovězte na otázky. Test můžete opakovat.
3. Klikněte na **Potvrzuji seznámení s verzí …**. Potvrzení se zapíše jako doklad a splní i navázané školení.

## Zeptejte se dokumentace
Je-li funkce zapnutá, nahoře v Dokumentech položte otázku běžnou řečí („Jak dlouhé musí být heslo?“). Odpověď připraví AI na serveru organizace **jen z platných dokumentů, které smíte číst**, a u každého tvrzení uvede číslo zdroje – kliknutím otevřete dokument. Závazné je vždy znění dokumentu.

## Připomínka k dokumentu
Je-li v dokumentu nejasnost nebo chyba, napište **Připomínku** (lze uvést článek). Odpověď gestora uvidíte u připomínky.
`,
  },
  {
    id: "incident-report",
    title: "Nahlášení bezpečnostní události",
    audience: ["employee", "gestor", "manager"],
    routes: ["/incidents", "/phishing"],
    module: "incidents",
    summary: "Co hlásit a jak – rychle a bez obav.",
    body: `
## Co hlásit
Podezřelý e-mail nebo odkaz, ztrátu či krádež notebooku nebo telefonu, neobvyklé chování počítače nebo systému, nepovolený přístup, únik dat, podezření na zranitelnost. Raději nahlaste i drobnost – posouzení je na bezpečnostním týmu.

## Jak nahlásit
1. V menu zvolte **Nahlásit událost**.
2. Popište, co se stalo, kdy a čeho se to týká (zařízení, systém, e-mail).
3. Odešlete. Událost dostane bezpečnostní tým, který ji posoudí a případně vás kontaktuje.

## Podezřelý e-mail (phishing)
Je-li zapnutý SOC, použijte **Nahlásit phishing**: přiložte zprávu jako soubor **.eml** (v Outlooku ji přetáhněte na plochu nebo Soubor → Uložit jako) a do poznámky napište, zda jste klikli na odkaz, otevřeli přílohu nebo zadali heslo – heslo pak hned změňte. Bezpečnostní tým uvidí jen hlavičky, odkazy a názvy příloh, ne text zprávy. Nahlásí-li stejný e-mail víc kolegů, spojí se do jednoho hlášení.

## Co nedělat
Na podezřelý e-mail neodpovídejte a neotvírejte přílohy. Zařízení, u kterého máte podezření na napadení, nevypínejte, ale odpojte od sítě a řiďte se pokyny bezpečnostního týmu.
`,
  },
  {
    id: "training",
    title: "Školení a povědomí",
    audience: ["employee", "manager"],
    routes: ["/awareness"],
    module: "awareness",
    summary: "Jak zjistíte, která školení máte absolvovat, a jak se zapisuje absolvování.",
    body: `
## Moje školení
Ve **Moje povinnosti** vidíte kurzy, které máte absolvovat, a jejich termín. Kurzy typu **Seznámení s dokumentem** splníte potvrzením seznámení s dokumentem (případně s testem). Prezenční školení zapisuje organizátor.

## Pro manažera bezpečnosti
V části **Povědomí a školení** založíte kurz (forma, periodicita, okruh osob), plánujete termíny a zapisujete účast. Kurz navázaný na dokument se může opakovat při každé nové verzi dokumentu. Přehled absolvování slouží jako doklad dle § 10 vyhlášky.
`,
  },
  {
    id: "dms-gestor",
    title: "Gestor: příprava nové verze dokumentu",
    audience: ["gestor", "manager"],
    routes: ["/policies"],
    module: "policies",
    summary: "Nová verze, šablona, úpravy ve Wordu, rezervace a předložení ke kontrole.",
    body: `
## Role v oběhu dokumentu
- **Gestor** připravuje verze a odpovídá za obsah a přezkum dokumentu.
- **Vlastník procesu** věcně kontroluje předloženou verzi (není-li určen, krok se přeskočí).
- **Schvalovatel** verzi schvaluje.
Role se přidělují funkčním místům – při personální změně stačí změnit obsazení místa.

## Nová verze
1. V detailu dokumentu v kartě **Verze a schvalování** klikněte na **Nová verze** a zadejte číslo verze a popis změny.
2. Připravte soubor: **Ze šablony…** (Word s firemní hlavičkou a vyplněným označením, názvem, verzí a rolemi), **Nahrát soubor** (vlastní Word / PDF), nebo **Upravit ve Wordu** (otevře soubor v desktopovém Wordu, uložení Ctrl+S se zapíše do CONTIXu).
3. Text lze vložit i přímo do CONTIXu (**Upravit text a údaje**).

## Úpravy a rezervace
**Rezervovat k úpravě** zamkne návrh pro ostatní. Po úpravě klikněte na **Vrátit po úpravě** – nahrajete upravený soubor jako novou revizi, nebo jen uvolníte rezervaci (při úpravě ve Wordu jsou změny už uložené). Starší revize souborů zůstávají v historii.

## Předložení
Klikněte na **Předložit ke kontrole** (nebo **ke schválení**). Verze se zamkne a jde vlastníkovi procesu, pak schvalovateli. Vrácenou verzi poznáte podle žlutého pruhu s důvodem – upravte ji a předložte znovu.

## Systémy řízení a obecné předpisy
Každý dokument patří do **systému řízení / oblasti**: bezpečnost informací (ISMS), kvalita (ISO 9001), životní prostředí, BOZP, ochrana osobních údajů, kontinuita nebo obecné vnitřní předpisy (organizační řád, HR, finance…). Kontroly náležitostí podle § 6 vyhlášky a oddíly vyhlášky se uplatní jen u ISMS (u společnosti v režimu nižších povinností podle vyhlášky 410). Ostatní dokumenty se navazují na požadavky norem (ISO 9001, ISO 27001, DORA…) v kartě **Vazby dokumentu**. V záložce **Pokrytí** zvolíte rámec a uvidíte, které kapitoly mají platnou dokumentaci. Seznam dokumentů lze filtrovat podle systému řízení.

## Hromadný import dokumentace
Na stránce **Správa dokumentace** v záložce **Hromadný import** nahrajte ZIP archiv s tabulkou metadat (CSV nebo XLSX: ID, Název, Druh, Klasifikační stupeň, Gestor, Vlastník procesu, Schvalovatel, Právní vazba, Přezkum, Nadřazený dokument, Verze, Soubor) a se soubory dokumentů. **Načíst náhled** ukáže, co se založí, chyby a soubory, které nebyly nalezeny. Role z tabulky přiřaďte funkčním místům (navrhují se podle shody názvu). Volitelné sloupce **Systém řízení** (např. „Kvalita (ISO 9001)“) a **Požadavky** (ID požadavků, např. iso9001:7.5; iso27001:A.5.15; dora:6). **Importovat** založí dokumenty jako návrhy s verzí a souborem, nastaví oddíly vyhlášky podle právní vazby (podle režimu společnosti 409 / 410), interval přezkumu a nadřazené dokumenty. Dokumenty se stejným označením, které už existují, se přeskočí. Schválení pak probíhá běžným oběhem.

## Vazby dokumentu
V kartě **Vazby dokumentu** nastavíte **nadřazený dokument** (např. směrnice → politika; podřízené dokumenty se vypíšou automaticky), **související dokumenty** (vazba je obousměrná), **požadavky předpisů** (konkrétní ustanovení vyhlášky, ZKB, ISO…), a dále **procesy, aktiva, rizika a dodavatele**, kterých se dokument týká. Uloží se tlačítkem **Uložit**. Navázané dokumenty se pak zobrazí i na kartě procesu, aktiva, rizika, dodavatele a opatření a v posouzení požadavku v prohlášení o aplikovatelnosti.

## Po schválení
Dokument je platný, objeví se zaměstnancům v Dokumentech a dotčeným osobám přijde úkol k seznámení. Připomínky zaměstnanců vyřizujete v kartě **Připomínky** (přijmout / nepřijmout s vyjádřením). Pravidelný přezkum bez změny potvrdíte tlačítkem **Přezkoumáno beze změny**.
`,
  },
  {
    id: "infoservice",
    title: "Informační servis NÚKIB",
    audience: ["gestor", "manager"],
    routes: ["/infoservice"],
    module: "legislation",
    summary: "Aktuality, varování a upozornění na zranitelnosti z RSS NÚKIB, statistiky nahlášených incidentů a stav Národního MISP.",
    body: `
## Co stránka ukazuje
**Informační servis NÚKIB** (v menu nahoře u Přehledu) sbírá na jedno místo informace regulátora: **aktuality z RSS** hlavního webu NÚKIB (případně dalších kanálů – RSS Portálu NÚKIB, SK-CERT, BSI), **statistiky nahlášených incidentů** z otevřených dat NÚKIB a **stav napojení na Národní MISP**. CONTIX zdroje jen stahuje (GET) – nic neodesílá.

## Aktuality a varování
Položky se podle názvu třídí na **varování**, **upozornění na zranitelnost**, **přehledy a zprávy**, **metodiky a doporučení** a ostatní **aktuality**. U položky zaznamenáte **posouzení** za aktivní společnost – že jste se s informací seznámili a co z ní plyne (např. „netýká se nás“, „aktualizováno“, „riziko R-12 přehodnoceno“). **Varování NÚKIB** je povinná osoba povinna zohlednit v hodnocení rizik – neposouzená varování ukazuje první ukazatel. Posouzení se zapisuje do auditního logu.

## Posouzení dopadu
Varování a upozornění NÚKIB nejsou incident – nic se nestalo; jsou to **informace o hrozbě**, které je třeba posoudit a zohlednit v analýze rizik. **Posoudit** otevře posouzení za aktivní společnost: **stav** (posuzuje se → netýká se / dotčeno – řeší se → vyřešeno), závěr, **odpovědné funkční místo a termín** (objeví se v Mých povinnostech) a **dotčená aktiva**. **Navrhnout podle evidence** najde aktiva, u kterých je CVE ze zprávy mezi zranitelnostmi, nebo jejichž software, OS či výrobce odpovídá produktu ze zprávy – přidejte jen opravdu dotčená. Z posouzení lze jedním klikem **vytvořit riziko** (scénář s odkazem na varování a dotčenými aktivy), **úkol** (např. aktualizace) a – jen při známkách zneužití – **bezpečnostní událost** v incidentech; vazby jsou vidět u položky. Na detailu aktiva je karta s varováními, která se ho týkají. Varování a upozornění za období s výsledkem posouzení jsou vstupem zprávy o hodnocení rizik (relevantní hrozby) a přezkumu ISMS.

## Vydavatelé a země
U kanálu ve Zdrojích nastavíte **vydavatele** (NÚKIB, SK-CERT, CERT.at, BSI…) a **zemi**. Společnost vidí kanály bez země, „EU“ a své země podle regulatorního profilu (slovenská dcera SK-CERT, česká NÚKIB); volba „i jiné země“ ukáže vše, výběr vydavatele třídí seznam.

## Kanály v jiných jazycích a zdroje bez RSS
Druh položky se rozpozná z názvu česky, slovensky, německy i anglicky (Warnung, Sicherheitslücke, Schwachstelle, vulnerability…). U kanálu lze nastavit **druh nerozpoznaných položek** – např. u kanálu CERT.at „Warnungen“ = varování. Zdroj bez kanálu RSS (např. CSIRT.CZ) přidáte s formátem **webová stránka s novinkami**: adresa = stránka s výpisem novinek, **začátek cesty odkazů** = část adresy, kterou začínají odkazy na jednotlivé novinky (u CSIRT.CZ „/cs/kyberbezpecnost/aktualne-z-bezpecnosti/“). CONTIX z ní vezme jen nadpisy, odkazy a datum; když web změní vzhled, zobrazí se chyba zdroje.

**Hromadně z PDF** (karta statistik): vyberete až 36 PDF přehledů NÚKIB, model navrhne čísla pro každý postupně a uloží se jen vybrané řádky (bez varování jsou předvybrané).

## Statistiky incidentů
Graf ukazuje nahlášené incidenty podle klasifikace ENISA za posledních 12 zveřejněných měsíců a srovnání s předchozím rokem. Zdrojem je repozitář NUKIB/incidents-opendata (soubor data.csv); repozitář je od března 2025 archivovaný, novější měsíční přehledy NÚKIB zveřejňuje v aktualitách.

**Doplnit měsíc:** aktuální čísla jsou jen v měsíčních přehledech „Kybernetické incidenty pohledem NÚKIB“ (PDF). Tlačítkem **Doplnit měsíc** opíšete počty podle klasifikace ENISA a podle závažnosti; ruční údaje nahradí otevřená data téhož měsíce a v grafu jsou označené ✎ (kliknutím na měsíc je upravíte). Je-li zapnutý AI asistent a převodní služba PDF, **Navrhnout čísla** stáhne PDF přehledu z aktuality NÚKIB (nebo použije nahraný soubor), převede ho na text a model navrhne počty – nic se neuloží, čísla zkontrolujte s PDF (grafy model nemusí přečíst správně) a uložte. Stahuje se jen z hostitelů nastavených kanálů RSS.

## Národní MISP
Regulované subjekty získají přístup do Národního MISP na Portálu NÚKIB. Adresu instance a API klíč zadáte v **SOC → Zdroje → MISP** – IOC se pak stahují a porovnávají s alerty. Karta ukazuje jen stav napojení (bez klíčů).

## Zdroje a server bez internetu
Ve **Zdrojích** (správce) nastavíte kanály RSS / Atom, adresu otevřených dat a automatické stahování (výchozí každých 6 h). Server bez přístupu k internetu: soubor RSS nebo CSV stáhněte na jiném počítači a nahrajte ho ručně.
`,
  },
  {
    id: "legislation",
    title: "Legislativa: sledování předpisů a posouzení změn",
    audience: ["gestor", "manager"],
    routes: ["/legislation", "/legislation/acts/$actId", "/legislation/reviews/$reviewId"],
    module: "legislation",
    summary: "Sledované předpisy z e-Sbírky a EUR-Lex, nová znění, rozdíly, posouzení dopadu, dotčené požadavky a úkoly.",
    body: `
## Sledované předpisy
V části **Legislativa** tlačítkem **Přidat předpis** přidáte předpis číslem (např. **264/2025 Sb.**) nebo stálou URL / ELI a určíte **odpovědné funkční místo**, které posuzuje změny. Doporučené předpisy (ZKB a vyhlášky 408–410/2025) vyberete z nabídky; normy a interní předpisy přidáte v záložce **Ručně**. Souhrn nahoře ukazuje změny k posouzení, úkoly po termínu a nejbližší účinnost novely. CONTIX jednou denně zkontroluje v e-Sbírce aktuální znění a uloží text po fragmentech (paragrafy, odstavce, písmena), zdrojový odkaz, datum účinnosti a datum stažení. Tlačítko **Zkontrolovat nyní** v detailu předpisu kontrolu spustí hned.

Znění se stahují z **otevřených dat e-Sbírky** (bez registrace, aktualizace denně); kanál RSS „Změny v e-Sbírce“ navíc spustí kontrolu hned po zveřejnění nového znění a upozorní na nastavené **datum zrušení** předpisu. Pokud správce nastaví přístupový klíč REST API e-Sbírky (registrace u Ministerstva vnitra), použije se API. Sleduje se nejnovější vyhlášené znění – i s budoucí účinností, takže novelu posoudíte s předstihem (u předpisu se zobrazí „nové znění účinné od …“).

Když otevřená data text znění nevrátí, CONTIX ho přečte z **webu e-Sbírky** (záloha, bez klíče); v detailu předpisu je vidět, odkud text pochází. Přepnutí zdroje u stejného znění nezaloží změnu ani posouzení a rozdíl nového znění se počítá proti staršímu znění ze stejného zdroje. Správce může pod seznamem předpisů zvolit **Zdroj textu**: automaticky, jen otevřená data, web e-Sbírky nebo REST API. Čte-li se text ze zálohy déle než týden, upozorní na to Provoz.

## Předpisy EU (EUR-Lex)
V záložce **Předpisy EU** přidáte nařízení nebo směrnici EU číslem **CELEX** (např. **32022L2555** = NIS2), odkazem z EUR-Lex nebo ELI; doporučené předpisy (NIS2 a prováděcí nařízení 2024/2690, DORA, GDPR, AI Act, CRA, eIDAS, CER) vyberete z nabídky. Text se stahuje bez registrace z úložiště **CELLAR Úřadu pro publikace EU** v češtině nebo angličtině (jazyk zvolíte při přidání; každý jazyk je samostatně sledovaný předpis). Sleduje se **nejnovější konsolidované znění** (i s budoucím datem), u předpisů bez konsolidace původní znění z Úředního věstníku. Text se rozdělí na **články, odstavce a body příloh**, kontrola probíhá jednou denně a nové znění založí posouzení stejně jako u e-Sbírky. U nařízení DORA, směrnice NIS2 a prováděcího nařízení 2024/2690 se změněné články a body přílohy propojí s požadavky rámců DORA a NIS2; konec platnosti předpisu se zobrazí u stavu.

Agentura **ENISA** vydává doporučení a metodiky, ne právní předpisy, a strojově čitelný kanál nenabízí – důležité dokumenty ENISA zatím veďte jako ručně vedený předpis.

## Ručně vedené předpisy a normy
Normy chráněné autorským právem (ISO/IEC 27001, ISO 9001…) nebo předpisy mimo Sbírku založíte jako **ručně vedený předpis** a vložíte znění (Word, ODT, text). Text se rozdělí podle nadpisů (§, Čl., číslované kapitoly) a zůstává jen ve vaší společnosti. Nové znění se porovná s předchozím stejně jako u e-Sbírky.

## Posouzení změny
Při novém znění vznikne **změna k posouzení** s termínem (14 dní) a odpovědná osoba ji uvidí v **Moje povinnosti**. V detailu je **rozdíl** po fragmentech (zvýrazněná slova), **dotčené požadavky** CONTIXu, **opatření** a **dokumenty**, které na ně vedou. Tlačítkem **Navrhnout pomocí AI** připraví lokální model shrnutí změny a návrh úkolů – jsou to jen návrhy, které potvrdíte. Posouzení (míra dopadu a zdůvodnění) potvrzuje odpovědná osoba tlačítkem **Potvrdit posouzení**; evidence uchovává, kdo a kdy změnu posoudil.

## Úkoly
Ke změně zakládáte úkoly (např. upravit směrnici), volitelně s vazbou na dokument nebo požadavek, odpovědným místem a termínem. Změnu lze **uzavřít**, až jsou úkoly splněné nebo zrušené. Přehled všech úkolů je v záložce **Úkoly**.

## Skóre dokumentu vůči požadavkům
V detailu dokumentu (Správa dokumentace) funkce AI **Skóre dokumentu vůči požadavkům a náměty ke zlepšení** porovná text dokumentu s navázanými požadavky, spočítá skóre pokrytí a navrhne zlepšení; přijaté náměty se zapíší jako připomínky k dokumentu.
`,
  },
  {
    id: "languages",
    title: "Jazykové verze",
    audience: ["admin"],
    routes: ["/admin/languages"],
    summary: "Jazyk ovládání, výchozí jazyk organizace a přidání dalšího jazyka bez nové verze aplikace.",
    body: `
## Volba jazyka
Každý uživatel si jazyk zvolí v **Můj profil → Jazyk**. Kdo jazyk nezvolí, vidí **výchozí jazyk organizace**, který nastavíte v **Administrace → Jazyky**. Na přihlašovací obrazovce lze jazyk přepnout dole pod formulářem.

## Přidání dalšího jazyka
1. V **Administrace → Jazyky** zadejte kód jazyka (např. de, uk, sk, sr-Latn) a stáhněte **šablonu** – tabulku se sloupci key, cs, en a sloupcem pro překlad.
2. Doplňte překlady do posledního sloupce (Excel, LibreOffice nebo překladatelský nástroj). Texty v složených závorkách, např. {n} nebo {name}, ponechte beze změny.
3. Tabulku nahrajte tlačítkem **Nahrát**, vyplňte název jazyka a náhradní jazyk. Nepřeložené texty se zobrazí v náhradním jazyce.

Nápovědu lze přeložit v balíčku JSON (vzorem je anglický balíček ke stažení). U každého jazyka vidíte, kolik procent textů je přeloženo.

## Co se nepřekládá
Texty českých předpisů (zákon, vyhlášky) zůstávají česky – závazné je jen české znění. Data zadaná uživateli (názvy dokumentů, rizik…) se zobrazují tak, jak byla zadána.
`,
  },
  {
    id: "dms-approver",
    title: "Vlastník procesu a schvalovatel: kontrola a schválení",
    audience: ["gestor", "manager"],
    routes: ["/policies"],
    module: "policies",
    summary: "Jak zkontrolovat, vrátit nebo schválit předloženou verzi.",
    body: `
## Kde najdete dokumenty ke kontrole
Ve **Moje povinnosti** („Kontrola / schválení dokumentu“), v Dokumentech v kartě **Moje role ve schvalování** a v e-mailovém upozornění.

## Kontrola
1. Otevřete dokument a v kartě **Verze a schvalování** si přečtěte verzi (PDF s vodoznakem NÁVRH, nebo originál).
2. **Porovnat s …** ukáže změny oproti předchozí verzi.
3. Vlastník procesu: **Věcně v pořádku – ke schválení**, nebo **Vrátit** s uvedením, co upravit.
4. Schvalovatel: **Schválit**, nebo **Vrátit**. Schválením se verze stane platnou a předchozí se označí jako nahrazená.

Každý krok se zapíše do historie verze (kdo, kdy, s jakou poznámkou).
`,
  },
  {
    id: "dms-admin",
    title: "Správa dokumentace: složky, šablony, okruh osob, skartace",
    audience: ["manager", "admin"],
    routes: ["/policies"],
    module: "policies",
    summary: "Struktura dokumentace, číslování, šablony Wordu, dotčené osoby a skartační lhůty.",
    body: `
## Nový dokument
**+ Dokument** – vyplňte název, druh, složku, klasifikaci a funkční místa gestora, vlastníka procesu a schvalovatele. Označení může zůstat prázdné – přidělí se automaticky podle prefixu složky (např. SM-ISMS-003) nebo druhu dokumentu. Druh **Rozhodnutí** (označení RO-…) slouží pro rozhodnutí vedení – jmenování do rolí, určení odpovědností, schválení přístupu k řízení rizik apod.; prochází stejným schvalovacím oběhem a dotčené osoby se s ním mohou seznámit.

## Složky
Panel **Složky** vlevo: tlačítko pro novou složku, tužka pro úpravu. Složka může mít prefix označení; platí i pro podsložky. Smazat lze jen prázdnou složku.

## Šablony
Záložka **Šablony** – nahrajte Word (.docx / .dotx) s firemní hlavičkou a značkami {{kod}}, {{nazev}}, {{verze}}, {{gestor}}, {{schvalovatel}}, {{datum}}… Seznam značek je na záložce. Šablonu lze omezit na druh dokumentu.

## Dotčené osoby a seznámení
V kartě **Dotčené osoby a seznámení** určete okruh (všichni, útvary, funkční místa, bezpečnostní role, vedení). Lhůta na seznámení běží od schválení verze; přehled ukazuje, kdo už potvrdil. Volitelně test porozumění a navázané školení (opakování při nové verzi).

## Skartace
U dokumentu je skartační znak (A archiválie, S skartace, V výběr) a lhůta. Lhůta začíná 1. ledna roku po zrušení dokumentu. Záložka **Skartace** ukazuje stav; po uplynutí lhůty stáhněte **Balíček (ZIP)** a dokument skartujte nebo předejte do archivu s číslem protokolu.
`,
  },
  {
    id: "organization",
    title: "Organizace: útvary a funkční místa",
    audience: ["manager", "admin"],
    routes: ["/organization"],
    module: "organization",
    summary: "Organizační struktura, funkční místa, jejich obsazení a bezpečnostní role.",
    body: `
## Proč funkční místa
Odpovědnost v CONTIXu (vlastník procesu a rizika, gestor a schvalovatel dokumentu, RACI, odpovědnost za akce) se přiděluje **funkčnímu místu**, ne konkrétnímu člověku. Při personální změně stačí změnit obsazení místa – úkoly, upozornění a role v oběhu dokumentů přejdou na nového držitele.

## Útvary
Záložka **Struktura**: **Nový útvar** (název, zkratka, typ, nadřízený útvar, popis působnosti). Útvary lze vnořovat. Smazáním útvaru se smažou i jeho funkční místa – nejdřív zkontrolujte, kde jsou použita.

## Funkční místa
**Nové funkční místo** – název, útvar, náplň, zda jde o vedoucího útvaru, držitelé (uživatelé) a **bezpečnostní role** (manažer, architekt a auditor kybernetické bezpečnosti, výbor…). Tlačítko **Kde je použito** otevře stránku místa: držitele, vše, co místo vlastní (procesy, rizika, opatření, dokumenty, úkoly, incidenty, audity, plány kontinuity, AI systémy, produkty CRA…), a role RACI v krocích procesů.

## Předání při odchodu
Na stránce funkčního místa tlačítko **Předat odpovědnost** přesune vybrané druhy záznamů na jiné místo téže společnosti (např. při odchodu nebo reorganizaci). Nabízí se jen druhy, ke kterým máte oprávnění k zápisu; předání se zapíše do auditního logu i s poznámkou. Pokud jde jen o výměnu člověka, stačí změnit **držitele** místa.

## Přehledy
Záložky **Vlastník procesů**, **Vlastník rizik** a **RACI v krocích procesů** ukazují, za co jednotlivá místa odpovídají – vhodné pro kontrolu, že nic nezůstalo bez odpovědnosti. Okruh dotčených osob u dokumentů a školení se vyhodnocuje podle útvarů, míst a bezpečnostních rolí.
`,
  },
  {
    id: "processes",
    title: "Procesy: procesní mapa, karta, RACI a BPMN",
    audience: ["manager"],
    routes: ["/processes"],
    module: "processes",
    summary: "Evidence procesů, kroky s RACI, diagram BPMN, verze a vazby na aktiva, rizika a dokumenty.",
    body: `
## Procesní mapa
Seznam je rozdělen na **řídicí**, **hlavní (klíčové)** a **podpůrné** procesy. **Nový proces** – název, typ, nadřazený proces, vlastník (funkční místo) a garantující útvar. Držitel funkčního místa vlastníka může svůj proces upravovat.

## Procesní karta a kroky
- **Procesní karta** – účel a cíl, hranice procesu, spouštěč, vstupy a výstupy, měřítka výkonnosti (KPI), legislativa, kritičnost.
- **Kroky procesu** – zdroj pravdy o procesu: popis činnosti, odpovědnost (**matice RACI** na funkční místa), systémy, lhůta a frekvence. Pořadí měníte šipkami.
- **Aktiva a dokumenty** – aktiva, na kterých proces stojí (pro BIA a dědění CIA), a navázané dokumenty. **Rizika procesu** se zakládají a spravují v registru rizik.

## Diagram BPMN
Záložka **Diagram BPMN** vygeneruje diagram z kroků. Lze ho ručně upravit a uložit, stáhnout (BPMN / obrázek), nebo úlohy z diagramu doplnit do kroků. Uložený diagram lze zahodit – pak se znovu zobrazuje diagram z kroků.

## Verze procesu
**Uložit verzi** vytvoří snímek procesu s popisem změny; verze se předkládá ke schválení. Schválené verze nelze mazat a lze je porovnat s jinou verzí nebo s aktuálním stavem.
`,
  },
  {
    id: "assets",
    title: "Aktiva a zranitelnosti",
    audience: ["manager", "admin"],
    routes: ["/assets", "/vulnerabilities", "/discovery"],
    module: "assets",
    summary: "Evidence primárních a podpůrných aktiv, načtení z Wazuhu, semafor zranitelností.",
    body: `
## Detail zranitelnosti a postup odstranění
Kliknutím na označení CVE (v seznamu zranitelností, u aktiva nebo v plánu oprav) otevřete **detail zranitelnosti**: priorita, CVSS, katalog CISA KEV a EPSS, popis, všechny výskyty v organizaci s termínem opravy a **postup odstranění podle operačního systému** – příkaz správce balíčků (apt, dnf/yum, zypper, apk, pacman) ke zkopírování a příkaz k ověření verze; u Windows odkaz na kumulativní aktualizaci. Tlačítko **Připravit rozbor** (AI asistent) doplní vysvětlení, dopad, zneužitelnost, kroky odstranění, dočasná opatření a ověření. Do modelu jdou jen údaje o CVE, balíčcích, verzích a operačních systémech – nikdy názvy aktiv ani osob. Rozbor se uloží k CVE a vidí ho celý tým; verze a čísla aktualizací vždy ověřte u výrobce.

## Primární a podpůrná aktiva
Primární aktiva jsou informace a služby (co chráníme), podpůrná aktiva jsou servery, aplikace, sítě a zařízení, na kterých stojí. Vazby mezi nimi určují, jak se dědí hodnocení důvěrnosti, integrity a dostupnosti.

## Sdílená aktiva skupiny
V holdingu může aktivum (např. společný ERP, datové centrum nebo síť) sloužit více společnostem. V detailu aktiva tlačítkem **Sdílení** vyberete společnosti skupiny, se kterými je aktivum sdílené: vidí ho ve svém seznamu aktiv (štítek „sdílené z …“) a mohou ho použít v rizicích, BIA, procesech a opatřeních. Aktivum dál patří své (vlastní) společnosti – upravit, přesunout nebo smazat ho může jen ona; ostatní ho vidí jen pro čtení.

## Graf vazeb aktiv
**Aktiva → Graf vazeb** zobrazí aktiva ve **vrstvách**: procesy, primární aktiva (služby, informace), aplikace a data, infrastruktura a koncová zařízení, síť a bezpečnostní prvky, lidé, dodavatelé a prostory. Šipka vede od uzlu k tomu, na čem závisí: primární aktivum na podpůrném, proces na aktivu a **technické závislosti** (běží na, využívá, síťově přes, umístěno v, zálohováno na), které přidáte v detailu uzlu. Vrstvy a druhy vazeb lze vypínat, uzly **obarvit** podle stavu, kritičnosti, zranitelností, otevřených alertů SOC nebo rizik. Kliknutím na uzel se zobrazí **detail** (CIA, zranitelnosti, alerty, rizika, vazby), lze zobrazit jen jeho **okolí** (1–3 kroky) a zapnout **analýzu dopadu výpadku** – červeně se zvýrazní vše, co na uzlu (i nepřímo) závisí, modře to, na čem závisí on. Kolečkem myši přibližujete, tažením posouváte. Technické závislosti jsou vidět i v detailu aktiva.

## Certifikáty a TLS
**Aktiva → Certifikáty a TLS** eviduje koncové body TLS (hostitel a port, volitelně jméno pro SNI a vazba na aktivum); **Navrhnout z aktiv** nabídne aktiva s jménem hostitele. CONTIX se k nim jednou denně (a na pokyn **Zkontrolovat nyní**) připojí jen čtecím TLS spojením a zjistí platnost certifikátu, vydavatele a důvěryhodnost řetězce, shodu jména, typ a délku klíče, podpisový algoritmus a – je-li na serveru openssl – zda server ještě přijímá **TLS 1.0 / 1.1**. Nálezy (vypršelý nebo brzy vypršující certifikát, nedůvěryhodný nebo vlastnoručně podepsaný, slabý klíč, SHA-1, zastaralý protokol, příliš dlouhá platnost) se řídí **pravidly kontroly**, která nastaví správce podle kryptografických požadavků organizace. Certifikáty před vypršením jsou v povinnostech týmu.

## Analýza odolnosti
**Aktiva → Analýza odolnosti** přenese **RTO a RPO z BIA** procesů po grafu závislostí (proces → aktivum → podpůrná aktiva → technické závislosti) na všechna aktiva, na kterých proces i nepřímo závisí, a vyhledá: **jediné body selhání** (neredundantní aktivum s krátkým RTO nebo s mnoha závislými kritickými aktivy), **nižší kritičnost**, než vyžadují závislá aktiva, aktivum s RTO do 72 h **bez plánu kontinuity** (kryje i plán procesu) nebo s plánem, jehož cílové RTO je delší, **kritickou závislost ve špatném stavu** (červený semafor, P1 zranitelnosti) a **BIA bez navázaných aktiv**. Redundantní aktivum (cluster, HA, záložní linka) označíte v jeho formuláři. Nálezy jsou vidět i jako obarvení v grafu vazeb a v detailu BIA (aktiva procesu, převzetí do pole Závislosti).

## Odkud se aktiva berou
- **Ručně** – tlačítko pro nové aktivum.
- **Discovery & import** – načtení z Wazuhu (agenti), síťový sken, import CSV / Excel. Opakované načtení aktiva páruje (sériové číslo, hostname, IP) a nepřepisuje vlastníka ani hodnocení.
- **Duplicity** – podobná aktiva lze sloučit.

## Síťové segmenty a neevidovaná zařízení
V **Discovery & import → Síťové segmenty** pojmenujte sítě, které chcete hlídat (např. Servery, Klienti, DMZ) – rozsahy CIDR, **výjimky** (adresy, které se neskenují, např. citlivé prvky OT), profil skenu a **plán** (každou hodinu, každých 6 hodin, denně, týdně v zadaný čas; nebo jen ručně). Rozsahy musí ležet v povolených rozsazích skenu (Administrace → Konektory). Každý nalezený hostitel se porovná s evidencí aktiv podle **MAC, IP a jména**. Zařízení, které v evidenci není, vytvoří **alert SOC** (zdroj Síťový sken, technika T1200); když na IP evidovaného aktiva odpoví jiná MAC adresa, vznikne alert **změny zařízení** (výměna nebo podvržení adresy). Opakovaný sken alert nezdvojí, jen zvýší počet výskytů. V seznamu **Zařízení nalezená v sítích** neevidované zařízení **založíte jako aktivum**, **přiřadíte k existujícímu** (doplní se IP a MAC) nebo **schválíte** s důvodem (např. hostovská síť) – schválené už alert nevytváří. Režim **Evidovat** navíc zakládá a aktualizuje aktiva přímo jako ruční sken; režim **Jen hlídat** evidenci nemění. Server CONTIX v Dockeru vidí jen IP adresy (bez MAC a výrobce) a živé zařízení pozná jen podle otevřeného portu (zkouší běžné porty serverů, stanic Windows a Mac, tiskáren a telefonů). Stanice, jejichž firewall odmítá všechna spojení (Windows v **veřejné** síti, Mac v režimu utajení), sken nenajde – nastavte na nich profil sítě **Privátní** / povolte sdílení souborů, nebo použijte sken s ARP ze stejné sítě.

## Zranitelnosti a semafor
Ze Wazuhu se načítají zranitelnosti (CVE) a verze operačních systémů. Semafor aktiva (zelená / oranžová / červená) vychází z otevřených zranitelností a podpory OS. Zranitelnost lze akceptovat s odůvodněním a termínem (výjimka). Ze zranitelností může CONTIX navrhnout rizika – návrh vždy potvrzuje člověk.

## Priority oprav (KEV a EPSS)
Tisíce CVE nejde opravit najednou. Každá zranitelnost má **prioritu P1–P4**: **P1** = je v katalogu **CISA KEV** (aktivně zneužívaná) nebo má **EPSS** (pravděpodobnost zneužití v příštích 30 dnech) aspoň 50 %; **P2** = EPSS aspoň 10 % nebo kritická zranitelnost na kritickém aktivu; **P3** = ostatní kritické a vysoké; **P4** = střední a nízké. Výpis je seřazený od nejvyšší priority a lze ho filtrovat podle priority, KEV a balíčku.

**Plán oprav podle balíčků** ukazuje, co zmizí opravou (aktualizací) jednoho balíčku – kolik zranitelností jaké priority a na kolika aktivech. Z řádku lze **založit riziko za balíček** (všechna dotčená aktiva a nepokryté kritické a vysoké CVE).

**Lhůty oprav** se řídí prioritou (výchozí P1 7 dní, P2 30, P3 90, P4 bez lhůty; mění správce v **Zdroje hrozeb**). Lhůta běží od prvního zjištění, u katalogu KEV nejdřív od zařazení do katalogu. Výpis ukazuje termín a „po termínu“, filtr **Jen po termínu opravy**. Pro P1 a P2 vzniká povinnost **Oprava zranitelností** – vlastník (garant) aktiva ji vidí v Moje povinnosti, tým v přehledu povinností. Zranitelnost P1 zbarví aktivum **červeně** (lze vypnout v nastavení semaforu). Zpráva pro vedení obsahuje podkapitolu **4.1 Zranitelnosti a jejich opravy** (P1, P2, KEV, po termínu, podíl oprav v termínu) a trendy počtu P1 a zranitelností po termínu.

Katalog KEV a skóre EPSS jsou veřejné soubory; CONTIX je jednou denně stáhne (nic neodesílá). Když server nemá přístup na internet, správce je stáhne jinde a nahraje v **Zdroje hrozeb**.

## Import skenů a triáž nálezů
Kromě Wazuhu lze nahrát výstupy dalších skenerů: **Nessus** (.nessus), **OpenVAS / Greenbone** (XML), **Burp Suite** (XML), **OWASP ZAP** (JSON), **Nuclei** (JSON / JSONL), **Trivy** a **Grype** (JSON), **SARIF** (Semgrep, CodeQL, SonarQube…) nebo obecné **CSV** (sloupce host / ip, cve nebo id, title, severity, port…). V **Zranitelnosti → Importy skenů** zvolte **Importovat sken**, nahrajte soubor a nejdřív si prohlédněte **náhled** – kolik nálezů, které hostitele se podařilo přiřadit k aktivům (podle IP, FQDN, jména) a kteří v evidenci chybí. Soubor se zpracuje jen na serveru, nic se neodesílá.
- **Cílové aktivum** – u skenu obrazu kontejneru, repozitáře nebo aplikace (Trivy, Grype, SARIF) přiřadí všechny nálezy jednomu aktivu.
- **Reimport** – opakovaný import téhož skeneru aktualizuje stávající nálezy. Co v souboru na skenovaných aktivech chybí, se označí jako vyřešené; znovu nalezené se samo otevře.
- **Externí sken (z internetu)** – kritické a vysoké nálezy dostanou prioritu **P2**. Stejně působí volba **Dosažitelné z internetu** u aktiva.
- **Deduplikace** – nový nález se stejnou CVE na aktivu, kterou už hlásí jiný zdroj (např. Wazuh), se automaticky označí jako duplicita.

V seznamu zranitelností lze nálezy zaškrtnout a hromadně **ověřit**, označit jako **falešně pozitivní** nebo **mimo rozsah** (vždy se zdůvodněním), jako **duplicitu** jiného nálezu na stejném aktivu nebo je **znovu otevřít**. Tyto stavy se nezapočítávají do semaforu ani lhůt a reimport je nepřepíše. U importu může **AI triáž** navrhnout duplicity napříč skenery (např. stejné XSS z Burpu a ZAPu), falešně pozitivní nálezy a nálezy k přednostnímu ověření – do modelu jdou jen nálezy a typy aktiv bez jejich názvů a nic se nezmění bez vašeho přijetí.

## Import z CI/CD, metriky a DefectDojo
- **Další formáty** – kromě výše uvedených i **Qualys VMDR** (XML detekcí i zprávy skenu) a **Dependency-Track** (export nálezů FPF; potlačené a falešně pozitivní se přeskočí).
- **Z pipeline (CI/CD)** – runner nahraje výstup skeneru na adresu /api/public/vulnerabilities/scans s osobním **API tokenem** uživatele, který smí spravovat aktiva (Profil → API tokeny, nejlépe omezený na společnost). Zpracování je stejné jako ruční import. Parametr **failOn** (critical, high, medium, none) vyhodnotí **bránu**: odpověď obsahuje nové otevřené nálezy podle závažnosti a příznak failed, podle kterého pipeline zastaví build. Návod s příkazem je pod seznamem importů.
- **Metriky** – na stránce Zranitelnosti: průměrná **doba opravy** podle závažnosti, podíl **opravených v termínu**, otevřené po termínu, **stáří** otevřených zranitelností, **vývoj po měsících** (nově zjištěné, vyřešené, otevřené na konci měsíce) a zdroje; přepínač zobrazí vše i jako tabulku.
- **Konektor DefectDojo** (správce) – pokud tým DefectDojo už používá, CONTIX z něj přes API v2 **jen čte aktivní nálezy** (klíč uživatele jen pro čtení, uložený šifrovaně). Nález se přiřadí k aktivu podle hostitele endpointu, nálezy bez endpointu (SAST, SCA) volitelně podle názvu produktu. Co v DefectDojo přestane být aktivní, je v CONTIXu vyřešené. Do DefectDojo se nic nezapisuje.
`,
  },
  {
    id: "risks",
    title: "Rizika a plán zvládání",
    audience: ["manager"],
    routes: ["/risks", "/risks/catalog", "/risks/plan"],
    module: "risks",
    summary: "Registr rizik, katalog hrozeb, hodnocení podle vyhlášky a plán zvládání.",
    body: `
## Hodnocení rizika
Riziko vzniká z hrozby a zranitelnosti a dotýká se aktiv. Hodnotí se dopad, hrozba a zranitelnost na stupnici podle přílohy č. 4 vyhlášky (nebo zvolené metodiky); úroveň rizika CONTIX spočítá. Za riziko odpovídá funkční místo.

## Zvládání
Zvolte způsob zvládání (snížení, přijetí, přenesení, vyhnutí se), navažte opatření a akce plánu zvládání s termínem a odpovědností. Zbytkové riziko vyhodnotíte po zavedení opatření; CONTIX může zbytkové hodnoty navrhnout podle účinnosti opatření. Do návrhu se nezapočte opatření, jehož poslední test byl neúčinný nebo jehož průběžný monitor je nesplněný; poslední test „účinné s výjimkami“ sníží účinnost na částečnou. Nesplněný monitor navázaného opatření se objeví i mezi podněty k přehodnocení rizika.

**Návrhy akcí plánu z dat** (záložka Zvládání): CONTIX navrhne akce k zavedení navázaných opatření, k obnovení účinnosti opatření s neúčinným testem nebo nesplněným monitorem a k posílení slabých schopností z přijatých scénářů z dat. Vyberete návrhy, odpovědné funkční místo a termín – akce vzniknou až po potvrzení; návrhy, které už v plánu jsou, se jen označí.

## Scénář s více hrozbami a zranitelnostmi
Rizikový scénář má **hlavní hrozbu a zranitelnost** a podle potřeby **další hrozby a zranitelnosti scénáře** (např. ransomware i chyba obsluhy při téže zranitelnosti zálohování). Další položky přidáte výběrem „+ přidat…“ pod hlavní hrozbou / zranitelností. Návrh dopadu bere v úvahu důvěrnost, integritu a dostupnost všech hrozeb scénáře; registr rizik a zpráva o hodnocení rizik uvádějí všechny položky, seznam rizik ukazuje jejich počet (+N) a filtr podle hrozby najde riziko i podle další hrozby.

## Katalog hrozeb a zranitelností
**Rizika → Katalog** obsahuje hrozby a zranitelnosti (slabá místa) podle přílohy vyhlášky s dopadem na důvěrnost, integritu a dostupnost. Vlastní položky přidáte tlačítkem **Nová hrozba / Nová zranitelnost**; nepoužívané položky deaktivujte (zůstanou u starších rizik).

## Plán zvládání rizik
**Rizika → Plán zvládání** shrnuje akce všech rizik: vazbu na opatření, způsob realizace, odpovědnost, termín, lidské, technické a finanční zdroje a náklady. Akce po termínu jsou zvýrazněné a objeví se v **Moje povinnosti** odpovědných míst. Schválený plán se ukládá jako dokument ISMS (tisk, Word).

## Pravidelné hodnocení
Roční hodnocení probíhá v **hodnotícím cyklu** (viz téma Hodnotící cykly). Teplotní mapa ukazuje rozložení rizik.

## Podněty k přehodnocení
Hodnocení rizika má odrážet to, co se od něj stalo. Detail rizika ukazuje **Podněty k přehodnocení** od posledního hodnocení nebo potvrzení: incidenty na riziku nebo jeho aktivech, závažná a méně závažná zjištění auditů, schválené a zavedené významné změny, signály SOC (eskalace, potvrzený útok, pokus o zneužití), nové zranitelnosti P1/KEV na aktivech, neúčinné testy navázaných opatření, prošlé výjimky zranitelností a vyhodnocené dotazníky dodavatelů s odpovědí „ne“.

CONTIX u metodiky podle vyhlášky navrhne zvýšení úrovně hrozby (incidenty, SOC) nebo zranitelnosti (zranitelnosti, zjištění, testy, výjimky). **Použít návrh** hodnoty jen vloží do formuláře – nic se nemění samo. Vlastník rizika pak buď hodnocení upraví a uloží, nebo jej **potvrdí beze změny** se zdůvodněním. Obojí se uloží do historie i s podněty, které k rozhodnutí vedly, a potvrzení se počítá i jako pravidelné hodnocení.

Na rozhodnutí je 30 dní od prvního podnětu – povinnost se objeví v **Moje povinnosti** vlastníka rizika. Seznam rizik lze filtrovat na rizika s podněty a zpráva o přezkoumání ISMS uvádí čekající rozhodnutí i počet přehodnocení za období.
`,
  },
  {
    id: "risk-scenarios",
    title: "Rizikové scénáře z dat",
    audience: ["manager"],
    routes: ["/risks/scenarios"],
    module: "risks",
    summary: "Návrhy rizikových scénářů z reálných dat a profil bezpečnostních schopností – každé hodnocení s doklady, rozhoduje člověk.",
    body: `
## K čemu slouží
Místo vymýšlení scénářů CONTIX navrhne scénáře podle toho, co skutečně ukazují data: pokrytí agentem Wazuh (EDR), zranitelnosti včetně KEV na aktivech dostupných z internetu, účty bez MFA a nálezy u privilegovaných účtů (AD / Entra ID), skóre bezpečné konfigurace (SCA), neevidovaná zařízení v síti, procesy bez otestované obnovy (BIA, testy plánů), významné dodavatele bez platné zprávy o ujištění a útoky zaznamenané v SOC (techniky ATT&CK).

## Profil schopností
Záložka **Profil schopností** ukazuje osm schopností (EDR, MFA, privilegované přístupy, segmentace, správa zranitelností, hardening, zálohy a obnova, dodavatelé) se stavem silná / částečná / slabá / neznámá, pokrytím a odkazem na zdroj dat. Co z dat zjistit nejde, doplníte **deklarací** s produktem, poznámkou, odkazem na důkaz a platností. Deklarace se použije jen tam, kde data chybí; je-li lepší než změřený stav, CONTIX na rozpor upozorní. Neznámá schopnost se nikdy nepočítá jako zavedená. U schopnosti vidíte i související požadavky ISO 27001, NIS2, CIS a paragrafy vyhlášky.

## Návrhy scénářů
**Vyhodnotit data** projde primární aktiva a jejich podpůrná aktiva (vazby a technické závislosti) a pro knihovnu šablon (ransomware, převzetí privilegovaného účtu, zneužití známé zranitelnosti, phishing, pohyb sítí, selhání zálohy, selhání dodavatele, únik dat, zneužití oprávnění zevnitř, výpadek služby z internetu, chybná konfigurace cloudu a M365, kompromitace softwarové komponenty, napadení OT, ztráta zařízení) navrhne scénář jen tam, kde data dokládají slabinu. Návrh obsahuje:
- **dopad** z hodnocení CIA primárního aktiva (jen ohrožené složky), **hrozbu** (střed stupnice, výš při útocích v SOC a zranitelnosti dostupné z internetu) a **zranitelnost** z doložených signálů a slabých schopností;
- **doklady** s odkazy na konkrétní aktiva, nálezy a procesy;
- **stávající opatření** namapovaná na požadavky zmírňujících schopností (chybí-li, je to kandidát do plánu zvládání);
- příznak **Málo dat**, když pro většinu schopností chybí měření.

Některé šablony platí jen pro odpovídající rozsah: OT jen s OT / IoT zařízením, ztráta zařízení jen s notebookem nebo mobilem, cloud jen s cloudovým prostředkem nebo SaaS, softwarová komponenta jen s aplikací, kontejnerem, databází nebo SaaS, výpadek služby jen s aktivem dostupným z internetu. Nové signály: podpůrná aktiva s vysokou dostupností bez redundance, nesplněný monitor Microsoft Secure Score, zranitelnosti v aplikacích a komponentách a zranitelná nebo vystavená OT zařízení.

## Rozhodnutí
- **Přijmout jako riziko** – vznikne riziko s hrozbou a zranitelnostmi z katalogu vyhlášky, aktivy, opatřeními a doklady v popisu; hodnocení můžete před založením upravit.
- **Navázat na existující riziko** – scénář už pokrývá riziko v registru.
- **Zamítnout** se zdůvodněním – zůstane v historii; když se v datech objeví nová skutečnost, návrh se znovu otevře.
U přijatých a navázaných návrhů CONTIX označí, když se data od rozhodnutí změnila. Změna doložených skutečností po posledním hodnocení rizika se objeví i v **podnětech k přehodnocení** na detailu rizika (silný podnět, když návrh vychází výš než současné hodnocení); potvrzením hodnocení nebo jeho změnou podnět zmizí.

## Pokrytí katalogu hrozeb
Záložka **Pokrytí katalogu hrozeb** ukazuje pro každé primární aktivum všechny aktivní hrozby z katalogu se stavem:
- **Pokryto rizikem** – riziko (hlavní nebo další hrozba scénáře) na aktivu nebo jeho podpůrném aktivu;
- **Návrh scénáře z dat** – otevřený návrh, který hrozbu řeší;
- **Nerelevantní (zdůvodněno)** – hrozbu jste u aktiva vyloučili se zdůvodněním (zapisuje se do auditního záznamu);
- **Neposouzeno** – mezera v analýze rizik.
Souhrn nahoře ukazuje podíl posouzených kombinací aktivum × hrozba – doklad úplnosti analýzy rizik podle § 8 vyhlášky.

## Automatická obnova
Plánovač jednou denně znovu vyhodnotí data u společností, které scénáře z dat používají: aktualizuje návrhy a podněty, rizika nikdy nemění.

## Detekce ATT&CK
Záložka **Detekce ATT&CK** ukazuje techniky MITRE ATT&CK ze šablon scénářů a čím je SOC umí zachytit: **zachyceno** (alerty se stejnou technikou nebo podtechnikou za 90 dní, bez falešných poplachů), **plánované hledání** (zapnuté hledání hrozeb s technikou), **deklarované pravidlo** (pravidlo SIEM / EDR mimo CONTIX – uveďte zdroj a poznámku) nebo **slepé místo**. Jakmile se detekce měří (SOC má alerty, hledání nebo deklarace) a většina technik scénáře je slepým místem, zvýší se úroveň zranitelnosti návrhu o 1 se zdůvodněním. Souhrn je i ve zprávě o hodnocení rizik (7.7).

## Úkoly k neposouzeným hrozbám
U neposouzené hrozby v Pokrytí katalogu hrozeb tlačítko **Úkol** založí úkol navázaný na aktivum („Posoudit hrozbu … u aktiva …“) – rozhodnutí pak zůstane na odpovědné osobě.

## Ve zprávě o hodnocení rizik
Nová verze **zprávy o hodnocení rizik** (Rizika → verze dokumentu) obsahuje část **7. Analýza rizik z dat**: profil schopností, pokrytí katalogu hrozeb po primárních aktivech se seznamem neposouzených hrozeb, hrozby vyloučené jako nerelevantní se zdůvodněním, rozhodnuté scénáře, přehodnocení rizik v období a otevřené podněty. Stav se ve schválené verzi zmrazí; u verzí se zobrazuje i pokrytí katalogu a počet neposouzených hrozeb s rozdílem proti předchozí verzi.
`,
  },
  {
    id: "risk-appetite",
    title: "Ochota riskovat a KRI",
    audience: ["manager"],
    routes: ["/risks/appetite"],
    module: "risks",
    summary: "Ochota riskovat schválená vedením po kategoriích, rizika nad touto hranicí a klíčové ukazatele rizik z dat.",
    body: `
## Ochota riskovat
Pro kategorie **důvěrnost, integrita, dostupnost a dodavatelé** stanovte nejvyšší úroveň rizika, kterou je organizace ochotna nést, a doplňte vyjádření vedení. Ochotu **schválí** odpovědná osoba tlačítkem Schválit (zapisuje se kdo a kdy); každá pozdější změna se označí jako čekající na nové schválení.

## Rizika nad ochotou
Kategorie rizika se odvodí ze složek CIA jeho hrozeb (hlavní i dalších) a z vazby na dodavatele nebo hrozeb závislosti na dodavateli a nedodržení smlouvy. Riziko, jehož aktuální úroveň překračuje ochotu v některé jeho kategorii, se zobrazí v přehledu – u rizika bez zvládání s upozorněním.

## Klíčové ukazatele rizik (KRI)
Ukazatele se počítají z dat CONTIXu: pokrytí MFA a EDR, aktiva z internetu se zranitelností KEV, aktiva se zranitelnostmi po termínu, kritické procesy bez otestované obnovy, neposouzené hrozby z katalogu a rizika s podnětem po termínu rozhodnutí. U každého nastavíte práh varování a překročení nebo ho vypnete. Při překročení se zapíše datum a riziko s přijatým scénářem z dat, jehož schopnost ukazatel sleduje, dostane **podnět k přehodnocení**. Plánovač ukazatele přepočítá jednou denně.

## Vývoj v čase a skupina společností
**Vývoj rizik v čase** ukazuje měsíční snímky: kritická a vysoká, střední a nízká rizika, rizika nad ochotou, pokrytí katalogu hrozeb, neposouzené hrozby, slabé schopnosti, překročené KRI a slepá místa detekce. **Přehled skupiny** (při více společnostech) porovná společnosti, kde smíte číst rizika, podle jejich posledního měsíčního snímku.

## Ve výstupech
Ochota, rizika nad ní a KRI jsou součástí zprávy o hodnocení rizik (část 8) a zprávy o přezkoumání ISMS pro vedení.
`,
  },
  {
    id: "risk-quant",
    title: "Kvantitativní analýza rizik (FAIR)",
    audience: ["manager"],
    routes: ["/risks/quant"],
    module: "risks",
    summary: "Odhad roční ztráty v Kč, křivka překročení ztrát a návratnost opatření.",
    body: `
## K čemu slouží
Kvantitativní analýza doplňuje hodnocení podle vyhlášky (to zůstává pro regulaci primární) o finanční pohled pro vedení: kolik riziko ročně stojí a zda se opatření vyplatí.

## Zadání u rizika
V detailu rizika v kartě kvantitativní analýzy odhadněte vždy **minimum, nejpravděpodobnější hodnotu a maximum**:
- **četnost** incidentů za rok (0,1 = jednou za 10 let),
- **ztrátu z jednoho incidentu** v Kč (obnova, výpadek, pokuty, reputace),
- volitelně hodnoty **po opatřeních** a roční náklady opatření (jinak se použije součet odhadů akcí plánu).
CONTIX provede simulaci Monte Carlo – stejné vstupy dají vždy stejný výsledek.

## Přehled
**Rizika → Kvantitativní analýza** ukazuje **očekávanou roční ztrátu**, ztrátu, kterou s 95 % / 99 % pravděpodobností nepřekročíte, **křivku překročení ztrát** za celé portfolio a návratnost opatření (**ROSI** = (snížení ztráty − roční náklady opatření) / náklady).
`,
  },
  {
    id: "cycles",
    title: "Hodnotící cykly: pravidelné hodnocení rizik a BIA",
    audience: ["manager"],
    routes: ["/risks/cycles", "/bia/cycles", "/cycles"],
    summary: "Roční přehodnocení rizik a analýzy dopadů s rozhodnutím o každé položce a schválením.",
    body: `
## Zahájení
V Rizicích (nebo v Kontinuitě pro BIA) otevřete **Hodnotící cykly** → **Zahájit hodnocení**: název, hodnocené období, termín dokončení a funkční místo, které hodnocení vede. Do rozsahu se zařadí platná rizika (procesy pro BIA); položky, které hodnotit nechcete, **vyřadíte z rozsahu** s odůvodněním.

## Průběh
U každé položky rozhodněte:
- **přehodnotit** – upravte hodnocení rizika / BIA (zapíše se jako „přehodnoceno“),
- **beze změny** – potvrďte, že je hodnocení aktuální.
Odpovědná funkční místa vidí své položky ve **Moje povinnosti**. Přehled ukazuje čekající položky a změny od zahájení.

## Dokončení a schválení
Až jsou rozhodnuté všechny položky, hodnocení předložte a schvalte – výsledek se **zmrazí jako snímek**. **Porovnání s předchozím** schváleným hodnocením ukáže zhoršení, zlepšení a odebrané položky; slouží jako doklad pravidelného hodnocení podle vyhlášky.
`,
  },
  {
    id: "exceptions",
    title: "Výjimky a přijatá rizika",
    audience: ["manager", "admin"],
    routes: ["/exceptions"],
    summary: "Jednotný přehled všech udělených výjimek s odůvodněním, autorem a platností; upozornění před vypršením.",
    body: `
## Co přehled obsahuje
Stránka **Výjimky a přijatá rizika** (menu Řízení a rizika) sbírá na jedno místo vše, co bylo vědomě přijato místo nápravy:
- **nálezy účtů** (Identity a přístupy) a **porušení oddělení povinností (SoD)** s výjimkou,
- **zranitelnosti** s výjimkou (akceptace rizika u aktiva),
- **přijatá rizika** (stav „přijato“ nebo způsob zvládání „akceptace“) – za výjimku odpovídá vlastník rizika,
- **neaplikovaná ustanovení** z prohlášení o aplikovatelnosti s odůvodněním a kompenzačním opatřením.

U každé položky vidíte odůvodnění, kdo výjimku udělil (u rizika vlastník) a do kdy platí. Výjimka bez odůvodnění je zvýrazněná červeně.

## Platnost a upozornění
Stav **Po platnosti** znamená, že termín uplynul – nález nebo porušení se při další synchronizaci znovu otevře; výjimku vyřešte nebo prodlužte novým udělením. **Brzy vyprší** = do 30 dnů; tehdy se výjimka objeví v **Mých povinnostech** toho, kdo ji udělil, v týmovém přehledu a v e-mailovém souhrnu upozornění. Přijatá rizika a neaplikovaná ustanovení nemají termín – přezkoumejte je při pravidelném hodnocení rizik a přezkumu prohlášení o aplikovatelnosti.

## Kompenzační opatření
Ve sloupci **Kompenzační opatření** tužkou přiřadíte opatření, která snižují riziko po dobu výjimky (např. WAF u neopravené zranitelnosti), a poznámku, jak riziko kompenzují. Vybírají se opatření společnosti výjimky; měnit je smí, kdo má oprávnění k zápisu v evidenci výjimky (identity, aktiva, rizika, opatření, SOC). U opatření se výjimka zobrazí ve vazbách; opatření jsou i v exportu CSV.

## Kde výjimky udělit a zrušit
Výjimky se spravují u svých záznamů: Identity a přístupy → Nálezy / Oddělení povinností (filtr **S výjimkou**), Zranitelnosti (filtr stavu), Rizika, Prohlášení o aplikovatelnosti. Kliknutím na předmět výjimky se otevře příslušný záznam. Každá změna je v auditním záznamu; přehled lze exportovat do **CSV** pro audit.
`,
  },
  {
    id: "coverage",
    title: "Pokrytí předpisu",
    audience: ["manager", "gestor"],
    routes: ["/controls/coverage"],
    module: "controls",
    summary: "Matice ustanovení × dokumenty × opatření, hromadné AI skóre dokumentů lokálním modelem a snímky stavu pro audit.",
    body: `
## Matice pokrytí
Stránka **Pokrytí předpisu** (v menu pod Opatřením a shodou) ukáže pro zvolený předpis nebo rámec (vyhláška 409/410, ZKB, NIS2, DORA, ISO 27001…) u každého ustanovení:
- **dokumenty**, které ho pokrývají – přes navázané požadavky (karta dokumentu → Vazby) nebo u bezpečnostní dokumentace přes oddíly vyhlášky podle režimu společnosti; zahrnují se platné dokumenty i návrhy,
- **verdikt AI** z posledního skóre dokumentu (zelená = pokryto, oranžová = částečně, červená = chybí, šedá = neohodnoceno); najetím myší uvidíte zdůvodnění, „starší verze“ znamená, že AI hodnotila předchozí verzi dokumentu,
- **opatření** a míru shody (stejně jako v prohlášení o aplikovatelnosti),
- **mezery**: žádný dokument, AI v dokumentech nenašla nebo našla jen částečně, žádné opatření, opatření nesplňuje.

Souhrn nahoře ukazuje podíl dokumentovaných požadavků, skóre pokrytí dokumenty podle AI (pokryto 1, částečně ½) a podíl požadavků s opatřením; kliknutím na dlaždici vyfiltrujete příslušné mezery. Ustanovení označená jako neaplikovaná se do mezer nepočítají.

## Hromadné AI skóre dokumentů
Tlačítko **Ohodnotit dokumenty AI** pošle lokálnímu modelu postupně všechny dokumenty předpisu, které ještě nemají hodnocení nebo se od hodnocení změnily (volitelně všechny). Dokumenty se hodnotí jeden po druhém, průběh vidíte nad maticí a výsledky se průběžně doplňují. Každé hodnocení je běžný AI návrh u dokumentu – náměty ke zlepšení přijmete nebo zamítnete v detailu dokumentu, automaticky se nic nemění. Dokument bez textu (bez obsahu verze a bez převedeného souboru) se přeskočí s upozorněním.

## Snímky pro audit
**Uložit stav pro audit** uloží neměnný snímek matice s datem, autorem a poznámkou (např. „stav před interním auditem“). Snímky vyberete v poli **Zobrazit** a lze je exportovat do CSV stejně jako aktuální stav.
`,
  },
  {
    id: "monitoring",
    title: "Průběžné monitorování opatření",
    audience: ["manager", "admin"],
    routes: ["/controls/monitoring"],
    module: "controls",
    summary: "Automatické kontroly opatření nad daty z Entra ID, AD, Wazuhu, zranitelností, certifikátů, SOC, školení a povinností i výsledky externích skriptů; testy za období pro SOC 2 Type II.",
    body: `
## K čemu to je
Auditor u SOC 2 Type II (a stále častěji i u ISO 27001) chce vidět, že opatření fungovalo **celé období**, ne jen v den kontroly. **Monitor** opatření kontroluje automaticky v nastavené frekvenci (denně, týdně, měsíčně) data, která CONTIX už má, a každý běh uloží jako **neměnný záznam** se souhrnem a podrobnostmi. Monitor nic nemění – jen čte.

## Co lze monitorovat
- **MFA u účtů** – podíl zapnutých účtů s registrovaným vícefaktorovým ověřením (Entra ID, AD).
- **Hygiena účtů** – kritické a vysoké nálezy v Identity a přístupy.
- **Privilegované účty** – jejich počet proti toleranci.
- **Microsoft Secure Score** – skóre tenantu M365 / Entra (aplikace potřebuje oprávnění SecurityEvents.Read.All, jen čtení).
- **Zranitelnosti po termínu opravy** a **aktivně zneužívané zranitelnosti (KEV)**.
- **Shoda konfigurace (Wazuh SCA)**, **pokrytí aktiv agentem Wazuh**, **systémy bez podpory (EOL)**.
- **Certifikáty** po platnosti nebo brzy končící a **alerty SOC po lhůtě**.
- **Plnění povinných školení** a **seznámení s platnými dokumenty** (podíl v %).
- **Povinnosti po termínu** – lhůty ze všech modulů (přezkum dokumentů, dodavatelé, přezkumy přístupů, úkoly…), volitelně jen vybrané druhy.
- **Externí kontrola** – výsledek posílá váš skript (viz níže).
Každý monitor má práh (minimum v % nebo tolerovaný počet). Když zdroj nemá aktuální data (např. adresář se nesynchronizoval), běh skončí jako **chyba** – nikdy jako splněný.

## Nový monitor
**Opatření → Průběžné monitorování → Nový monitor**: vyberte opatření, co se má kontrolovat, frekvenci a práh. Tlačítkem **Spustit teď** ověříte nastavení. V tabulce vidíte poslední výsledek, proužek posledních 30 běhů a úspěšnost za 90 dní; monitory opatření jsou i na jeho detailu. Monitor s historií běhů nelze smazat (je to důkaz) – jen vypnout.

## Externí kontrola a úkol při nesplnění
Pro věci, které CONTIX sám nevidí (zálohy, kontrola konfigurace firewallu, obnova ze zálohy…), založte monitor **Externí kontrola** a v jeho úpravě **vydejte token** (zobrazí se jen jednou). Skript po dokončení pošle výsledek: \`POST /api/public/monitors/result\` s hlavičkou \`Authorization: Bearer <token>\` a tělem JSON \`{"result":"pass"}\` nebo \`{"value": počet chyb}\` (porovná se s tolerancí), volitelně \`summary\` a \`details\`. Když výsledek nedorazí v intervalu monitoru (+ 2 h), zapíše se běh **chyba**. Volba **Při nesplnění založit úkol** založí vlastníkovi opatření úkol s termínem 7 dní; dokud je otevřený, další nesplnění nový úkol nezakládá.

## Test za období a SOC 2 Type II
**Test za období** složí z běhů dokončený **test provozní účinnosti**: každý běh je vzorek, nesplněné běhy a chyby zdroje jsou výjimky a pokud proběhlo méně než 90 % očekávaných běhů, přidá se výjimka **výpadek monitorování**. Záznam běhů se přiloží jako důkaz (CSV). V zakázce **SOC 2** typu Type II tlačítko **Testy z monitorování** vytvoří tyto testy najednou pro všechna opatření namapovaná na kritéria v rozsahu a za období zprávy; stejné období se nezakládá dvakrát.
`,
  },
  {
    id: "controls",
    title: "Opatření, shoda a prohlášení o aplikovatelnosti",
    audience: ["manager"],
    routes: ["/controls", "/controls/library"],
    module: "controls",
    summary: "Katalog opatření, mapování na požadavky předpisů a prohlášení o aplikovatelnosti.",
    body: `
## Shoda konfigurace (Wazuh SCA)
**Opatření → Shoda konfigurace** načítá z Wazuhu výsledky **Security Configuration Assessment** – kontroly podle CIS benchmarků a dalších politik na agentech. CONTIX je stáhne jednou denně (nebo tlačítkem **Načíst z Wazuhu**), jen čte. Zobrazí **skóre shody** (splněné / splněné + nesplněné kontroly) za politiky a aktiva, **nejčastěji nesplněné kontroly** s odkazy na rámce (CIS Controls, ISO 27001, NIST, PCI DSS…) a v detailu aktiva nesplněné kontroly s postupem nápravy. **Automatický test opatření** podle skóre a prahů (účinné / s výjimkami) zapíše v nastavené frekvenci dokončený test s CSV důkazem; účinnost opatření změní jen při zapnuté volbě.

## Katalog opatření
**Sledované rámce:** zákon a vyhláška podle režimu společnosti (vyšší povinnosti = 409, nižší = 410) se sledují vždy. Další rámce (ISO 27001, DORA, NIS2, SOC 2, ISO 9001, CIS Controls v8.1) zvolíte v **Administrace → Nastavení → Sledované rámce a normy** nebo v okně kořenové společnosti v **Administrace → Společnosti** (platí pro celou skupinu); dceřiná společnost může mít v témže okně vlastní výběr. Přehled a karty v Opatření a shoda pak ukazují jen sledované rámce; ostatní zůstávají dostupné jako „nesledováno“. Bez výběru se sledují rámce, ke kterým už existuje posouzení nebo namapovaná opatření. Režim má každá společnost skupiny vlastní – nová dceřiná společnost ho přebírá od nadřazené.

Na začátku lze **vytvořit výchozí katalog opatření**. Opatření má odpovědnost, stav zavedení a vazby na požadavky (vyhláška 409/410, ZKB, ISO 27001, DORA, NIS2, SOC 2). Při vytvoření katalogu s mapováním se k opatřením podle vyhlášky 409 připojí i příbuzné požadavky ostatních rámců – u NIS2 písmena čl. 21 směrnice a body přílohy prováděcího nařízení (EU) 2024/2690 (orientační mapování CONTIX). U katalogu vytvořeného dříve doplníte příbuzné požadavky tlačítkem **Doplnit mapování opatření** – vyberete rámce (např. NIS2), zobrazíte náhled, co u kterého opatření přibude, a potvrdíte. Stávající vazby zůstávají, nic se neodebírá.

## NIS2
Rámec **NIS2** obsahuje úřední české znění povinností subjektů ze směrnice (EU) 2022/2555 (čl. 20 řízení, čl. 21 opatření k řízení rizik, čl. 23 hlášení incidentů) a 161 bodů přílohy prováděcího nařízení (EU) 2024/2690 ve 13 oblastech (politika, rizika, incidenty, kontinuita, dodavatelé, vývoj a údržba, účinnost, hygiena a školení, kryptografie, lidské zdroje, řízení přístupu, aktiva, fyzická bezpečnost). Prováděcí nařízení přímo zavazuje jen vybrané digitální poskytovatele (DNS, cloud, datová centra, řízené služby…); ostatním poslouží jako podrobný referenční katalog. V České republice provádí čl. 21 směrnice zákon o kybernetické bezpečnosti a vyhlášky 409/410 – posuzujte primárně podle nich.

## Regulatorní profil
Každá společnost má **regulatorní profil** (Administrace → Společnosti, u kořenové i Administrace → Nastavení): **země / předpis** a podle něj úroveň povinností a **hlavní rámec**. Balíček **Česko** = zákon č. 264/2025 Sb. s režimem vyšších (vyhl. 409) nebo nižších povinností (vyhl. 410), případně neregulovaná společnost. Balíčky **Slovensko** (zákon č. 69/2018 Z. z., NBÚ / SK-CERT), **Polsko** (UKSC, podmiot kluczowy / ważny, CSIRT NASK / GOV / MON), **Německo** (BSIG po NIS2UmsuCG, besonders wichtige / wichtige Einrichtung, BSI) a **Rakousko** (NISG 2026, wesentliche / wichtige Einrichtung) mají kategorie subjektů a lhůty hlášení podle národní transpozice NIS2 (včasné varování 24 h, oznámení 72 h, závěrečná zpráva do 1 měsíce, s odkazem na národní ustanovení); hlavním rámcem je NIS2 s prováděcím nařízením 2024/2690, nebo naimportované znění národního zákona z knihovny rámců. Balíčky vycházejí ze stavu 10/2026 – aktuální znění ověřte. Balíček **Bez národního předpisu** je pro společnosti v jiných státech nebo dobrovolné řízení: hlavní rámec zvolíte z knihovny (ISO/IEC 27001, NIS2, importovaný zákon jiného státu). Podle profilu se řídí výchozí rámec v SoA, pokrytí a přehledech, sledované rámce, výchozí **kontrolní seznam nového auditu** a pokrytí auditů a doporučená **metodika rizik** (Česko: příloha č. 4 vyhlášky, jinak matice 5 × 5 – dceřiná společnost bez vlastní metodiky dostane metodiku svého balíčku). Kontrolní seznam auditu lze vytvořit z libovolného rámce knihovny s použitím „Audit“ (např. CIS v8.1, ISO/IEC 27001, vlastní rámec). **Hlášení incidentů** se řídí profilem: Česko podle zákona (NÚKIB / národní CERT, lhůty § 16), bez národního předpisu podle čl. 23 směrnice NIS2 (významný incident: včasné varování do 24 h, oznámení do 72 h, závěrečná zpráva do 1 měsíce – ověřte vnitrostátní transpozici). Mimo balíček Česko se v kontrolách dokumentace a významných změn neuvádějí odkazy na § české vyhlášky; zpráva pro vedení a průvodce nastavením ukazují profil.

## Finanční subjekt (DORA)
Je-li společnost **finančním subjektem podle nařízení DORA (EU) 2022/2554** – banka, pojišťovna, platební instituce, obchodník s cennými papíry apod. – zaškrtněte v regulatorním profilu **Finanční subjekt podle DORA**. Nezávisí na zemi: DORA platí přímo ve všech státech EU. CONTIX pak **sleduje DORA vždy** (vedle zákona a vyhlášky balíčku), u balíčku bez národního předpisu je DORA hlavním rámcem a **incidenty se hlásí podle DORA**: závažný incident související s IKT (kritéria nařízení 2024/1772) – prvotní oznámení do 4 h od klasifikace, nejpozději do 24 h od zjištění; průběžná zpráva do 72 h od prvotního oznámení; závěrečná zpráva do 1 měsíce od poslední průběžné zprávy (nařízení 2025/301). Adresátem je **orgán dohledu nad finančním trhem** (ČNB, NBS, KNF, BaFin, FMA). Povinnosti podle národního zákona, na které DORA nepamatuje (registrace, stav kybernetického nebezpečí), zůstávají. V záhlaví modulů (rizika, incidenty, audity, opatření, SoA, ISMS…) štítek **Rámec** ukazuje, podle čeho se modul aktivní společnosti řídí, např. „Rámec: Vyhl. 410 · ZKB · NÚKIB“ a „DORA · dohled ČNB“.

## Výstupy podle rámce
Dokumenty a zprávy se vedou podle **hlavního rámce společnosti** (regulatorní profil): v záhlaví je řádek **Rámec** a právní základ, odkazy v textu odpovídají rámci. Vyhláška 409 – § 8 (hodnocení rizik), § 3 písm. f) a g) (přezkoumání); vyhláška 410 – přehled bezpečnostních opatření a jeho roční aktualizace (§ 3 odst. 2); **DORA** (finanční subjekt) – zpráva o hodnocení rizik IKT (čl. 6 a 8, nařízení 2024/1774), plán zvládání rizik IKT (čl. 9), **přezkum rámce řízení rizik IKT** (čl. 6 odst. 5, nejméně jednou ročně); NIS2 – čl. 21 a příloha prováděcího nařízení 2024/2690; ISO/IEC 27001 – kap. 6.1.2, 6.1.3 a přezkoumání vedením 9.3. Prohlášení o aplikovatelnosti se vede podle rámce, za který je sestavené. Rámec se do verze dokumentu uloží při vytvoření – pozdější změna profilu starší verze nemění. **Zpráva pro vedení** u finančního subjektu přidá ukazatele DORA: závažné incidenty IKT, nedostatky registru třetích stran IKT a testování digitální provozní odolnosti (cvičení v období). **Podklad pro hlášení incidentu** odpovídá pravidlům společnosti: u DORA prvotní oznámení / průběžná / závěrečná zpráva o závažném incidentu IKT pro orgán dohledu (ČNB…), s kódem LEI a klasifikačními kritérii nařízení 2024/1772; u NIS2 s odkazem na národní ustanovení. Ve výběrech rámce jsou **sledované rámce nahoře**, ostatní pod „Další rámce“.

## Knihovna rámců
**Opatření → Knihovna rámců** ukazuje všechny rámce podle země (Česko, EU, mezinárodní a další) s typem (zákon, vyhláška, směrnice EU, norma, osvědčená praxe, interní požadavky) a použitím (shoda / SoA, audit, analýza rizik). **Importovat rámec** přidá vlastní rámec – například zákon a vyhlášku jiného státu, oborovou normu nebo interní požadavky skupiny:
- **tabulka CSV / XLSX** se sloupci ID, Oddíl, Název oddílu, Text, Vodítko, Úroveň, Mapování (šablonu stáhnete v okně importu; údaje o rámci – klíč, název, země, typ – vyplníte ve formuláři),
- **balíček CONTIX YAML / JSON / XML** – stejný tvar, jaký vytvoří **Export** (tak přenesete rámec mezi instalacemi),
- **katalog OSCAL** (JSON / YAML) – např. NIST SP 800-53.

**Načíst náhled** ukáže počet požadavků, oddílů a mapování, chyby a varování. Sloupec **Mapování** obsahuje ID požadavků jiných rámců (např. nis2:21/2/a; iso27001:A.5.1) – mapování platí oboustranně a **Doplnit mapování opatření** podle něj přidá vlastní rámec k opatřením, která už mají namapovaný příbuzný požadavek. Opakovaný import se stejným klíčem rámec aktualizuje: posouzení požadavků se stejným označením zůstanou. Vlastní rámec pak zvolíte ve **sledovaných rámcích** společnosti a posuzujete ho v prohlášení o aplikovatelnosti stejně jako vestavěné rámce. Vlastní rámec lze smazat; má-li posouzení nebo vazby, smažou se jen po potvrzení.

## CIS Controls v8.1
Rámec **CIS v8.1** obsahuje 18 opatření a 153 dílčích opatření (safeguards) s implementační skupinou **IG1–IG3**. Čísla odpovídají CIS, názvy jsou stručné popisky CONTIX (text CIS je licencovaný – plné znění mějte z cisecurity.org). U sledovaného rámce zvolíte **implementační skupinu**: IG1 (56 dílčích opatření – základní kybernetická hygiena), IG2 (130) nebo IG3 (všechna). Dílčí opatření vyšší skupiny jsou automaticky neaplikovatelná s odůvodněním; výslovné posouzení má přednost. Mapování z vyhlášky 409 na CIS doplníte k opatřením výchozího katalogu tlačítkem **Doplnit mapování opatření** (rámec CIS v8.1) – samo se nepřidává, dokud CIS nesledujete.

## Shoda a SoA
U každého požadavku vyznačíte použitelnost (s odůvodněním) a míru shody. Z toho vzniká **prohlášení o aplikovatelnosti** a míra shody; schválené verze se ukládají jako dokument ISMS (tisk, Word).

## Testy a důkazy
U opatření lze plánovat testy návrhu a provozní účinnosti se vzorky a přikládat důkazy s platností. Výsledek testu ovlivňuje účinnost opatření a tím i zbytkové riziko.
`,
  },
  {
    id: "incidents-handling",
    title: "Zvládání incidentů a hlášení NÚKIB",
    audience: ["manager"],
    routes: ["/incidents"],
    module: "incidents",
    summary: "Posouzení události, lhůty hlášení a záznam o zvládání.",
    body: `
## Hledání a třídění
Seznam událostí a incidentů lze **filtrovat** (klasifikace, stav, kategorie, odpovědnost, aktivum, období, významný dopad), **řadit** kliknutím na záhlaví sloupce (podruhé obráceně, potřetí zruší) a **seskupit** podle kategorie, stavu, klasifikace, odpovědnosti, aktiva, příčiny nebo měsíce. Kombinaci si uložte jako **pohled** (ikona diskety) – vlastní, nebo **sdílený** pro celý tým (např. „Otevřené phishingy“). Pohled se vybírá v rozbalovacím seznamu vedle; stejný název přepíše dřívější pohled.

## Od události k incidentu
Nahlášená událost (od zaměstnance nebo z Wazuh alertu jako návrh) se posoudí: dopad, dotčená aktiva a služby. Pokud jde o incident, CONTIX spočítá **lhůty hlášení** podle zákona (počáteční hlášení, průběžná, závěrečná zpráva) a ukáže je v přehledu i ve Moje povinnosti.

## Zvládání
Do časové osy zapisujte kroky zvládání, rozhodnutí a komunikaci. Podaná hlášení zaznamenejte (kdy, komu, číslo). AI asistent může připravit shrnutí incidentu – vždy ho zkontrolujte.

## Podklady ze SOC
U incidentu eskalovaného ze SOC karta **Podklady ze SOC** ukáže alerty (i z případu), indikátory kompromitace a zásahy včetně toho, kdo je schválil a provedl. Tlačítko **Doplnit ze SOC** navrhne texty do polí Podklady, Indikátory a Přijatá opatření, nové záznamy průběhu, vznik incidentu podle prvního alertu a dotčená aktiva – vyberete, co převzít, zkontrolujete ve formuláři a uložíte. Doplní se jen řádky, které v záznamu ještě nejsou, takže lze použít opakovaně.

## Hlášení NÚKIB / ÚOOÚ
Tlačítko **Připravit hlášení** (nebo **Hlášení** u lhůty) sestaví předvyplněné hlášení zvoleného druhu – prvotní hlášení, oznámení, průběžná a závěrečná zpráva, dobrovolné hlášení nebo ohlášení porušení zabezpečení osobních údajů ÚOOÚ. Údaje se berou z incidentu, z nastavení organizace (název, IČO, regulované služby, **kontaktní osoba pro hlášení incidentů**) a u incidentu ze SOC i počet alertů, techniky ATT&CK a indikátory. Nahoře je **kontrolní seznam chybějících povinných údajů** s tím, kde je doplnit. Text zkopírujte do Portálu Úřadu nebo e-mailu (případně stáhněte .txt nebo vytiskněte) a pak zvolte **Zaznamenat podání** – obsah hlášení se uloží k záznamu o podání a lhůta se označí jako splněná. CONTIX hlášení nikdy neodesílá sám.

## Záznam o zvládání incidentu
Tlačítko **Záznam o zvládání** vytvoří dokument podle § 14 odst. 1 vyhlášky č. 409/2025 Sb. (tisk / PDF nebo Word): identifikace a odpovědnost, klasifikace a povinnost hlásit, dopad, detekce ze SOC, podklady a IOC, opatření a zásahy (kdo navrhl, schválil, provedl), hlášení a lhůty, příčina a poučení, průběh. Nahoře jsou vypsány nesplněné kroky zvládání – podklad pro audit i pro kontrolu NÚKIB.
`,
  },
  {
    id: "soc",
    title: "SOC: fronta alertů, triáž a AI poradci",
    audience: ["manager"],
    routes: ["/soc"],
    module: "soc",
    summary: "Alerty z Wazuhu a ruční hlášení, převzetí analytikem, MITRE ATT&CK, playbooky, eskalace na incident a poradce SOC.",
    body: `
## Třídění fronty alertů
Frontu lze filtrovat podle stavu, minimální závažnosti, **zdroje** (Wazuh, phishing, síťový sken…), **období** posledního výskytu, AI triáže, shody se zdroji hrozeb a přiřazení. Kliknutím na záhlaví sloupce řadíte podle závažnosti, názvu, stavu, analytika nebo lhůty; **seskupení** podle zdroje, závažnosti, hostitele / aktiva, pravidla, taktiky ATT&CK, analytika, stavu nebo dne ukáže, co se opakuje. Kombinace filtrů, řazení a seskupení uložíte jako **pohled** – vlastní nebo sdílený pro tým SOC.

## Fronta alertů
Alerty z Wazuhu (nad nastaveným prahem úrovně, seskupené podle pravidla a hostitele) a **ruční alerty** (hlášení z jiného nástroje, telefonu, e-mailu) tvoří jednu frontu. Nahoře vidíte otevřené, nepřevzaté a kritické alerty, počet eskalací a **dobu do převzetí** (medián za 30 dní). Pás **taktik MITRE ATT&CK** ukazuje, kde se útoky za posledních 30 dní objevují – kliknutím frontu vyfiltrujete.

## Triáž
Analytik alert **převezme** (nebo ho přidělí kolegovi) – alert přejde do stavu V řešení. V detailu jsou výskyty, hostitel a aktivum, historie stejného pravidla (kolikrát bylo dříve uzavřeno jako falešný poplach nebo eskalováno) a otevřené zranitelnosti aktiva. Techniky **ATT&CK** se převezmou z pravidla Wazuh, případně odhadnou podle skupin pravidla; analytik je může upravit. Podle technik se navrhne **playbook** – kontrolní seznam kroků, které odškrtáváte. Do **poznámek** zapisujte zjištění a provedené kroky.

## Uzavření nebo eskalace
Alert uzavřete s **verdiktem** (falešný poplach, neškodná aktivita, nelze určit) a zdůvodněním, nebo ho **eskalujete na incident** – vznikne bezpečnostní událost s aktivem, technikami a časovou osou a dál pokračuje Zvládání incidentů (lhůty hlášení). Uzavřený alert lze znovu otevřít.

## Případy
Související alerty se spojují do **případu** – automaticky (stejný hostitel nebo stejná zdrojová IP v okně korelace, výchozí 24 h) nebo ručně: ve frontě vyberte alerty a zvolte **Do případu**. Když alerty v případu tvoří **řetězec útoku** (např. získání přihlašovacích údajů a pak eskalace oprávnění, nebo kroky končící exfiltrací či dopadem), závažnost případu se zvýší o stupeň. Převzetí případu převezme i jeho nepřevzaté alerty; uzavření uzavře otevřené alerty se stejným verdiktem; eskalace vytvoří **jeden incident** pro všechny otevřené alerty případu.

## Lhůty (SLA)
Každý alert a případ má lhůtu **převzetí** a **vyřešení** podle závažnosti (výchozí: kritická 15 min / 4 h, vysoká 1 h / 24 h, střední 4 h / 72 h, nízká 24 h / 7 dní; správce je změní v **Lhůty a korelace**). Alert v případu se řídí lhůtou případu. Po vypršení lhůty dostanou analytici SOC okamžité upozornění (e-mail, je-li zapnutý i Teams) a položka je v povinnostech týmu; převzaté položky vidí analytik v **Moje povinnosti**.

## Potlačení a ladění pravidel
Opakované falešné poplachy potlačíte při uzavření alertu (**Potlačit opakování**) nebo na záložce **Potlačení**: pravidlo Wazuh, volitelně hostitel a zdrojová IP, vždy s datem platnosti (nejvýše rok). Potlačené alerty se nezakládají, jen se počítají zásahy; pravidla jsou vidět i ve **Výjimkách** s upozorněním před koncem platnosti. Záložka **Ladění pravidel** ukazuje pro každé pravidlo počet alertů, eskalace a podíl falešných poplachů s doporučením (doladit / prověřit / užitečné).

**Návrhy úprav pravidel:** ikona baňky u pravidla připraví z dat Wazuh Indexeru návrh **výjimky** – najde znak (pole a hodnotu), který má většina událostí pravidla a který nespadá do alertů označených jako skutečný útok nebo eskalovaných. Návrh lze založit i ručně (výjimka nebo změna úrovně, podmínky na IP, uživatele, program, hostitele, umístění nebo pole události). **Simulace** spočítá, kolik událostí za 30 dní by úprava skryla a zda by skryla i události skutečných útoků. Schvaluje oprávnění Schvalovat zásahy SOC a jiný člověk než navrhovatel; úpravu, která by skryla skutečný útok, lze schválit jen s odůvodněním. Schválené návrhy stáhnete jako **soubor pravidel (XML)** a nasadíte na manager (/var/ossec/etc/rules/), ověříte nástrojem wazuh-logtest a restartujete manager – CONTIX do Wazuhu sám nic nezapisuje. Přehled hlučných pravidel a stav návrhů je i v nástroji pro dotazy AI a MCP (Ladění pravidel Wazuh).

## Zranitelnosti a rizika
Když alert míří na aktivum s otevřenou zranitelností, CONTIX to označí. Pokus o zneužití (alert zmiňuje CVE, která je na aktivu otevřená, nebo technika zneužití jako T1190 na aktivu s vysokou či kritickou zranitelností) **zvýší závažnost o stupeň** – a s ní i lhůty. U alertu a případu vidíte **rizika dotčených aktiv** z registru a na kartě rizika **signály SOC** (alerty, skutečné útoky a pokusy o zneužití za 90 dní) s doporučením zvážit přehodnocení – riziko se samo nikdy nemění. Zpráva pro vedení obsahuje kapitolu **Bezpečnostní monitoring (SOC)**.

## Zdroje alertů a hlášení phishingu
Kromě Wazuhu přijímá fronta alerty z dalších nástrojů přes **webhook s tokenem** (záložka **Zdroje**, správce): obecný JSON, **Suricata** (řádky eve.json, jen události typu alert) a **Microsoft Defender** (Defender for Endpoint i Microsoft Graph – např. z Logic App). Token se zobrazí jen jednou, CONTIX ukládá pouze jeho otisk; lze ho kdykoli obnovit nebo zdroj vypnout. Události se seskupí podle zdroje, pravidla a hostitele, aktivum se přiřadí podle názvu hostitele nebo IP a i u nich funguje potlačení opakování. Syslog a logy serverů přijímejte přes Wazuh.

Zaměstnanci hlásí podezřelé e-maily přes **Nahlásit phishing** – nejlépe s přiloženým .eml. Uloží se jen hlavičky (odesílatel, Reply-To, Return-Path), výsledky SPF / DKIM / DMARC, odkazy a názvy příloh, ne text zprávy. Stejný odesílatel a předmět = jeden alert s počtem hlášení (kampaň). Alert má techniku T1566 a playbook Phishing; neúspěšné ověření odesílatele nebo příloha zvýší závažnost. Odkazy se v detailu zobrazují neaktivní (hxxp).

## Indikátory kompromitace (IOC)
Záložka **IOC** eviduje IP adresy, domény, URL, hashe souborů a e-maily útočníků. V detailu alertu karta **Indikátory** nabídne hodnoty z alertu (externí zdrojová IP, u phishingu odesílatel, server odesílatele, odkazy a jejich domény, hashe z popisu) – vyberete je a zvolíte **Blokovat** nebo **Jen sledovat**. Ručně lze vložit víc hodnot najednou (typ se pozná sám, zápis evil[.]com i hxxp:// se převede). Každý IOC má platnost (výchozí 90 dní), interní IP adresy blokovat nelze.

**Zpětné hledání** projde alerty ve Wazuh Indexeru (jen čtení) a v CONTIXu za posledních 30 dní a ukáže, na kterých hostitelích se hodnota objevila – např. kdo navštívil doménu z phishingu. **Seznam k blokaci** (text nebo CSV) a **feed** pro firewall či proxy (External Dynamic List, Threat Feed – adresa s tajným tokenem, firewall si ji stahuje sám) obsahují jen platné IOC s akcí Blokovat; zrušený nebo prošlý IOC z feedu sám vypadne.

## Reakce s potvrzením
**Okamžitá upozornění:** nový alert od nastavené závažnosti (výchozí jen kritická) dostanou analytici SOC hned e-mailem a do Teams (kanály podle Administrace → Upozornění), každý alert jen jednou.

**Zásahy** navrhuje analytik v detailu alertu (**Navrhnout zásah**) – blokace IP, zakázání účtu, vynucení změny hesla, izolace zařízení nebo jiný zásah s důvodem. Nic se neprovede bez schválení člověkem s oprávněním **schvalovat zásahy SOC**; při zapnutém **principu čtyř očí** schvaluje jiný člověk než navrhovatel (dostane upozornění). **Blokaci IP** po schválení CONTIX hned odešle přes **Wazuh Active Response** na vybrané agenty (samostatný účet Wazuh API jen s právem active-response:command, nastavení na záložce **Reakce**); zablokovaná IP se zapíše i do IOC k blokaci. Odblokování řídí nastavení Active Response ve Wazuhu. Ostatní zásahy provede správce (CONTIX nemění účty v AD ani zařízení) a výsledek zapíše tlačítkem **Označit provedení**. Každý krok (návrh, rozhodnutí, provedení, selhání) jde do auditního logu, poznámek alertu a časové osy incidentu – podklad pro záznam o zvládání incidentu.

## Veřejné zdroje hrozeb
Na záložce **Zdroje** karta **Veřejné zdroje hrozeb** stahuje seznamy známých škodlivých IP, domén, URL a hashů: **abuse.ch Feodo Tracker** (C2 servery botnetů, bez klíče), **URLhaus** a **ThreatFox** (vyžadují bezplatný Auth-Key z auth.abuse.ch, uloží se šifrovaně) a **vlastní seznamy** (např. varování NÚKIB / CERT, jedna hodnota na řádek). Zdroje se **jen stahují** – nic z CONTIXu se neodesílá. Server bez internetu: soubor stáhněte jinde a **nahrajte**.

Po stažení CONTIX porovná zdroje s alerty za 14 dní (zdrojová a cílová IP, odkazy a domény z phishingu, hashe) – shoda se ukáže odznakem **Známá hrozba** ve frontě (i jako filtr) a upozorněním v detailu alertu a dostane ji i AI triáž. Je-li zapnuto **hledání ve Wazuhu**, plánovač prohledá nové alerty Wazuh Indexeru (jen čtení) a při shodě IP nebo domény založí alert **Komunikace se známou hrozbou** na daném hostiteli (opakování se připíše, lze potlačit).

## Cortex a MISP
Karta **Cortex a MISP** na záložce **Zdroje** (nastavuje správce) propojí CONTIX s analytickými nástroji SOC:

- **Cortex** – obohacení IOC analyzátory. Po zadání adresy a API klíče (uživatel Cortexu s rolí analyze) tlačítko **Uložit a otestovat** načte seznam analyzátorů. Analytik smí spustit **jen zaškrtnuté** analyzátory. U každého je odhad, zda je **lokální** (MaxMind, Yara, FileInfo, MISP…) nebo **odesílá hodnotu třetí straně** (VirusTotal, AbuseIPDB, Shodan…) – ty povolte jen vědomě. Do Cortexu jde jen hodnota, typ, TLP a PAP, nikdy kontext alertu, jména ani poznámky.
- **MISP** – **stahování** atributů (IP, domény, URL, hashe, e-maily) za zvolené období jako další zdroj hrozeb: porovnání s alerty a hledání ve Wazuhu funguje stejně jako u abuse.ch, stahuje se spolu s ostatními zdroji. **Vyhledání hodnoty** v MISP ukáže události, ve kterých se vyskytuje. **Sdílení IOC** založí z vybraných platných IOC novou událost (distribuce, TLP a úroveň hrozby podle nastavení, publikace volitelně) – vyžaduje oprávnění **Sdílet IOC do MISP**; poznámky analytiků se nesdílejí.

Analýzu spustí analytik tlačítkem **Analyzovat** u IOC (záložka IOC) nebo u kandidáta v detailu alertu. Výsledek – verdikt (bezpečné, podezřelé, škodlivé) a taxonomie analyzátoru, u MISP odkazy na události – se uloží k alertu i IOC (karta **Obohacení IOC**) a plná zpráva je k dispozici. Déle běžící analýzu CONTIX dokončí na pozadí.

**Interní údaje se nikdy neodesílají**: soukromé IP, jednoslovná jména, domény .local, .lan, .internal, .corp, .test apod. a **interní domény** zadané v nastavení CONTIX odmítne (u analýzy i sdílení). Každá analýza, dotaz a sdílení je v auditním logu; API klíče se ukládají šifrovaně.

## Microsoft Sentinel a Elastic Security
Na záložce **Zdroje** lze založit zdroj **Microsoft Sentinel** nebo **Elastic Security**. Alerty mohou přicházet webhookem (Logic App / playbook Sentinelu, konektor Webhook v Kibaně) nebo je CONTIX **stahuje** v intervalu: u Sentinelu incidenty změněné od posledního stažení (aplikace v Entra ID s rolí Microsoft Sentinel Reader, tajný klíč se ukládá šifrovaně), u Elasticu nové alerty z indexu .alerts-security.alerts-* (API klíč nebo uživatel s právem čtení). Uzavřené incidenty Sentinelu se přeskočí, techniky ATT&CK se převezmou. Tlačítko **Stáhnout** stáhne hned a ověří nastavení; při chybě se kurzor neposouvá a chyba je vidět u zdroje. Ze SIEM se jen čte.

## Pohled na hostitele
Záložka **Hostitelé** ukazuje stroje s alerty za zvolené období (nebo s otevřenými alerty) – aktiva z evidence i agenty, které aktivum zatím nemají; řazeno podle otevřených alertů a závažnosti, se značkou pokusu o zneužití a známé hrozby. Detail hostitele (také tlačítko **Pohled SOC na hostitele** u aktiva nebo odkaz u hostitele v detailu alertu) shrnuje vše na jednom místě: **aktivitu v čase** podle závažnosti, taktiky ATT&CK (kliknutím filtrují alerty), alerty, otevřené zranitelnosti s prioritou P1–P4 a KEV, incidenty a případy SOC, rizika aktiva, úkoly z playbooků a zásahy, IOC a shody se zdroji hrozeb. Vše se počítá z aktuálních dat.

## Playbooky a úkoly pro tým
Detail alertu navrhne playbook podle technik a taktik ATT&CK – přednostně **playbook organizace**. Na záložce **Playbooky** vestavěný postup **přizpůsobíte** (vznikne kopie) nebo založíte nový: kroky, odpovědné **funkční místo** a **lhůta** v hodinách. Tlačítko **Zadat úkoly týmu** v kartě playbooku založí z vybraných kroků úkoly v **Akce a úkoly** (odpovědnost a termín lze upravit, priorita podle závažnosti alertu); držitelé míst je uvidí v **Moje povinnosti**. Splněním úkolu se krok playbooku označí jako hotový a do poznámek alertu se zapíše, kdo jej splnil. Playbook, který alerty používají, se při smazání jen vypne.

## Plánované hledání hrozeb
Záložka **Hledání hrozeb** spouští uložené dotazy do alertů Wazuh Indexeru (stejná syntaxe jako vyhledávání ve Wazuh Dashboardu, např. „rule.groups:authentication_failures“). Výsledky se **seskupí** podle zvoleného pole (hostitel, zdrojová IP, uživatel…) a každá skupina s počtem výskytů nad **prahem** založí alert **Hledání hrozeb** se závažností a technikami ATT&CK z nastavení. Plánovač hledání spouští v **intervalu** a vždy jen nad novým oknem od posledního běhu; při chybě se okno neposouvá. **Zkusit** projde posledních N hodin bez založení alertů – vhodné pro ladění dotazu a prahu. **Knihovna hledání** obsahuje připravené dotazy (hádání hesel, mazání protokolů, kódovaný PowerShell, výpis přihlašovacích údajů, plánované úlohy a služby, nové administrátorské účty, změny kritických souborů). Indexer se jen čte.

## Výkonnost SOC a AI
Záložka **Výkonnost** ukazuje za zvolené období (30–365 dní) počet alertů, eskalace, podíl planých poplachů, medián **doby do převzetí** a **doby do rozhodnutí** a plnění lhůt podle závažnosti; tabulka podle zdroje odhalí nástroj, který jen generuje šum. Karta **AI předběžná triáž** porovná návrh modelu s konečným rozhodnutím analytika (útok vs. planý poplach): **shoda**, shoda podle jistoty modelu, **přehlédnuté útoky** (AI navrhla planý poplach, šlo o útok – projděte je jednotlivě) a přehnané poplachy. Při shodě pod 60 % nebo s přehlédnutými útoky návrhy berte jen orientačně a doplňte pokyny organizace v nastavení AI. Doba do rozhodnutí a shoda AI jsou i v kapitole SOC ve zprávě pro vedení.

## AI předběžná triáž (lokální model)
Plánovač každý nový otevřený alert předběžně posoudí: najde **podobné rozhodnuté alerty** za 180 dní (stejné pravidlo, hostitel, zdrojová IP nebo technika ATT&CK) a lokální model navrhne **verdikt, závažnost a jistotu** se zdůvodněním. Ve frontě je sloupec **Návrh AI** a filtr (pravděpodobný útok / pravděpodobně planý poplach). V detailu alertu tlačítko **Použít návrh** otevře uzavření s předvyplněným verdiktem, nebo eskalaci – potvrzuje vždy analytik, nic se neaplikuje samo. **Znovu posoudit** spustí triáž znovu (např. po doplnění technik). Do modelu jdou údaje o alertu a jen verdikty podobných alertů – ne jména osob, poznámky ani zdůvodnění analytiků. Vypnout lze v **Lhůty a korelace**.

## AI poradci (lokální model)
- **AI rozbor alertu** – co se pravděpodobně děje, co útočník dělá dál, jak to rychle ověřit, doporučené kroky a známky falešného poplachu. Rozbor se uloží k alertu.
- **Poradce SOC** – otázky na typy útoků, techniky ATT&CK a zranitelnosti; u CVE doplní údaje z vaší evidence zranitelností (na kterých aktivech je otevřená).

Do modelu jdou údaje o alertu, technikách, aktivu a jeho zranitelnostech; nejdou jména osob ani poznámky analytiků. Rady vždy ověřte před zásahem.
`,
  },
  {
    id: "isms",
    title: "Řízení ISMS a zpráva pro vedení",
    audience: ["manager"],
    routes: ["/isms", "/management"],
    module: "isms",
    summary: "Významné změny, cíle a přezkoumání ISMS, zpráva pro vedení.",
    body: `
## Řízení ISMS
- **Významné změny** (§ 11) – evidence změn, posouzení dopadu podle kritérií organizace (lze nastavit u společnosti) a termíny realizace.
- **Cíle a účinnost** – měřitelné cíle ISMS a jejich vyhodnocení.
- **Přezkoumání** – zpráva o přezkoumání ISMS vedením; termín dalšího přezkoumání hlídá CONTIX.

## Zpráva pro vedení
Semafor hlavních ukazatelů (rizika, incidenty, shoda, školení, dokumentace) za zvolené období – k tisku nebo do Wordu.
`,
  },
  {
    id: "audits",
    title: "Audity, zjištění a nápravná opatření",
    audience: ["manager"],
    routes: ["/audits", "/audit-portal"],
    module: "audits",
    summary: "Plán auditů, kontrolní seznamy, zjištění, nápravná opatření a balíček pro auditora.",
    body: `
## Plán a průběh auditu
**Nový audit** – druh (audit v plném rozsahu, průběžný audit po celcích, audit při významné změně, audit dodavatele, kontrola, kontrola NÚKIB), rozsah, termín a auditor (musí splnit požadavky na praxi a nestrannost). Kontrolní seznam vychází ze zvolené metodiky auditu (požadavky předpisů nebo vlastní seznam z Administrace → Metodiky); u každé položky zaznamenáte výsledek a důkaz.

## Zjištění a nápravná opatření
Ke zjištění (závažná / méně závažná neshoda, pozorování, doporučení) přiřaďte nápravné opatření s termínem a odpovědným funkčním místem. Opatření po termínu se objeví v **Moje povinnosti** a na Přehledu. Pokrytí ukazuje, které oblasti předpisu dosud nebyly auditovány.

## Balíček pro auditora
**Balíček pro auditora** připraví ZIP s prohlášením o aplikovatelnosti, testy opatření a důkazy – pro externí audit bez nutnosti přístupu do CONTIXu.

## Portál externího auditora a požadavky na podklady
Na detailu auditu karta **Požadavky na podklady (PBC)** vede seznam toho, co auditor požaduje – jednotlivě nebo **hromadně** (řádek „název; odkaz na kritérium; termín“, např. ze seznamu od auditora), s **vlastníkem** (funkční místo) a termínem. Vlastník nahraje soubory, může připsat komentář a zvolí **Odeslat auditorovi** – teprve tehdy auditor soubory uvidí; odeslaný soubor už nelze smazat, jen doplnit opravený. Otevřené a vrácené požadavky má vlastník v **Moje povinnosti**.

Externí auditor dostane účet s rolí **Externí auditor** (Administrace → Uživatelé) a správce auditu ho přidělí tlačítkem **Externí auditoři**. Auditor po přihlášení vidí jen **Portál auditora** se svými audity – požadavky, odeslané soubory (stažení vždy jako příloha, se SHA-256) a komentáře; podklady **převezme** nebo **vrátí k doplnění** s komentářem. Nevidí jména vlastníků ani žádná jiná data CONTIXu. Každé nahrání, odeslání, stažení, převzetí a vrácení je v auditním logu; **Stáhnout podklady (ZIP)** dá odeslané soubory s manifestem.
`,
  },
  {
    id: "continuity",
    title: "Kontinuita: analýza dopadů (BIA) a plány",
    audience: ["manager"],
    routes: ["/bia", "/continuity"],
    module: "continuity",
    summary: "BIA procesů (MTPD, RTO, RPO), plány kontinuity a obnovy a jejich testy.",
    body: `
## Cvičení a tabletop scénáře
**Cvičení** prověří plány kontinuity a reakce na incidenty. Nové cvičení založíte ze **šablony scénáře** (ransomware, výpadek cloudového dodavatele, výpadek napájení, únik osobních údajů, kompromitace účtu vedení) nebo prázdné. V **přípravě** upravíte scénář, cíle, účastníky, facilitátora a **vstupy scénáře** s časem od zahájení. Po **zahájení** facilitátor vkládá vstupy (CONTIX hlídá čas) a zapisuje rozhodnutí, poznámky a problémy s časem a autorem. **Vyhodnocení** zaznamená výsledek, dosažené RTO, splnění cílů, zjištění a poučení; nápravná opatření vzniknou jako **úkoly** a výsledek se zapíše jako **test do navázaných plánů**. **Záznam pro audit** je k tisku i ve Wordu. Naplánované cvičení se objeví v povinnostech facilitátora.

## Analýza dopadů (BIA)
BIA se dělá pro procesy: dopady výpadku v čase (finanční, provozní, právní, reputační) určí **MTPD**, z něj **RTO** a **RPO**. Požadavky na dostupnost se promítnou do podpůrných aktiv procesu. Pravidelné přezkoumání BIA probíhá v hodnotícím cyklu.

## Plány kontinuity a obnovy
Záložka **Plány** – plán kontinuity, obnovy, reakce na incident nebo krizové komunikace pro procesy a aktiva: scénář, postup, odpovědnosti a zdroje. Plán se schvaluje a pravidelně **testuje** (stolní cvičení, procházka postupem, simulace, plný test); výsledek testu a zjištění se zapisují k plánu. Termíny testů hlídá CONTIX (Přehled, Moje povinnosti).
`,
  },
  {
    id: "actions",
    title: "Akce a úkoly",
    audience: ["manager", "gestor"],
    routes: ["/actions"],
    summary: "Jednotný přehled nápravných akcí a úkolů ze všech oblastí – odpovědnost, termíny, plnění.",
    body: `
## Co přehled obsahuje
**Akce a úkoly** sbírají na jedno místo vše, co je potřeba udělat: **úkoly** (založené v CONTIXu), **akce plánu zvládání rizik**, **nápravná opatření ze zjištění auditů** a **úkoly ze změn předpisů**. Nahoře jsou akce po termínu, pak podle termínu. Filtry: druh, stav, **Moje** (akce funkčních míst, která zastáváte), jen po termínu, hledání. Přehled lze stáhnout jako CSV. Zaškrtnutím úkolů zobrazíte lištu **hromadných změn**: stav (hotovo, rozpracováno), nový termín a nový vlastník. Termín a vlastníka mění jen správce úkolů; úkoly, ke kterým oprávnění nemáte, se přeskočí.

## Úkoly
**Nový úkol** – co je potřeba udělat, odpovědné **funkční místo**, termín, priorita. Úkol lze založit také přímo u záznamu (karta **Úkoly** u incidentu, dodavatele, změny, opatření, aktiva nebo procesu) – pak je na záznam navázaný a přesouvá se s ním mezi společnostmi. Držitel funkčního místa vidí úkol s termínem v **Mých povinnostech** (a v e-mailovém souhrnu) a může měnit jeho **stav** a zapsat, **jak byl splněn**; ostatní údaje mění správce úkolů.

## Akce z jiných modulů
Akce plánu zvládání, zjištění auditů a úkoly ze změn předpisů se upravují u svého záznamu – v přehledu na ně vede odkaz. Jejich stav se do přehledu promítá automaticky.
`,
  },
  {
    id: "knowledge",
    title: "Znalostní báze",
    audience: ["manager", "gestor"],
    routes: ["/knowledge"],
    module: "knowledge",
    summary: "Vlastní znalostní články – postupy, FAQ a runbooky SOC; zveřejněné najde rychlé hledání a použije AI asistent.",
    body: `
## Články
**Nový článek** založíte tlačítkem vpravo nahoře. Text se píše v Markdownu (## nadpis, **tučně**, - odrážky) s náhledem vedle. Štítky (oddělené čárkou) pomáhají při hledání.

## Zveřejnění
Koncept vidí jen autoři (oprávnění Psát a zveřejňovat znalostní články). **Zveřejněný** článek vidí všichni s oprávněním Číst znalostní články a dostane se do vektorového indexu – po úsecích podle nadpisů ##, takže AI asistent cituje konkrétní část článku.

## Co do článků patří
Postupy, které nejsou řízenou dokumentací: jak nahlásit incident, runbook pro phishing, FAQ k heslům a MFA, kontakty dodavatelů podpory, zkušenosti z cvičení. Řízené dokumenty (politiky, směrnice) patří do Dokumentace.
`,
  },
  {
    id: "trust",
    title: "Dotazníky zákazníků a Trust Center",
    audience: ["manager", "admin"],
    routes: ["/trust", "/t"],
    module: "trust",
    summary: "Odpovědi na bezpečnostní dotazníky zákazníků s AI návrhy z dokumentace a opatření, knihovna odpovědí a veřejná stránka důvěry.",
    body: `
## Dotazníky zákazníků
V **Dotazníky a Trust Center → Dotazníky** nahrajte dotazník od zákazníka (XLSX nebo CSV). V náhledu zkontrolujte sloupec s otázkami a případně s jejich ID; řádek jen s nadpisem se bere jako oddíl. Otázky, ke kterým je v knihovně velmi podobná schválená odpověď, se rovnou předvyplní jako návrh.

## Návrh odpovědí (AI)
Na detailu dotazníku **AI navrhne** odpovědi na dalších 20 nezodpovězených otázek. Lokální model dostane jen podklady k jednotlivým otázkám: odpovědi z knihovny, vaše opatření se stavem a úroveň účinnosti, úryvky platné dokumentace, kterou smíte číst, a certifikace z Trust Center. U odpovědi vidíte použité zdroje a míru jistoty. Opatření, které je jen plánované nebo neúčinné, vede nanejvýš k odpovědi Částečně.

## Schválení a export
Každou odpověď upravte a **schvalte** (jednotlivě nebo vybrané návrhy najednou). Když jsou schválené všechny, **schvalte dotazník** – odpovědi se uloží do **knihovny** a příště se použijí znovu. **Export XLSX** obsahuje řádek původního souboru, otázku, odpověď, komentář a zdroje; do zákazníkova formuláře je přenesete sami. Nic se automaticky neodesílá.

## Trust Center
Na kartě **Trust Center** nastavte veřejnou stránku důvěry na adrese /t/<adresa>: úvodní text, certifikace, souhrn opatření podle kategorií, průběžné monitorování (jen úspěšnost za 90 dní), vybrané subdodavatele a dokumenty. Dokument zveřejníte **veřejně** nebo **po schválení (NDA)** – vždy jen platnou schválenou verzi jako PDF s doložkou.

## Žádosti o přístup
Návštěvník požádá o přístup k důvěrným dokumentům a musí přijmout podmínky mlčenlivosti. Žádost schválíte v **Žádosti o přístup**: vznikne časově omezený odkaz (platnost nastavíte) a odešle se žadateli e-mailem; bez nastaveného e-mailu ho předáte sami. Stažené PDF nese jméno, organizaci a e-mail příjemce. Přístup lze kdykoli odebrat.
`,
  },
  {
    id: "suppliers",
    title: "Dodavatelé a smlouvy",
    audience: ["manager"],
    routes: ["/suppliers"],
    module: "suppliers",
    summary: "Evidence dodavatelů, určení významných dodavatelů, bezpečnostní dotazníky a náležitosti smluv podle vyhlášky.",
    body: `
## Evidence
**Nový dodavatel** – IČO, název, poskytované služby, navázaná aktiva a procesy. Tlačítko **Načíst z ARES** najde firmu podle IČO nebo názvu a doplní název, IČO a sídlo (dotaz posílá server CONTIXu; do ARES jde jen IČO nebo název). Dodavatele lze hromadně načíst přes **Import dat**.

## Významný dodavatel
Podle kritérií vyhlášky (dopad na regulované služby, přístup k aktivům) určíte, zda je dodavatel **významný**. U významného dodavatele CONTIX kontroluje **náležitosti smlouvy** podle přílohy vyhlášky (409 / 410 podle režimu společnosti) a ukáže mezery.

## Bezpečnostní dotazník
Na kartě dodavatele **Poslat dotazník** vytvoří jedinečný odkaz, přes který dodavatel vyplní bezpečnostní dotazník **bez přihlášení** (česky nebo anglicky). **Úplný** rozsah (30 otázek) je pro režim vyšších povinností, **zkrácený** pro vyhl. 410. Odkaz lze poslat e-mailem (SMTP z Administrace → Upozornění) nebo zkopírovat – zobrazí se jen jednou; **Nový odkaz** vydá jiný a starý přestane platit. Dodavatel může odpovědi průběžně ukládat a k otázkám i obecně **přiložit soubory** (PDF, Office, obrázek, text; max. 10 MB, 20 souborů); po odevzdání je už nezmění (lze mu dotazník **vrátit k doplnění**).

Odevzdaný dotazník ukáže **skóre**, nedostatky a **navrženou úroveň rizika** (klíčová odpověď „ne“ = vysoké). Po **vyhodnocení** se k dodavateli zapíše datum hodnocení rizik (§ 9 odst. 2 písm. a). Tlačítko **Založit riziko dodavatele** vytvoří riziko s výčtem nedostatků navázané na dodavatele – ohodnotí ho vlastník podle metodiky. Čekající a vyplněné dotazníky hlídá Přehled a Moje povinnosti; odpovědi lze vytisknout jako podklad pro audit.

## Registr informací DORA
Finanční subjekty vedou podle čl. 28 DORA **registr smluvních ujednání s poskytovateli služeb IKT** (šablony prováděcího nařízení (EU) 2024/2956). Tlačítko **Registr informací DORA** v přehledu dodavatelů ho sestaví z evidence: u dodavatele na jeho kartě v části **DORA – poskytovatel služeb IKT** zvolte **Označit jako poskytovatele IKT** (nebo v registru v seznamu **Dodavatelé mimo registr**, kde jsou významní dodavatelé podle vyhlášky nahoře) (LEI, případně EUID nebo IČO, země sídla, nejvyšší mateřský podnik), u smlouvy doplňte druh služby (S01–S19), roční náklady a **podporované funkce** – to jsou procesy, kritičnost, RTO a RPO se převezmou z procesu a BIA a každý proces dostane stálý identifikátor (F1, F2 …). U smlouvy, která podporuje kritickou nebo důležitou funkci, je třeba vyplnit i výpovědní lhůty, rozhodné právo, místo poskytování a uložení dat, citlivost dat, míru závislosti a posouzení služby (nahraditelnost, strategie ukončení, alternativy); subdodavatele uveďte v dodavatelském řetězci. Na záložce **Subjekty** vyplňte LEI a typ finančního subjektu.

**Kontrola úplnosti** vypíše chybějící povinné údaje s kódem sloupce šablony (např. B_02.02.0050) a kliknutím otevře úpravu; LEI se ověřuje kontrolním součtem. **Koncentrace** ukazuje, kolik kritických funkcí podporuje jeden poskytovatel nebo jeho skupina. **Export šablon (CSV)** stáhne ZIP se soubory B_01.01 až B_07.01 v rozvržení sloupců šablon (číselníky jako pořadové číslo možnosti) – podklad pro nástroj, který vytvoří balíček pro podání ČNB.

## Termíny
Konec platnosti smlouvy se objeví na Přehledu a ve **Moje povinnosti** odpovědného místa.

## Zprávy o ujištění (SOC 2, ISO 27001)
Na detailu dodavatele v kartě **Zprávy o ujištění** evidujte SOC 2 / SOC 1 zprávy, certifikáty ISO 27001 a penetrační testy: druh, auditor, období, výrok a platnost (výchozí konec období + 12 měsíců). Zprávu nahrajte jako PDF – text pro AI se získá převodní službou na serveru; u skenu nebo bez převodní služby vložte potřebné kapitoly ručně.
- **AI vytěžení** (lokální model) navrhne **CUEC** – kontroly, které musíme zajistit my – s návrhem vlastního opatření, **výjimky z testování** s odpovědí vedení dodavatele a **kontroly vyňatých subdodavatelů**. Do modelu jde jen výňatek zprávy a názvy opatření; položky vzniknou až po přijetí.
- **CUEC → opatření**: každou CUEC namapujte na vlastní opatření. CONTIX upozorní, když CUEC nemá opatření nebo je opatření plánované, nezavedené či neúčinné.
- **Výjimky → rizika**: u výjimky tlačítkem **Založit riziko dodavatele** vznikne neohodnocené riziko navázané na dodavatele s popisem z výjimky.
- **Mezery zprávy**: konec platnosti (připomene se i v povinnostech), výrok s výhradou, období starší 3 měsíců bez „bridge letter“, nevyřešené výjimky, vyňatí subdodavatelé.
`,
  },
  {
    id: "aiact",
    title: "Umělá inteligence (AI Act)",
    audience: ["manager", "gestor"],
    routes: ["/aiact"],
    module: "aiact",
    summary: "Registr AI systémů, zakázané praktiky, klasifikace rizika, povinnosti zavádějícího subjektu i poskytovatele, FRIA, schválení použití a AI gramotnost.",
    body: `
## Registr AI systémů
Do registru zapište **každý AI nástroj**, který organizace používá nebo zvažuje – cloudové služby (ChatGPT, Copilot, překladače), funkce AI v jiných aplikacích, chatboty, lokálně provozované modely i vlastní vývoj. U systému uveďte **roli organizace** (zavádějící subjekt = uživatel, poskytovatel = kdo systém vyvíjí nebo uvádí na trh pod svým jménem), **účel použití**, uživatele, **vstupní data** a **výstupy**, umístění dat, vlastníka (funkční místo) a osobu pro **lidský dohled**. Systém navažte na procesy, aktiva, dodavatele, činnosti zpracování (GDPR), **rizika** z registru a **opatření**, která jeho riziko snižují – u rizika i opatření se pak AI systém ukáže ve vazbách. Nový systém začíná ve stavu **Navrženo ke schválení**.

## Screening a klasifikace
Screening má tři části: **zakázané praktiky** (čl. 5 – zaškrtnutá praktika znamená, že systém nesmí být používán), **vysoce rizikové použití** (oblasti přílohy III – nábor a řízení zaměstnanců, vzdělávání, bonita, pojištění, veřejné dávky, kritická infrastruktura…, nebo bezpečnostní komponenta výrobku podle přílohy I) a **transparentnost** (čl. 50 – chatbot, generovaný obsah, deepfake, rozpoznávání emocí). U použití z přílohy III lze uplatnit **výjimku čl. 6 odst. 3** (úzký procedurální úkol, přípravný úkol…), ta ale neplatí, pokud systém **profiluje** osoby. Klasifikace se počítá z odpovědí: zakázaná praktika → vysoké riziko → omezené riziko (transparentnost) → minimální riziko. Náhled výsledku vidíte hned, platí po uložení.

## Povinnosti
Podle role a klasifikace se sestaví **seznam povinností** s odkazem na článek a datem, od kdy platí – u zavádějícího subjektu např. používání podle návodu, lidský dohled, monitorování, uchování logů 6 měsíců, informování zaměstnanců a dotčených osob, DPIA, FRIA; u poskytovatele systém řízení rizik a kvality, technická dokumentace (příloha IV), logování, posouzení shody, EU prohlášení a CE, registrace v databázi EU, monitorování po uvedení na trh a hlášení závažných incidentů. U každé povinnosti vedete **stav** (nesplněno / rozpracováno / splněno / netýká se) a poznámku s dokladem. Pro všechny systémy platí **AI gramotnost** (čl. 4).

## Schválení použití
Systém schvaluje **vlastník** (držitel funkčního místa) nebo správce AI tlačítkem **Schválit použití** se zdůvodněním a podmínkami. Schválit nelze bez screeningu, zakázanou praktiku ani vysoce rizikový systém bez pověřeného lidského dohledu. Do stavu **Používá se** lze převést jen schválený systém; změní-li se screening na zakázanou praktiku, schválení se zruší. Po schválení běží **pravidelný přezkum** (objeví se v Mých povinnostech).

## FRIA
**Posouzení dopadu na základní práva** (čl. 27) je povinné pro vysoce rizikové systémy z přílohy III u subjektů veřejného práva a poskytovatelů veřejných služeb a vždy u posuzování bonity a životního a zdravotního pojištění. Vyplňte prvky a–f, datum oznámení orgánu dozoru a další přezkum a FRIA **dokončete** – dokončené je zamčené, pro úpravu ho správce znovu otevře. FRIA může navázat na DPIA navázané činnosti zpracování.

## Směrnice a AI gramotnost
Tlačítko **Vytvořit směrnici ze šablony** založí v Dokumentaci návrh **Směrnice o používání umělé inteligence** (se seznamem schválených nástrojů z registru) a podřízené **jednostránkové shrnutí pro zaměstnance** s testem porozumění a vyžadovaným seznámením pro všechny; volitelně i **kurz AI gramotnosti** (ročně) navázaný na shrnutí. Texty před schválením upravte podle organizace a nechte je projít oběhem. Karta ukazuje stav proškolení u kurzů s tématem „AI gramotnost“.

## Termíny
Termíny odpovídají znění nařízení (EU) 2026/1744 (Digital Omnibus): zákazy a AI gramotnost od 2. 2. 2025, transparentnost od 2. 8. 2026, nové zákazy od 2. 12. 2026, vysoce rizikové systémy z přílohy III od 2. 12. 2027 a z přílohy I od 2. 8. 2028. **Registr AI systémů** (tisk a Word) slouží jako podklad pro audit a dozor.
`,
  },
  {
    id: "soc2",
    title: "Zprávy SOC 2",
    audience: ["manager"],
    routes: ["/soc2"],
    module: "soc2",
    summary: "Zakázka auditora SOC 2: rozsah TSC, popis systému, CUEC a subdodavatelé, matice kritérium → opatření → testy → výjimky, pracovní papíry, PBC a zpráva Type I / Type II ve Wordu.",
    body: `
## Zakázka
**Nová zakázka SOC 2** založí audit typu „Ověření SOC 2“ (s požadavky PBC, přidělenými externími auditory a zjištěními) a k němu údaje zprávy: **druh zprávy** (Type I = vhodnost návrhu ke dni, Type II = návrh a provozní účinnost za období), **kategorie TSC** (bezpečnost je vždy, volitelně dostupnost, důvěrnost, integrita zpracování, ochrana soukromí), posuzovaný **systém** a auditorská společnost. Zakázka je ve společnosti klienta – auditor pracuje s jejími opatřeními, testy a důkazy.

## Kritéria a testy
Karta **Kritéria a testy** je matice pro každé kritérium v rozsahu: vazba na **§ vyhlášky 409** a **ISO/IEC 27001:2022**, **opatření** organizace namapovaná na kritérium (požadavky „soc2:…“ u opatření), **testy** v rozsahu zprávy (Type I testy návrhu, Type II testy účinnosti, jejichž období se překrývá se sledovaným obdobím) s počtem vzorků a selhání, stav **PBC** podle odkazu požadavku a **pracovní papír** (závěr a poznámka auditora). Kritéria bez opatření doplníte tlačítkem **Namapovat opatření na TSC** (crosswalk vyhlášky a knihovny rámců) nebo ručně na detailu opatření; testy a vzorky se vedou v **Opatření → Testy a důkazy**.

**Výjimka** se zakládá u kritéria (případně s vazbou na test) jako zjištění auditu s kódem EX-nn; **vyjádření vedení** se zapisuje přímo u výjimky a objeví se v oddílu V zprávy. Závěr kritéria „Nerelevantní“ vyřadí kritérium z oddílu IV (zdůvodnění uveďte v popisu systému).

## PBC
**Vložit standardní PBC** založí typické požadavky na podklady ke kritériím v rozsahu (u Type II i populace za období pro výběr vzorků) – kontaktní osoby, termíny a odesílání podkladů pak probíhají v **Audit a požadavky PBC** (portál externího auditora).

## Popis systému
Oddíly popisu podle kritérií popisu systému (služby, závazky a systémové požadavky, komponenty – infrastruktura, software, lidé, postupy, data, kontrolní prostředí, posuzování rizik, informace a komunikace, monitorování, incidenty, změny, nerelevantní kritéria). **CUEC** a **kontroly subdodavatelů (CSOC)** zapisujte po řádcích s kritérii v hranatých závorkách, např. „Zákazník spravuje přístupy svých uživatelů [CC6.2, CC6.3]“. U subdodavatele navázaného na dodavatele CONTIX ukáže jeho poslední **zprávu SOC 2** (výrok, platnost, nedostatky); tlačítkem **Převzít CSOC ze zprávy** doplníte kontroly subdodavatele evidované u zprávy. Bez zprávy upozorní, ať ji vyžádáte nebo zvolíte inkluzivní metodu.

## Zpráva
Karta **Zpráva** ukazuje **připravenost** (chybějící období, oddíly popisu, kritéria bez opatření či testu, neuzavřené pracovní papíry, výjimky bez vyjádření vedení, chybějící podpis a datum) a stáhne **zprávu ve Wordu** nebo k tisku: oddíl I zpráva nezávislého auditora (podle zvoleného výroku), II tvrzení vedení, III popis systému s CUEC a subdodavateli, IV kritéria, kontroly, testy a výsledky, V další informace a vyjádření vedení. Texty jsou vlastní texty CONTIXu, ne vzorová zpráva AICPA, a text kritérií TSC se nevkládá (jen ID a stručný popisek) – zprávu před vydáním zkontrolujte a upravte.

## Mapování TSC
Karta **Mapování TSC ↔ 409 / ISO** na přehledu ukazuje ke každému kritériu příslušné paragrafy vyhlášky 409 a opatření ISO/IEC 27001:2022 – pomůcka pro organizace, které už mají ISMS podle vyhlášky nebo ISO a připravují se na SOC 2.
`,
  },
  {
    id: "cra",
    title: "Kybernetická odolnost produktů (CRA)",
    audience: ["manager", "gestor"],
    routes: ["/cra"],
    module: "cra",
    summary: "Produkty s digitálními prvky podle nařízení (EU) 2024/2847: kategorie, posouzení shody, požadavky přílohy I, podpůrné období, SBOM a hlášení zranitelností a incidentů podle čl. 14.",
    body: `
## Produkty
Zapište **produkty s digitálními prvky**, které organizace vyrábí (nebo uvádí na trh pod svým jménem), dováží nebo distribuuje – software, hardware i jejich kombinace. U produktu uveďte **roli organizace** (výrobce, dovozce, distributor, správce open source), zamýšlený účel, členské státy, kde je dodáván, a vlastníka (funkční místo).

## Kategorie a posouzení shody
**Kategorie**: výchozí, **důležitý produkt třídy I** nebo **II** (příloha III – např. správa identit, prohlížeče, správci hesel, VPN, SIEM, operační systémy, routery; třída II hypervisory, firewally a IDS/IPS) nebo **kritický produkt** (příloha IV – bezpečnostní schránky, brány chytrých měřičů, čipové karty). Technický popis kategorií obsahuje prováděcí nařízení (EU) 2025/2392. Podle kategorie CONTIX ukáže přípustné **postupy posuzování shody** (modul A interní kontrola, B + C, H nebo certifikát EUCC) a upozorní na nepřípustnou volbu. Dále evidujete harmonizované normy, oznámený subjekt, datum EU prohlášení o shodě a označení CE, uvedení na trh a **konec podpůrného období** (zpravidla alespoň 5 let; kratší vyžaduje zdůvodnění) a kontakt pro hlášení zranitelností a politiku koordinovaného zveřejňování.

## Požadavky
Seznam se sestaví podle role: u výrobce **příloha I část I** (bezpečnostní vlastnosti – bez známých zneužitelných zranitelností, bezpečná výchozí konfigurace, aktualizace, řízení přístupu, šifrování, integrita, minimalizace dat, dostupnost, omezení plochy útoku, záznamy, odstranění dat), **část II** (zvládání zranitelností – SBOM, náprava, testy, zveřejnění, CVD, kontakt, distribuce a bezplatnost aktualizací) a **povinnosti** (posouzení rizik, náležitá péče u komponent, technická dokumentace, posouzení shody, prohlášení, CE, informace pro uživatele, uchování 10 let, hlášení); u dovozce a distributora jejich ověřovací povinnosti. U každého požadavku vedete stav a doklad.

## Vazby produktu
V kartě **Vazby produktu** propojíte produkt s **aktivy** (servery, služby, na kterých běží nebo ze kterých se skládá), **dodavateli** komponent a služeb, **procesy** a **riziky**. Produkt se pak objeví i v kartě **Kde je záznam použit** u aktiva, dodavatele, procesu a rizika. U nálezu zranitelnosti komponenty tlačítko **Založit riziko** vytvoří riziko (jen na váš pokyn) navázané na produkt a jeho aktiva; ohodnocení doplníte v detailu rizika. CVE v nálezu vedou na přehled zranitelnosti napříč aktivy.

## SBOM
**Nahrát SBOM** načte komponenty ze souboru **CycloneDX JSON** nebo **SPDX JSON** (název, verze, purl, dodavatel, licence) nebo přímo ze **zámku závislostí** – **bun.lock**, **package-lock.json** (npm) a **requirements.txt** (pip, purl se doplní automaticky) – a nahradí dosavadní seznam; jednotlivé komponenty lze doplnit ručně. Soubor se zpracuje jen v CONTIXu, nic se nikam neodesílá.

## Zranitelnosti komponent a VEX
Na kartě **Databáze OSV** zvolíte ekosystémy (npm, PyPI, Maven, Go, Debian, Alpine…) a CONTIX stáhne jejich databázi zranitelností z veřejného bucketu OSV – jen stahuje, nic neodesílá; server bez internetu nahraje soubor all.zip ručně. Komponenty SBOM s purl se pak **lokálně porovnají** podle verze (shoda je orientační – ověřte ji) a u produktu se objeví v kartě **Zranitelnosti komponent a VEX**. Ke každé zranitelnosti zapíšete **prohlášení VEX**: prošetřuje se, zasaženo (s opatřením), nezasaženo (vždy se zdůvodněním – kód není přítomen, nevykonává se, útočník ho nemůže ovlivnit, zmírněno jiným opatřením) nebo opraveno. Komponenty bez pokrytí OSV (pkg:generic, firmware v C) doplníte ručně podle CVE. Zranitelnost z **katalogu KEV** (aktivně zneužívaná) je zvýrazněná a jedním klikem z ní založíte **hlášení čl. 14**. Prohlášení se exportují jako **OpenVEX** nebo **CycloneDX VEX** pro zákazníky a orgány dozoru. Po novém SBOM se shody přepočítají – zmizelé komponenty a verze se označí jako neaktuální.

## Dovozce a distributor
U produktů jiných výrobců (role **dovozce** nebo **distributor**) je karta **Doklady výrobce**: označení CE, EU prohlášení o shodě, informace a pokyny podle přílohy II (kontakt výrobce a místo pro hlášení zranitelností, identifikace, účel, **datum konce podpory**, bezpečnostní pokyny), údaje dovozce a u dovozce i technická dokumentace a posouzení shody. U každého dokladu nastavíte stav (chybí / ověřeno / netýká se), poznámku, odkaz a přiložíte soubor; zapíše se datum a kdo ověřil. Neověřené doklady a chybějící datum konce podpory výrobce se ukážou v mezerách produktu. SBOM od výrobce nepotřebujete – je součástí jeho technické dokumentace.

## Oznámení výrobců (CSAF) a NVD
Zranitelnosti produktů bez SBOM získáte z **bezpečnostních oznámení výrobce ve formátu CSAF 2.0** (soubory .json na stránkách výrobce): záložka **Oznámení výrobců** → **Nahrát oznámení CSAF**. CONTIX oznámení napáruje na vaše produkty – přednostně podle **CPE** produktu (pole v kartě produktu), jinak podle výrobce, názvu a verze – a založí nálezy se stavem podle výrobce (zasaženo, opraveno, nezasaženo se zdůvodněním, prošetřuje se) a s doporučeným řešením. Novější revize oznámení stav aktualizuje; vaše vlastní posouzení VEX se nepřepíše, pokud se od výrobce liší (u nálezu uvidíte, co uvádí výrobce). Soubor se jen načte, nic se neodesílá. Volitelně lze pro produkty s CPE povolit **dohledání v databázi NVD** – do NVD odchází jen identifikátor CPE, proto je to ve výchozím stavu vypnuté a zapíná to správce.

## Hlášení podle čl. 14
Od **11. 9. 2026** musí výrobci hlásit **aktivně zneužívané zranitelnosti** a **závažné incidenty** s dopadem na bezpečnost produktu – i u produktů, které už jsou na trhu. **Nové hlášení** založíte s okamžikem **zjištění** (kdy jste získali přiměřenou jistotu) a CONTIX spočítá lhůty: **včasné varování do 24 hodin**, **oznámení do 72 hodin** a **závěrečnou zprávu** – u zranitelnosti do 14 dní od dostupnosti nápravy, u incidentu do 1 měsíce od oznámení. Lhůty se objeví v Mých povinnostech. Pro každou fázi CONTIX připraví **text hlášení** (česky nebo anglicky) k opsání do jednotné platformy ENISA (SRP) – hlášení jde koordinujícímu CSIRT (v Česku NÚKIB) a ENISA. Po podání zapište čas a číslo hlášení v SRP; nezapomeňte informovat dotčené uživatele (čl. 14 odst. 8).

## Termíny
Hlášení od 11. 9. 2026, ustanovení o oznámených subjektech od 11. 6. 2026, ostatní povinnosti od 11. 12. 2027. Blížící se konec podpůrného období hlídá povinnost „Konec podpůrného období produktu“.
`,
  },
  {
    id: "gdpr",
    title: "Ochrana osobních údajů (GDPR)",
    audience: ["manager"],
    routes: ["/gdpr"],
    module: "gdpr",
    summary: "Záznamy o činnostech zpracování, screening a posouzení vlivu (DPIA).",
    body: `
## Záznamy o činnostech zpracování
**Nová činnost** – účel, právní základ, kategorie subjektů a osobních údajů, příjemci, předání do třetích zemí, lhůty pro výmaz a technická a organizační opatření (čl. 30 GDPR). Činnost navažte na procesy a aktiva – zabezpečení pak vychází z jejich hodnocení. Přehled ukazuje chybějící údaje (mezery).

## Posouzení vlivu (DPIA)
**Screening** podle kritérií rizikového zpracování ukáže, zda je DPIA povinné. DPIA obsahuje popis zpracování, nezbytnost a přiměřenost, rizika pro subjekty a opatření; po schválení se zamkne. Chybějící DPIA se ukáže na Přehledu.
`,
  },
  {
    id: "ai",
    title: "AI asistent a dotazy v přirozeném jazyce",
    audience: ["manager", "admin"],
    routes: ["/ask", "/admin/ai"],
    summary: "Co AI v CONTIXu dělá, co nedělá a kde běží.",
    body: `
## Zeptat se AI
Položte dotaz běžnou řečí („Která kritická aktiva nemají vlastníka?“). Asistent jen čte – vybere vhodné přehledy, CONTIX je spustí s vašimi oprávněními a model výsledek shrne.

## AI vstup na Přehledu
Na úvodní stránce je jedno pole pro všechny dotazy. CONTIX k dotazu dohledá úryvky platné dokumentace a podobné záznamy (rizika, zranitelnosti, incidenty, výjimky) – je-li to v Administrace → AI asistent zapnuté – a model podle potřeby spustí i přehledy nad daty. Odpověď obsahuje čísla [1], [2] s odkazy na konkrétní dokument nebo záznam. Pod polem jsou rychlé dotazy podle vašich oprávnění; „Co je po termínu?“ se zvýrazní, když něco po termínu je. Celé tabulky a historie jsou v Zeptat se AI.

## Návrhy
U rizik, opatření, aktiv, incidentů a dokumentů může AI navrhnout opatření, mapování, klasifikaci nebo kontrolu dokumentu vůči vyhlášce. Návrh se nikdy neuloží sám – každou položku přijímáte nebo zamítáte vy.

## Zeptej se dokumentace
V **Administrace → AI asistent** zapněte „Zeptej se dokumentace“ a zadejte model pro vyhledávání podle významu (doporučeno bge-m3; na serveru s Ollamou \`ollama pull bge-m3\`). Platné verze dokumentů se rozdělí na úseky a zaindexují (stav a „Přeindexovat“ jsou tamtéž, souhrn v Provozu). Návrhy se neindexují; odpovědi vycházejí jen z dokumentů, které uživatel smí číst.

## Podobné záznamy a vyhledávání v evidencích
Zapněte v **Administrace → AI asistent** „Vektory záznamů“ – rizika, zranitelnosti, incidenty a výjimky se zaindexují stejným modelem jako dokumentace (stav a „Přeindexovat“ tamtéž). Na kartě incidentu a rizika pak uvidíte **Podobné záznamy** a dotazy na evidence dostanou odpověď s odkazy na konkrétní záznamy. Každý vidí jen záznamy, ke kterým má oprávnění.

## Znalostní báze a správa indexu
Ve vektorech jsou kromě rizik a incidentů také **opatření, aktiva, procesy, dodavatelé, posouzení změn předpisů, schválené odpovědi dotazníků a zveřejněné znalostní články** – AI asistent i rychlé hledání je najdou podle významu. V **Administrace → AI asistent** u Vektorů záznamů vidíte průběh indexace, jednotlivé druhy můžete vypnout (z indexu se odeberou) a v **Procházet index** zobrazíte přesný text, který model dostane, a vybraný záznam **vyřadíte** – nehledá se a modelu se neposílá ani po přeindexování. Hledání slov používá fulltext bez diakritiky s předponami slov (najde i jiné tvary slova); u běžných embedding modelů (384, 768, 1024, 1536 rozměrů) se hledá přes index HNSW, takže zůstává rychlé i u desítek tisíc záznamů. AI návrhy odpovědí na dotazníky zákazníků berou ze schválené knihovny a opatření i jinak formulované otázky.

## AI pro AI Act, CRA a incidenty
- **AI Act** – na detailu AI systému navrhne AI vyplnění screeningu (zakázané praktiky, příloha III, výjimky, transparentnost). Po přijetí se klasifikace přepočte; vyjde-li zakázaná praktika, rozhodnutí se vrátí k novému posouzení.
- **CRA** – u produktu se zranitelnostmi ve stavu „Prošetřuje se“ navrhne AI stav VEX, odůvodnění a popis dopadu. Bere v úvahu KEV a EPSS.
- **Incidenty** – triáž navrhne, zda jde o událost či incident, kategorii, příčinu a zda jde o porušení zabezpečení osobních údajů. Jako kontext použije podobné minulé případy, které smíte číst.
Každý návrh jen navrhuje – nic se neuloží bez vašeho přijetí.

## Související záznamy a úkoly
Karta **Související záznamy** (např. u revize informačního systému nebo zranitelnosti) najde podle významu rizika, incidenty, zranitelnosti produktů a AI systémy, které se týkají stejného tématu. Ve vektorech jsou nově i nálezy auditů včetně výjimek SOC 2, AI systémy a zranitelnosti produktů. Úkoly lze zakládat přímo u AI systému, produktu CRA a zakázky SOC 2.

## Kde AI běží
Model běží na serveru organizace (lokálně). Do modelu se neposílají jména osob ani e-maily; každý požadavek se zapisuje do auditního záznamu.
`,
  },
  {
    id: "identity",
    title: "Identity a přístupy: kontrola účtů v AD a Entra ID",
    audience: ["manager", "admin"],
    routes: ["/identity"],
    module: "identity",
    summary: "Neaktivní a privilegované účty, rizikové nastavení účtů, MFA – nálezy, výjimky a export pro auditora.",
    body: `
## K čemu to je
CONTIX pravidelně načte účty z Active Directory a Microsoft Entra ID a zkontroluje je podle pravidel: neaktivní účty, účty, které se nikdy nepřihlásily, účty odešlých zaměstnanců (deaktivovaných v CONTIXu), hesla bez expirace, účty bez hesla nebo bez předautentizace Kerberos, uživatelské účty se SPN (Kerberoasting), neomezená delegace, staré heslo správce, chybějící MFA a příliš mnoho členů privilegovaných skupin. **CONTIX v adresáři nic nemění** – jen čte a ukazuje, co je potřeba udělat.

## Připojení adresáře (správce)
Záložka **Zdroje** → **Active Directory** nebo **Microsoft Entra ID**:
- **AD** – adresa \`ldaps://řadič:636\`, Base DN, účet jen pro čtení (běžný doménový účet bez správcovských práv) a heslo. Pokud řadič používá certifikát interní CA, vložte její kořenový certifikát.
- **Entra ID** – registrace aplikace s tajným klíčem a oprávněními typu Application \`User.Read.All\`, \`RoleManagement.Read.Directory\` a s licencí Entra ID P1 \`AuditLog.Read.All\` (poslední přihlášení, registrace MFA). Bez licence P1 se neaktivní účty a MFA nevyhodnotí – zdroj to uvede v poznámce.
Tlačítkem **Otestovat připojení** ověřte nastavení, pak **Uložit** a **Synchronizovat**. Hybridní organizace připojí oba zdroje. Privilegované skupiny AD se poznají podle SID (i na serveru v češtině), další skupiny nebo role lze doplnit. Pravidla (počet dní neaktivity, stáří hesla správce, limit členů) lze u zdroje upravit.

## Práce s nálezy
- **Přehled** ukazuje nálezy podle závažnosti a pravidla, vývoj v čase a stav zdrojů.
- **Nálezy** – u pravidla je vysvětleno, proč na něm záleží a co udělat. Nález opravte v adresáři; při další synchronizaci se sám označí jako **vyřešený**.
- Pokud je stav vědomě přijatelný (např. servisní účet s dlouhým heslem), udělte **výjimku** s odůvodněním a termínem. Po termínu se nález znovu otevře. Výjimky se zapisují do auditních záznamů.
- **Účty** – vyhledávání, filtr privilegovaných, zakázaných a odstraněných účtů; detail ukazuje skupiny včetně vnořených a historii nálezů.
- **Nálezy (CSV)** stáhne seznam pro auditora nebo pro předání správcům AD.

## Toxické kombinace (oddělení povinností)
Záložka **Toxické kombinace** → **Nové pravidlo**: strana A a strana B (skupiny AD, role Entra ID nebo funkční místa CONTIXu). Porušením je osoba, která má něco z A i z B – např. „Správce domény nesmí schvalovat platby“ (A: Domain Admins, B: funkční místo Schvalovatel plateb). Účty z AD i Entra ID se spojí přes uživatele CONTIXu (stejný e-mail) a jeho funkční místa. Pravidla se vyhodnotí po každé synchronizaci a pravidelně plánovačem; porušení lze vyřešit změnou přístupů nebo obsazení místa, případně udělit výjimku s termínem.

## Přezkum přístupů (recertifikace)
Záložka **Přezkum přístupů** → **Nový přezkum**: rozsah (zdroje, jen privilegované účty, vybrané skupiny), kdo rozhoduje (jedno funkční místo, nebo vedoucí útvaru držitele účtu) a termín. Seznam účtů a přístupů se při zahájení zmrazí a recenzenti dostanou úkol do **Moje povinnosti**. U každého účtu rozhodnou **Ponechat** / **Odebrat** (s popisem, co odebrat). Odebrání provede správce adresáře – CONTIX ho při další synchronizaci ověří (účet zakázaný nebo bez přezkoumaných přístupů), jinak ho lze potvrdit ručně. Po rozhodnutí všech položek přezkum **uzavřete**; **Protokol** (tisk / Word) je doklad pro audit. Doporučení: privilegované účty čtvrtletně, ostatní alespoň ročně.

## Synchronizace uživatelů a struktury
V nastavení zdroje zapněte **Synchronizovat uživatele a organizační strukturu** a zadejte skupinu, jejíž členové mají být uživateli CONTIXu (např. „CONTIX-Uzivatele“). Při každé synchronizaci CONTIX:
- založí chybějící uživatele (přihlašují se přes SSO) s výchozí rolí,
- založí útvary podle atributu **department** a funkční místa podle **title** a obsadí je,
- deaktivuje uživatele, jejichž účet je zakázaný, odstraněný nebo mimo skupinu.
Ručně založené uživatele ani funkční místa synchronizace nemění. **Náhled změn** ukáže dopad předem. Odpovědnosti (gestor, vlastník rizika…) přiřazujte dál ručně – synchronizovaná místa slouží hlavně k okruhům osob a vedoucím pro přezkumy. U Entra ID je potřeba oprávnění GroupMember.Read.All.

## Automatické testy opatření
Záložka **Testy opatření**: k opatření (např. „Řízení přístupových oprávnění“) přiřaďte **kontrolu účtů** (týdně / měsíčně / čtvrtletně, tolerance kritických a vysokých nálezů) nebo **přezkum přístupů**. CONTIX pak sám zapíše k opatření dokončený test se vzorkem za každé pravidlo (nebo účet) a důkaz – CSV nálezů, resp. protokol přezkumu. Test se neprovede, pokud poslední synchronizace zdroje selhala. Účinnost opatření se změní jen při zapnuté volbě „nastavit účinnost“.

## Oprávnění
Čtení: **identity:read** (CISO, manažer KB, auditor). Výjimky a ruční synchronizace: **identity:write**. Připojení adresářů: správce systému. Zaměstnanci k účtům ostatních přístup nemají.
`,
  },
  {
    id: "access-review",
    title: "Přezkum přístupů: jak rozhodnout",
    audience: ["employee", "gestor", "manager"],
    routes: ["/identity/reviews"],
    module: "identity",
    summary: "Úkol recenzenta: u každého účtu potvrdit, zda přístup ponechat, nebo odebrat.",
    body: `
## Co se po vás chce
Jako vedoucí nebo vlastník systému potvrzujete, že lidé mají jen přístupy, které k práci potřebují. Úkol najdete v **Moje povinnosti**; odkaz otevře seznam účtů, o kterých rozhodujete vy.

## Jak rozhodnout
1. U účtu se podívejte na **přístupy** (skupiny, role; červeně privilegované) a datum posledního přihlášení.
2. Potřebuje-li držitel přístup k práci, klikněte na **Ponechat**.
3. Nepotřebuje-li ho (změna pozice, odchod, nevyužívaný účet), klikněte na **Odebrat** a napište, co odebrat – např. „zakázat účet“ nebo „odebrat ze skupiny Účetní“.
Rozhodnutí můžete do uzavření přezkumu změnit. Odebrání provede správce adresáře; vy nic dalšího dělat nemusíte.

## Nevíte si rady?
Pokud účet nepoznáváte nebo o něm nemá rozhodovat váš útvar, napište do poznámky u rozhodnutí, nebo kontaktujte manažera kybernetické bezpečnosti – může položku předat jinému recenzentovi.
`,
  },
  {
    id: "group",
    title: "Skupina společností",
    audience: ["manager", "admin"],
    routes: ["/group", "/admin/companies"],
    summary: "Více společností v jednom CONTIXu: režim podle zákona, přehled skupiny a vlastní nastavení.",
    body: `
## Společnosti
**Administrace → Společnosti** – založení společnosti, nadřazená společnost a **režim podle zákona** (vyšší povinnosti – vyhl. 409, nižší povinnosti – vyhl. 410, neregulovaná) s regulovanými službami. Společnost může mít vlastní metodiku hodnocení rizik, únosnou míru újmy, kritéria významných změn nebo rozsah zprávy SOC 2; jinak platí nastavení organizace. Smazat lze jen společnost bez dat, jinak ji deaktivujte.

## Práce ve skupině
Společnost, se kterou pracujete, zvolíte v horní části menu. Data, oprávnění i úkoly se řídí zvolenou společností; role lze přidělit pro celou skupinu nebo jen pro jednu společnost.

## Přehled skupiny
**Přehled skupiny** porovná společnosti vedle sebe: míru shody, kritická a nepřijatelná rizika, akce po termínu, incidenty a hlášení po termínu, dodavatele s mezerami, stav hodnocení rizik, BIA a přezkoumání ISMS. Kliknutím na společnost do ní přepnete. Záznam (aktivum, proces, dokument…) lze do jiné společnosti přesunout v jeho detailu.
`,
  },
  {
    id: "import",
    title: "Import dat z Excelu",
    audience: ["manager", "admin"],
    routes: ["/import"],
    summary: "Hromadné načtení aktiv, rizik, procesů, opatření a dodavatelů ze souboru .xlsx nebo .csv.",
    body: `
## Postup
1. **Soubor** – zvolte evidenci (aktiva, rizika, procesy, opatření, dodavatelé), nahrajte .xlsx nebo .csv a vyberte list. U existujících záznamů zvolte, zda se **aktualizují vyplněnými sloupci**, nebo **zůstanou beze změny**.
2. **Mapování sloupců** – CONTIX sloupce přiřadí podle názvů (i bez diakritiky a se synonymy); přiřazení zkontrolujte a doplňte povinná pole.
3. **Náhled a kontrola** – u každého řádku uvidíte, zda se založí, aktualizuje, nebo obsahuje chybu (neplatná hodnota, neexistující uživatel). Teprve pak klikněte na **Importovat**.

## Dobré vědět
Záznamy se párují s existujícími (aktiva podle sériového čísla, hostname nebo názvu; dodavatelé podle IČO; ostatní podle kódu nebo názvu), takže opakovaný import nevytvoří duplicity. Import se zapisuje stejně jako ruční zadání – s kontrolou oprávnění a do auditních záznamů. Aktiva z Wazuhu a síťového skenu načtete v **Discovery & import**.
`,
  },
  {
    id: "admin-setup",
    title: "Správce: první nastavení a průvodce",
    audience: ["admin"],
    routes: ["/admin/setup", "/admin"],
    summary: "Postup prvního nastavení nové organizace krok za krokem.",
    body: `
## Průvodce nastavením
**Administrace → Průvodce nastavením** ukazuje kroky a jejich stav (hotovo / rozpracováno / chybí) s odkazem na místo, kde se krok nastavuje. Doporučené pořadí:
1. Organizace – název, IČO, regulované služby a režim podle zákona.
2. Zabezpečení – dvoufázové ověření správců, SSO a povolené domény.
3. Organizační struktura – útvary, funkční místa a jejich obsazení, bezpečnostní role (manažer KB, architekt KB, auditor KB…).
4. Uživatelé a role – běžní zaměstnanci roli **Zaměstnanec**.
5. Aktiva – napojení Wazuhu, import, kontrola vlastníků.
6. Rizika, opatření a prohlášení o aplikovatelnosti.
7. Dokumentace – složky (lze založit výchozí strukturu), šablony, bezpečnostní politika.
8. Upozornění (e-mail / Teams), AI asistent, zálohy a převodní služba.
9. Volitelně připojení Active Directory / Entra ID pro kontrolu účtů (Identity a přístupy).

## Předávací protokol
Po dokončení stáhněte **Předávací protokol** (Word) – shrnuje stav nastavení, provozu a bezpečnosti k datu předání.

## Ukázková data
Pro vyzkoušení bez vlastních dat založí příkaz \`bun run demo:seed\` (na serveru \`docker compose --profile full exec api bun src/scripts/demo-seed.ts\`) fiktivní společnost **Vzorová strojírna a.s. (ukázka)** s organizací, aktivy, procesy, riziky, opatřeními, dodavateli a úkoly. Je to samostatná společnost skupiny – vaše data neovlivní. Opakované spuštění nic nepřidá.

## Licence a zdrojový kód
CONTIX je svobodný software pod licencí AGPL-3.0. Verze, licence a odkaz na zdrojový kód jsou dole v menu. Odkaz nastavíte proměnnou **CONTIX_SOURCE_URL** v konfiguraci serveru; provozujete-li upravenou verzi, má vést na upravený kód.
`,
  },
  {
    id: "admin-users",
    title: "Správce: uživatelé, role, SSO a zabezpečení",
    audience: ["admin"],
    routes: ["/admin/users", "/admin/roles", "/admin/groups", "/admin/settings", "/admin/login", "/admin/audit"],
    summary: "Účty, role a oprávnění, skupiny, přihlašování přes Entra ID / AD FS a bezpečnostní nastavení.",
    body: `
## Uživatelé a role
Role jsou sady oprávnění; systémové role (Administrátor, CISO, Manažer KB, Architekt, SOC analytik L1 a L2, Správce IT, Pověřenec pro ochranu osobních údajů, Auditor, Zaměstnanec…) lze upravit nebo vytvořit vlastní. SOC analytik L1 alerty třídí a zásahy jen navrhuje, L2 je schvaluje (princip čtyř očí). Roli lze přidělit pro celou skupinu nebo jen pro jednu společnost. Skupiny usnadní přidělování rolí více lidem najednou.

## Přihlášení účty Active Directory
**Administrace → Přihlášení → Připojit AD**: adresa řadiče domény (ldaps://…:636), Base DN a účet pro čtení. Na řadiči musí běžet LDAPS s certifikátem; certifikát interní CA vložte do pole **Kořenový certifikát**, pro zkoušku lze ověřování vypnout. V části **Kdo se může přihlásit** omezíte přihlášení na členy skupin, zvolíte, zda se uživatel při prvním přihlášení založí, a výchozí roli. Tlačítkem **Vyzkoušet** ověříte jméno a heslo konkrétního uživatele – ukáže jeho skupiny a role, nic nezakládá. Pak přihlášení zapněte.

Uživatel se přihlásí stejným jménem a heslem jako do Windows (jan.novak, DOMÉNA\jan.novak nebo jan.novak@firma.local). Heslo ověřuje AD, CONTIX ho neukládá; zakázaný nebo uzamčený účet se nepřihlásí. Lokální účty s heslem CONTIXu (např. správce) se přihlašují dál svým heslem a s účtem AD se nepropojují – správce může účet převést v **Uživatelé** (Způsob přihlášení). Dvoufázové ověření CONTIXu platí i pro účty AD. Stejné připojení AD lze využít v **Identitách a přístupech** pro kontrolu účtů a synchronizaci uživatelů.

## Role podle skupin
V tabulce **Role podle skupin AD a SSO** přiřadíte roli skupiny (název skupiny AD, celé DN, u Entra ID ID skupiny). Platí i vnořené členství. Role ze skupin se obnovují při každém přihlášení; ručně přidělené role zůstávají.

## SSO
Přihlášení přes Microsoft 365 (Entra ID), Google nebo AD FS / Keycloak přidáte v **Administrace → Přihlášení → Přidat poskytovatele**: ID tenanta nebo vydavatele, ID klienta a tajný klíč (uloží se šifrovaně). Adresu pro přesměrování (Redirect URI) zadejte při registraci aplikace u poskytovatele. Poskytovatelé z konfigurace serveru se zobrazují také. Pravidla SSO určují, zda se uživatel při prvním přihlášení založí, s jakou rolí a z jakých **povolených domén**.

## Účty
U lokálního účtu může správce **resetovat heslo**, **resetovat MFA** (ztracený telefon) a **odemknout** účet uzamčený po opakovaných chybách. Účet odcházejícího zaměstnance deaktivujte – historie a doklady zůstanou zachované.

## Zabezpečení
Doporučeno: povinné dvoufázové ověření, krátký časový limit nečinnosti, uzamčení účtu po opakovaných chybách.

## Auditní záznamy
**Administrace → Auditní záznamy** obsahují přihlášení a neúspěšné pokusy, změny MFA a hesel, události SSO (např. nepovolená doména) a všechny změny dat – kdo, kdy, co a odkud. Filtrujte podle akce nebo e-mailu. Záznamy nelze upravit ani smazat.
`,
  },
  {
    id: "admin-methodologies",
    title: "Metodiky analýzy rizik a auditu",
    audience: ["manager", "admin"],
    routes: ["/admin/methodologies"],
    summary: "Vestavěná metodika podle vyhlášky, vlastní metodiky (OCTAVE…), import a kontrolní seznamy auditu.",
    body: `
## Vestavěná metodika
Výchozí hodnocení rizik odpovídá příloze č. 4 vyhlášky (dopad × hrozba × zranitelnost, stupnice a hranice se nastavují v **Nastavení**). Pro většinu organizací stačí.

## Vlastní metodika
**Upravit kopii** existující metodiky, nebo **Import metodiky** (YAML / JSON / XML – vložte obsah a nechte ho zkontrolovat). V editoru nastavíte:
- **faktory a stupnice** (např. pravděpodobnost, dopad; stupnice lze vložit z tabulky Excelu),
- **oblasti dopadu** s váhou a způsob sloučení hodnot po oblastech,
- **vzorec a úrovně** rizika,
a ověříte je ve **Zkoušce výpočtu**. Vzorec se vyhodnocuje bezpečně, bez spouštění kódu.

## Použití
Metodiku zvolíte u rizika nebo jako výchozí pro společnost (Administrace → Společnosti). Metodiku, která se používá, nelze smazat. Typ **Audit (kontrolní seznam)** slouží jako vlastní kontrolní seznam pro audity.
`,
  },
  {
    id: "admin-integrations",
    title: "Správce: Wazuh, síťový sken, e-mail a Teams",
    audience: ["admin"],
    routes: ["/admin/connectors", "/admin/notifications"],
    summary: "Nastavení konektorů a upozornění na lhůty.",
    body: `
## Wazuh
**Administrace → Konektory → Wazuh**:
- **Wazuh Server API** (manager, port 55000 – ne adresa dashboardu) s účtem jen pro čtení – agenti a jejich inventář (OS, HW, síť, software).
- **Wazuh Indexer** (port 9200) s účtem s právem čtení – zranitelnosti a alerty (role musí číst indexy zranitelností i \`wazuh-alerts-*\`).
- Automatická synchronizace aktiv a zranitelností a ověření TLS certifikátu (vypínat jen pro test).
Každé připojení ověřte tlačítkem **Otestovat**.

## Síťový sken (nmap)
Aktivní vyhledání zařízení bez agenta (síťové prvky, tiskárny, IoT). Sken je povolen jen v **povolených rozsazích (allow-list)**; spouští se v **Discovery & import**.

## Upozornění
**Administrace → Upozornění** – e-mail (SMTP server, odesílatel, TLS) a kanál Microsoft Teams (webhook, jen HTTPS adresy Microsoftu, ukládá se šifrovaně). Nastavte, kolik dní předem upozorňovat, hodinu denního souhrnu a zda jen v pracovní dny. Výstrahy incidentů chodí vždy. Tlačítkem testu ověřte doručení.
`,
  },
  {
    id: "admin-ops",
    title: "Správce: provoz, zálohy, aktualizace",
    audience: ["admin"],
    routes: ["/admin/ops"],
    summary: "Stav systému, zálohy a obnova, převodní služba a aktualizace.",
    body: `
## Provoz
**Administrace → Provoz** ukazuje stav databáze, záloh, plánovače, upozornění, Wazuhu, AI, převodní služby dokumentů a šifrovacího klíče. Totéž je dostupné pro monitoring (Prometheus) přes metriky s tokenem.

## Zálohy a obnova
Služba záloh zálohuje databázi denně (volitelně šifrovaně a mimo server). Obnovu vyzkoušejte hned po instalaci a pak pravidelně (skript restore.sh, postup v provozní dokumentaci).

## Aktualizace
Na serveru ve složce instalace: \`sudo ./infra/scripts/update.sh\` – před aktualizací se automaticky vytvoří záloha. U zákazníka bez přístupu k internetu se aktualizace dodává jako balíček.

## Konektory a upozornění
Wazuh, síťový sken, e-mail a Teams – viz téma **Správce: Wazuh, síťový sken, e-mail a Teams**.
`,
  },
];

/** Témata pro obrazovku: nejdřív ta, jejichž cesta odpovídá (nejdelší shoda), pak ostatní pro roli. */
export function helpForRoute(path: string, audience: HelpAudience[], enabledModules?: string[]) {
  const visible = HELP_TOPICS.filter((t) => t.audience.some((a) => audience.includes(a)) && (!t.module || !enabledModules || enabledModules.includes(t.module)));
  const score = (t: HelpTopic) => Math.max(-1, ...t.routes.map((r) => (r === "/" ? (path === "/" ? 1 : -1) : path === r || path.startsWith(`${r}/`) || path.startsWith(r) ? r.length : -1)));
  const matched = visible.filter((t) => score(t) >= 0).sort((a, b) => score(b) - score(a));
  return { matched, others: visible.filter((t) => !matched.includes(t)) };
}

/** Role pro nápovědu podle oprávnění uživatele. */
export function helpAudienceOf(can: (p: string) => boolean): HelpAudience[] {
  const out: HelpAudience[] = ["employee"];
  if (can("policies:read") || can("documents:approve")) out.push("gestor");
  if (can("risks:read") || can("controls:read") || can("isms:read") || can("incidents:read")) out.push("manager");
  if (can("admin:settings") || can("admin:users")) out.push("admin");
  return out;
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inlineHtml = (s: string) =>
  escHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<b>$1</b>");

/** Text tématu → HTML podmnožina pro tisk a Word (h3, p, ul/ol, b). Vše escapované. */
export function helpToHtml(md: string): string {
  const out: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inlineHtml(para.join(" "))}</p>`);
    para = [];
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = line.match(/^#{2,4}\s+(.*)$/);
    const ul = line.match(/^-\s+(.*)$/);
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (list && /^ {2,}/.test(raw) && !h) {
      // odsazený řádek = pokračování poslední položky seznamu
      list.items[list.items.length - 1] += ` ${line.replace(/^-\s+/, "– ")}`;
    } else if (h) {
      flush();
      out.push(`<h3>${inlineHtml(h[1]!)}</h3>`);
    } else if (ul || ol) {
      if (para.length) {
        out.push(`<p>${inlineHtml(para.join(" "))}</p>`);
        para = [];
      }
      const tag = ul ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</${list.tag}>`);
        list = { tag, items: [] };
      }
      list.items.push((ul ?? ol)![1]!);
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return out.join("\n");
}

/* ---------- úvodní prohlídka ---------- */

export interface TourStep {
  /** Klíč pro překlad (tour.<id>.title / .text). */
  id: string;
  title: string;
  text: string;
  /** Odkaz na položku menu, kterou prohlídka zvýrazní. */
  route?: string;
}

export function tourFor(audience: HelpAudience[]): TourStep[] {
  const steps: TourStep[] = [
    { id: "welcome", title: "Vítejte v CONTIXu", text: "Krátká prohlídka ukáže, kde najdete to podstatné. Kdykoli ji spustíte znovu v panelu Nápověda (otazník vpravo dole)." },
    { id: "my", title: "Moje práce", text: "Vše, co máte udělat: dokumenty k seznámení, školení a úkoly s termínem. Číslo v menu ukazuje, kolik úkolů čeká.", route: "/my" },
    { id: "docs", title: "Dokumenty", text: "Platné směrnice a postupy. Hledejte i v textu, potvrďte seznámení a pošlete připomínku, když je něco nejasné.", route: "/docs" },
    { id: "report", title: "Nahlásit událost", text: "Podezřelý e-mail, ztracený notebook nebo neobvyklé chování systému nahlaste hned – raději víckrát než jednou málo.", route: "/incidents" },
  ];
  if (audience.includes("gestor"))
    steps.push({ id: "policies", title: "Správa dokumentace", text: "Gestor tu připravuje nové verze (ze šablony nebo ve Wordu), vlastník procesu kontroluje a schvalovatel schvaluje. Úkoly přijdou do Moje povinnosti.", route: "/policies" });
  if (audience.includes("manager"))
    steps.push({ id: "risks", title: "Rizika, opatření a shoda", text: "Registr rizik, plán zvládání, katalog opatření a prohlášení o aplikovatelnosti. Přehled vlevo nahoře ukazuje stav celé organizace.", route: "/risks" });
  if (audience.includes("admin"))
    steps.push({ id: "setup", title: "Průvodce nastavením", text: "V Administraci najdete průvodce prvním nastavením organizace a předávací protokol.", route: "/admin/setup" });
  steps.push({ id: "help", title: "Nápověda", text: "Otazník vpravo dole otevře nápovědu k obrazovce, na které jste. Celou příručku si můžete stáhnout jako Word nebo vytisknout do PDF." });
  return steps;
}
