import { z } from "zod";

/* ============================================================
 * Určení regulace (v1.61, ADR-156): katalog regulovaných služeb podle přílohy vyhlášky č. 408/2025 Sb.
 * (znění účinné od 1. 11. 2025), velikost podniku podle doporučení Komise 2003/361/ES a vyhodnocení režimu.
 *
 * Služba = bod přílohy. `rules` – podmínky významnosti a režim; vyhodnocují se v pořadí, platí první splněné
 * pravidlo (vyšší povinnosti jsou vždy první). `when` je disjunkce konjunkcí atomů:
 *   "L" velký, "M" střední, "S" malý, "U" mikropodnik, jinak id podmínky ze `conds` (odpověď uživatele).
 * `require` – podmínky, bez kterých služba vůbec není regulovaná (např. 5 % obratu u vodárenství a odpadů).
 * `nace` – předpony kódů CZ-NACE (oddíl / skupina / třída) pro NÁVRH služeb z RES; nikdy nerozhodují samy.
 * ============================================================ */

export type EnterpriseSize = "micro" | "small" | "medium" | "large";
export type RegimeLevel = "higher" | "lower";

export interface RsCondition {
  id: string;
  text: string;
}
export interface RsRule {
  regime: RegimeLevel;
  when: string[][];
}
export interface RegulatedServiceDef {
  /** Číslo bodu přílohy, např. "16.13". */
  code: string;
  sector: number;
  name: string;
  /** Kdo je poskytovatelem (subjekt podle přílohy) – uživatel potvrzuje, že jím je. */
  subject: string;
  conds?: RsCondition[];
  require?: string[];
  rules: RsRule[];
  nace?: string[];
  /** Návrh podle institucionálního sektoru ESA 2010 (předpona kódu, např. "13" = vládní instituce). */
  esa?: string[];
}

export const RS_SECTORS: Record<number, string> = {
  1: "Veřejná správa",
  2: "Energetika – Elektřina",
  3: "Energetika – Ropa a ropné produkty",
  4: "Energetika – Zemní plyn",
  5: "Energetika – Teplárenství",
  6: "Energetika – Vodík",
  7: "Výrobní průmysl",
  8: "Potravinářský průmysl",
  9: "Chemický průmysl",
  10: "Vodní hospodářství",
  11: "Odpadové hospodářství",
  12: "Letecká doprava",
  13: "Drážní doprava",
  14: "Námořní vodní doprava",
  15: "Silniční doprava",
  16: "Digitální infrastruktura a služby",
  17: "Finanční trh",
  18: "Zdravotnictví",
  19: "Věda, výzkum a vzdělávání",
  20: "Poštovní a kurýrní služby",
  21: "Obranný průmysl",
  22: "Vesmírný průmysl",
};

/** Nejčastější vzor přílohy: velký podnik = vyšší, střední = nižší. */
const LM: RsRule[] = [
  { regime: "higher", when: [["L"]] },
  { regime: "lower", when: [["M"]] },
];
/** Velký nebo střední podnik = nižší povinnosti. */
const LM_LOWER: RsRule[] = [{ regime: "lower", when: [["L"], ["M"]] }];
const HIGHER: RsRule[] = [{ regime: "higher", when: [[]] }];
const LOWER: RsRule[] = [{ regime: "lower", when: [[]] }];
const REV5: RsCondition = { id: "rev5", text: "Příjmy spojené s touto službou tvořily alespoň 5 % obratu za poslední účetní období" };

const s = (code: string, name: string, subject: string, rules: RsRule[], extra: Partial<RegulatedServiceDef> = {}): RegulatedServiceDef => ({
  code,
  sector: Number(code.split(".")[0]),
  name,
  subject,
  rules,
  ...extra,
});

export const REGULATED_SERVICES: RegulatedServiceDef[] = [
  /* 1. Veřejná správa */
  s(
    "1.1",
    "Výkon svěřených pravomocí",
    "Orgán veřejné moci nebo jiný subjekt uvedený v bodu 1.1 přílohy",
    [
      { regime: "higher", when: [["pa_higher"]] },
      { regime: "lower", when: [["pa_lower"]] },
    ],
    {
      conds: [
        {
          id: "pa_higher",
          text: "Ústřední orgán státní správy, jiný správní úřad s celostátní působností, ústředí / generální ředitelství správního úřadu s podřízenými územními součástmi, Kancelář prezidenta republiky, Senátu nebo Poslanecké sněmovny, ČNB, Policejní prezidium, krajské ředitelství PČR, celostátní útvar PČR se speciální činností, GIBS, součást HZS ČR (§ 5 písm. a)–c)), Kancelář veřejného ochránce práv, NKÚ, ÚZSVM, SÚRAO, Ústavní soud, zdravotní pojišťovna, kraj nebo hl. m. Praha",
        },
        { id: "pa_lower", text: "Správní úřad nebo jeho součást s krajskou, okresní nebo jinou územní působností, profesní komora (ne regionální struktura), vysoká škola, Akademie věd ČR, obec s rozšířenou působností nebo městská část Praha 1 až Praha 22" },
      ],
      nace: ["84"],
      esa: ["13"],
    },
  ),
  /* 2. Elektřina */
  s(
    "2.1",
    "Výroba elektřiny podle energetického zákona (kromě výroben z OZE do 1 MW)",
    "Držitel licence na výrobu elektřiny",
    [
      { regime: "higher", when: [["L"], ["mw100"]] },
      { regime: "lower", when: [["M"]] },
    ],
    { conds: [{ id: "mw100", text: "Provozuje výrobnu elektřiny s celkovým instalovaným elektrickým výkonem nejméně 100 MW" }], nace: ["35.11", "35.1"] },
  ),
  s("2.2", "Provoz přenosové soustavy elektřiny", "Držitel licence na přenos elektřiny", HIGHER, { nace: ["35.12"] }),
  s(
    "2.3",
    "Provoz distribuční soustavy elektřiny",
    "Držitel licence na distribuci elektřiny",
    [
      { regime: "higher", when: [["L"], ["rds90k"]] },
      { regime: "lower", when: [["M"]] },
    ],
    { conds: [{ id: "rds90k", text: "Provozovatel regionální distribuční soustavy, k níž je připojeno nejméně 90 000 odběrných míst zákazníků" }], nace: ["35.13"] },
  ),
  s("2.4", "Obchod s elektřinou", "Držitel licence na obchod s elektřinou", LM, { nace: ["35.14"] }),
  s("2.5", "Činnost nominovaného organizátora trhu s elektřinou", "Nominovaný organizátor trhu s elektřinou (nařízení (EU) 2019/943)", HIGHER),
  s("2.6", "Agregace elektřiny", "Agregátor podle energetického zákona", LM, { nace: ["35.14"] }),
  s("2.7", "Ukládání elektřiny", "Držitel licence na ukládání elektřiny", LM, { nace: ["35.1"] }),
  s("2.8", "Odezva strany poptávky", "Poskytovatel flexibility podle energetického zákona", LM),
  s("2.9", "Provoz veřejně přístupné dobíjecí stanice", "Provozovatel 50 a více veřejně přístupných dobíjecích stanic odpovědný za jejich správu a provoz", LM, { nace: ["35.14", "47.3"] }),
  s("2.10", "Činnost Elektroenergetického datového centra", "Držitel licence na činnost Elektroenergetického datového centra", HIGHER),
  /* 3. Ropa */
  s("3.1", "Těžba ropy", "Provozovatel zařízení na těžbu ropy", LM, { nace: ["06.1", "06"] }),
  s("3.2", "Zpracovávání ropy", "Provozovatel zařízení na zpracování ropy", LM, { nace: ["19.2", "19"] }),
  s("3.3", "Provoz skladovacího zařízení pro skladování ropy", "Provozovatel skladovacího zařízení pro skladování ropy", LM, { nace: ["52.1"] }),
  s("3.4", "Provoz ropovodu", "Provozovatel ropovodu podle zákona o nouzových zásobách ropy", LM, { nace: ["49.5"] }),
  s("3.5", "Provoz produktovodu", "Provozovatel produktovodu podle zákona o nouzových zásobách ropy", LM, { nace: ["49.5"] }),
  s("3.6", "Činnost ústředního správce zásob", "Ústřední správce zásob podle zákona o nouzových zásobách ropy", HIGHER),
  s(
    "3.7",
    "Provoz veřejně přístupné čerpací stanice motorového benzinu nebo nafty",
    "Provozovatel čerpací stanice pohonných hmot",
    [{ regime: "lower", when: [["fuel100"]] }],
    { conds: [{ id: "fuel100", text: "Provozuje alespoň 100 veřejně přístupných čerpacích stanic benzinu nebo nafty v ČR" }], nace: ["47.3"] },
  ),
  /* 4. Plyn */
  s("4.1", "Výroba zemního plynu", "Držitel licence na výrobu plynu", LM, { nace: ["06.2", "35.21"] }),
  s("4.2", "Provoz přepravní soustavy zemního plynu", "Držitel licence na přepravu plynu", HIGHER, { nace: ["49.5"] }),
  s(
    "4.3",
    "Provoz distribuční soustavy zemního plynu",
    "Držitel licence na distribuci plynu",
    [
      { regime: "higher", when: [["L"], ["gas1000"]] },
      { regime: "lower", when: [["M"]] },
    ],
    { conds: [{ id: "gas1000", text: "Provozovatel distribuční soustavy plynu s licencovanou přenosovou kapacitou nejméně 1 000 MW" }], nace: ["35.22"] },
  ),
  s("4.4", "Obchod se zemním plynem", "Držitel licence na obchod s plynem", LM, { nace: ["35.23"] }),
  s("4.5", "Uskladňování zemního plynu", "Držitel licence na uskladňování plynu", LM, { nace: ["52.1"] }),
  /* 5. Teplárenství */
  s(
    "5.1",
    "Výroba tepelné energie",
    "Držitel licence na výrobu tepelné energie",
    [
      { regime: "higher", when: [["L", "heatdist"], ["mw50heat"]] },
      { regime: "lower", when: [["M", "heatdist"]] },
    ],
    {
      conds: [
        { id: "heatdist", text: "Je současně držitelem licence na rozvod tepelné energie" },
        { id: "mw50heat", text: "Provozuje výrobnu tepelné energie s celkovým instalovaným tepelným výkonem nejméně 50 MW" },
      ],
      nace: ["35.3"],
    },
  ),
  s("5.2", "Provoz soustavy zásobování tepelnou energií", "Držitel licence na rozvod tepelné energie", LM, { nace: ["35.3"] }),
  /* 6. Vodík */
  s("6.1", "Výroba vodíku", "Držitel licence na výrobu plynu", LM, { nace: ["20.11"] }),
  s("6.2", "Skladování vodíku", "Držitel licence na uskladňování plynu", LM),
  s("6.3", "Přeprava vodíku", "Držitel licence na přepravu plynu", LM),
  /* 7. Výrobní průmysl */
  s("7.1", "Výroba počítačů, elektronických a optických přístrojů a zařízení (oddíl 26 CZ-NACE)", "Výrobce v oddílu 26 CZ-NACE", LM_LOWER, { nace: ["26"] }),
  s("7.2", "Výroba elektrických zařízení (oddíl 27 CZ-NACE)", "Výrobce v oddílu 27 CZ-NACE", LM_LOWER, { nace: ["27"] }),
  s("7.3", "Výroba strojů a zařízení j. n. (oddíl 28 CZ-NACE)", "Výrobce v oddílu 28 CZ-NACE", LM_LOWER, { nace: ["28"] }),
  s(
    "7.4",
    "Výroba motorových vozidel (kromě motocyklů), přívěsů a návěsů (oddíl 29 CZ-NACE)",
    "Výrobce v oddílu 29 CZ-NACE",
    [
      { regime: "higher", when: [["cars"]] },
      { regime: "lower", when: [["L"], ["M"]] },
    ],
    { conds: [{ id: "cars", text: "Sériově vyrábí osobní motorová vozidla" }], nace: ["29"] },
  ),
  s("7.5", "Výroba ostatních dopravních prostředků a zařízení (oddíl 30 CZ-NACE)", "Výrobce v oddílu 30 CZ-NACE", LM_LOWER, { nace: ["30"] }),
  /* 8. Potraviny */
  s("8.1", "Průmyslová výroba potravin", "Potravinářský podnik (nařízení (ES) č. 178/2002) s průmyslovou výrobou potravin", LM_LOWER, { nace: ["10", "11"] }),
  s("8.2", "Průmyslové zpracování potravin", "Potravinářský podnik s průmyslovým zpracováním potravin", LM_LOWER, { nace: ["10", "11"] }),
  s("8.3", "Velkoobchodní distribuce potravin", "Potravinářský podnik s velkoobchodní distribucí potravin", LM_LOWER, { nace: ["46.3"] }),
  /* 9. Chemie */
  s("9.1", "Výroba chemických látek podléhajících registraci (REACH)", "Výrobce chemické látky podléhající registraci", LM_LOWER, { nace: ["20"] }),
  s("9.2", "Uvádění chemických látek podléhajících registraci na trh", "Distributor chemické látky podléhající registraci", LM_LOWER, { nace: ["46.75", "46.7"] }),
  s("9.3", "Výroba předmětů podléhajících registraci nebo oznámení (REACH)", "Výrobce předmětů podléhajících registraci nebo oznámení", LM_LOWER, { nace: ["20", "22"] }),
  s(
    "9.4",
    "Užívání objektu za účelem umístění nebezpečné látky (prevence závažných havárií)",
    "Provozovatel objektu podle zákona o prevenci závažných havárií",
    [
      { regime: "higher", when: [["L", "groupB"], ["M", "groupB"]] },
      { regime: "lower", when: [["L", "groupA"], ["M", "groupA"]] },
    ],
    {
      conds: [
        { id: "groupB", text: "Objekt je zařazen do skupiny B" },
        { id: "groupA", text: "Objekt je zařazen do skupiny A" },
      ],
      nace: ["20", "19", "46.7"],
    },
  ),
  /* 10. Voda */
  s("10.1", "Provozování vodovodu sloužícího veřejné potřebě", "Provozovatel vodovodu podle zákona o vodovodech a kanalizacích", LM, { conds: [REV5], require: ["rev5"], nace: ["36"] }),
  s("10.2", "Provozování kanalizace sloužící veřejné potřebě", "Provozovatel kanalizace podle zákona o vodovodech a kanalizacích", LM, { conds: [REV5], require: ["rev5"], nace: ["37"] }),
  /* 11. Odpady */
  s("11.1", "Provoz zařízení určeného pro nakládání s odpady (kromě skladu vlastních odpadů)", "Provozovatel zařízení pro nakládání s odpady", LM_LOWER, { conds: [REV5], require: ["rev5"], nace: ["38"] }),
  s("11.2", "Obchodování s odpadem", "Obchodník s odpady", LM_LOWER, { conds: [REV5], require: ["rev5"], nace: ["46.77", "38"] }),
  s("11.3", "Zprostředkování nakládání s odpadem", "Zprostředkovatel nakládání s odpady", LM_LOWER, { conds: [REV5], require: ["rev5"], nace: ["38", "39"] }),
  s("11.4", "Přeprava odpadu", "Dopravce odpadu", LM_LOWER, { conds: [REV5], require: ["rev5"], nace: ["38.1", "49.4"] }),
  /* 12. Letecká doprava */
  s("12.1", "Provoz obchodní letecké dopravy", "Letecký dopravce podle zákona o civilním letectví", LM, { nace: ["51"] }),
  s("12.2", "Provoz mezinárodního letiště", "Provozovatel mezinárodního letiště s vyhrazeným bezpečnostním prostorem", LM, { nace: ["52.23"] }),
  s("12.3", "Provoz pomocných zařízení v rámci mezinárodního letiště", "Provozovatel pomocných zařízení na mezinárodním letišti s vyhrazeným bezpečnostním prostorem", LM, { nace: ["52.23"] }),
  s(
    "12.4",
    "Letové navigační služby",
    "Poskytovatel letových navigačních služeb",
    [{ regime: "higher", when: [["atc"], ["met"]] }],
    {
      conds: [
        { id: "atc", text: "Provozovatel služby řízení letového provozu v převážné části vzdušného prostoru ČR" },
        { id: "met", text: "Určený a osvědčený poskytovatel meteorologických služeb pro letectví v celé ČR" },
      ],
      nace: ["52.23"],
    },
  ),
  /* 13. Drážní doprava */
  s("13.1", "Provozování železniční dopravní cesty ve veřejném zájmu", "Provozovatel železniční dopravní cesty ve veřejném zájmu", HIGHER, { nace: ["52.21"] }),
  s("13.2", "Provoz celostátní dráhy", "Provozovatel celostátní dráhy", LM, { nace: ["52.21"] }),
  s("13.3", "Provoz regionální dráhy", "Provozovatel regionální dráhy", LM, { nace: ["52.21"] }),
  s("13.4", "Provoz veřejně přístupné vlečky", "Provozovatel veřejně přístupné vlečky", LM, { nace: ["52.21"] }),
  s("13.5", "Provoz drážní dopravy na celostátní dráze", "Provozovatel drážní dopravy na celostátní dráze", LM, { nace: ["49.1", "49.2"] }),
  s("13.6", "Provoz drážní dopravy na regionální dráze", "Provozovatel drážní dopravy na regionální dráze", LM, { nace: ["49.1", "49.2", "49.31"] }),
  s("13.7", "Provoz drážní dopravy na veřejně přístupné vlečce", "Provozovatel drážní dopravy na veřejně přístupné vlečce", LM, { nace: ["49.2"] }),
  s("13.8", "Provoz zařízení služeb", "Provozovatel zařízení služeb podle zákona o dráhách", LM, { nace: ["52.21"] }),
  /* 14. Námořní doprava */
  s("14.1", "Činnost námořní vodní dopravy", "Osoba vykonávající námořní vodní dopravu (nařízení (ES) č. 725/2004)", LM, { nace: ["50.1", "50.2"] }),
  s("14.2", "Provoz řídícího orgánu přístavu", "Řídící orgán přístavu (nařízení (EU) 2017/352)", LM, { nace: ["52.22"] }),
  s("14.3", "Provoz vodního díla nebo zařízení v mořském přístavu", "Osoba provozující vodní dílo nebo zařízení v rámci mořského přístavu", LM, { nace: ["52.22"] }),
  s("14.4", "Provoz služby lodní dopravě (VTS)", "Provozovatel služby lodní dopravě", LM, { nace: ["52.22"] }),
  /* 15. Silniční doprava */
  s("15.1", "Řízení provozu na pozemních komunikacích", "Osoba vykonávající správu pozemní komunikace", LM, { nace: ["52.21", "42.11"] }),
  s("15.2", "Provoz inteligentního dopravního systému", "Poskytovatel služby inteligentního dopravního systému", LM, { nace: ["52.21"] }),
  /* 16. Digitální infrastruktura */
  s(
    "16.1",
    "Poskytování veřejně dostupné služby elektronických komunikací",
    "Osoba poskytující veřejně dostupnou službu elektronických komunikací",
    [
      { regime: "higher", when: [["L"], ["M"], ["sim350k"], ["fixed100k"]] },
      { regime: "lower", when: [["S"], ["U"]] },
    ],
    {
      conds: [
        { id: "sim350k", text: "Nejméně 350 000 aktivních mobilních SIM karet v ČR" },
        { id: "fixed100k", text: "Nejméně 100 000 aktivních pevných internetových přípojek v ČR" },
      ],
      nace: ["61"],
    },
  ),
  s(
    "16.2",
    "Zajišťování veřejné komunikační sítě",
    "Osoba zajišťující veřejnou komunikační síť",
    [
      { regime: "higher", when: [["L"], ["M"], ["sim350k"], ["fixed100k"]] },
      { regime: "lower", when: [["S"], ["U"]] },
    ],
    {
      conds: [
        { id: "sim350k", text: "Nejméně 350 000 aktivních mobilních SIM karet v ČR" },
        { id: "fixed100k", text: "Nejméně 100 000 aktivních pevných internetových přípojek v ČR" },
      ],
      nace: ["61"],
    },
  ),
  s(
    "16.3",
    "Poskytování služby výměnného uzlu internetu (IXP)",
    "Poskytovatel služby výměnného uzlu internetu",
    [
      { regime: "higher", when: [["L"], ["ixp100"]] },
      { regime: "lower", when: [["M"]] },
    ],
    { conds: [{ id: "ixp100", text: "Umožňuje propojení nejméně 100 nezávislých sítí s datovým tokem alespoň 1 Tbps" }], nace: ["61", "63.1"] },
  ),
  s(
    "16.4",
    "Poskytování služby systému překladu doménových jmen (DNS), mimo DNS jako součást bodu 16.1",
    "Poskytovatel služeb DNS (ne jako součást služby elektronických komunikací)",
    [{ regime: "higher", when: [["dnsrec"], ["dnsauth"]] }],
    {
      conds: [
        { id: "dnsrec", text: "Aktivně poskytuje veřejně dostupný rekurzivní překlad doménových jmen koncovým uživatelům internetu" },
        { id: "dnsauth", text: "Poskytuje autoritativní překlad pro třetí strany pro více než 10 000 domén druhého řádu" },
      ],
      nace: ["63.1", "62"],
    },
  ),
  s(
    "16.5",
    "Poskytování služby registrace a správy doménových jmen",
    "Registrátor s přístupem k Centrálnímu registru doménových jmen",
    [{ regime: "lower", when: [["reg100k"]] }],
    { conds: [{ id: "reg100k", text: "Spravuje více než 100 000 doménových jmen druhého řádu v doméně .cz" }], nace: ["63.1"] },
  ),
  s("16.6", "Správa a provoz registru domény nejvyšší úrovně", "Osoba spravující a provozující registr TLD", HIGHER),
  s("16.7", "Správa a provoz domény gov.cz", "Osoba spravující a provozující doménu gov.cz", HIGHER),
  s(
    "16.8",
    "Poskytování služby cloud computingu",
    "Poskytovatel služby cloud computingu",
    [
      { regime: "higher", when: [["L"], ["statecloud"]] },
      { regime: "lower", when: [["M"]] },
    ],
    { conds: [{ id: "statecloud", text: "Poskytovatel státního cloud computingu podle zákona o informačních systémech veřejné správy" }], nace: ["63.1", "63.11", "62"] },
  ),
  s("16.9", "Poskytování služby datového centra (mimo službu podle bodu 16.8)", "Poskytovatel služby datového centra", LM, { nace: ["63.1", "63.11"] }),
  s("16.10", "Poskytování služby sítě pro doručování obsahu (CDN)", "Poskytovatel služby CDN", LM, { nace: ["63.1"] }),
  s("16.11", "Správa kvalifikovaného systému elektronické identifikace", "Kvalifikovaný správce systému elektronické identifikace", HIGHER),
  s(
    "16.12",
    "Poskytování služby vytvářející důvěru (eIDAS)",
    "Poskytovatel služby vytvářející důvěru",
    [
      { regime: "higher", when: [["qtsp"], ["L"]] },
      { regime: "lower", when: [["M"], ["S"], ["U"]] },
    ],
    { conds: [{ id: "qtsp", text: "Je kvalifikovaným poskytovatelem služby vytvářející důvěru" }], nace: ["63.1", "62"] },
  ),
  s("16.13", "Poskytování řízené služby (mimo řízenou bezpečnostní službu) zákazníkům, kteří nejsou spotřebiteli", "Poskytovatel řízené služby (MSP)", LM, { nace: ["62.03", "62", "63.1"] }),
  s("16.14", "Poskytování řízené bezpečnostní služby zákazníkům, kteří nejsou spotřebiteli", "Poskytovatel řízené bezpečnostní služby (MSSP)", LM, { nace: ["62", "80.2", "80"] }),
  s("16.15", "Poskytování služby on-line tržiště", "Poskytovatel on-line tržiště", LM_LOWER, { nace: ["47.91", "47.9", "63.12"] }),
  s("16.16", "Poskytování služby internetového vyhledávače", "Poskytovatel internetového vyhledávače", LM_LOWER, { nace: ["63.12", "63.9"] }),
  s("16.17", "Poskytování platformy sociální sítě", "Poskytovatel platformy sociální sítě", LM_LOWER, { nace: ["63.12", "63.9"] }),
  s("16.18", "Provozování Národního CERT", "Provozovatel Národního CERT", HIGHER),
  /* 17. Finanční trh */
  s("17.1", "Činnost úvěrové instituce", "Úvěrová instituce (nařízení (EU) č. 575/2013)", LM, { nace: ["64.19", "64.1"] }),
  s("17.2", "Provoz obchodního systému", "Provozovatel obchodního systému podle zákona o podnikání na kapitálovém trhu", LM, { nace: ["66.11"] }),
  s("17.3", "Činnost ústřední protistrany", "Ústřední protistrana (nařízení (EU) č. 648/2012)", LM, { nace: ["66.1"] }),
  s(
    "17.4",
    "Činnost platební instituce",
    "Platební instituce podle zákona o platebním styku",
    [{ regime: "higher", when: [["pay1t"]] }],
    { conds: [{ id: "pay1t", text: "Průměr ročních objemů provedených platebních transakcí za předchozí 3 účetní období přesahuje 1 000 000 000 000 Kč" }], nace: ["66.19", "64.99"] },
  ),
  s(
    "17.5",
    "Činnost instituce elektronických peněz",
    "Instituce elektronických peněz podle zákona o platebním styku",
    [{ regime: "higher", when: [["emoney"]] }],
    { conds: [{ id: "emoney", text: "Průměr ročních objemů vydaných elektronických peněz za předchozí 3 účetní období přesahuje 500 000 000 000 Kč" }], nace: ["64.99", "66.19"] },
  ),
  /* 18. Zdravotnictví */
  s(
    "18.1",
    "Poskytování zdravotní péče",
    "Poskytovatel zdravotních služeb poskytující zdravotní péči",
    [
      { regime: "higher", when: [["L"], ["oss"]] },
      { regime: "lower", when: [["M"]] },
    ],
    { conds: [{ id: "oss", text: "Organizační složka státu zřízená ústředním orgánem státní správy s oprávněním k poskytování zdravotních služeb" }], nace: ["86"] },
  ),
  s("18.2", "Poskytování zdravotnické záchranné služby", "Poskytovatel zdravotnické záchranné služby", HIGHER, { nace: ["86.9", "86"] }),
  s("18.3", "Činnost referenční laboratoře EU v síti pro oblast veřejného zdraví", "Referenční laboratoř EU zahrnutá do sítě referenčních laboratoří pro veřejné zdraví", LM, { nace: ["71.2", "86.9"] }),
  s("18.4", "Výzkum a vývoj humánních léčivých přípravků", "Zadavatel klinických hodnocení (nařízení (EU) č. 536/2014)", LM, { nace: ["72.1", "21"] }),
  s("18.5", "Výroba humánních léčivých přípravků", "Držitel povolení k výrobě léčivých přípravků", LM, { nace: ["21.2", "21"] }),
  s("18.6", "Výroba léčivých látek", "Výrobce léčivých látek", LM, { nace: ["21.1", "21"] }),
  s("18.7", "Výroba zdravotnických prostředků", "Výrobce zdravotnických prostředků (nařízení (EU) 2017/745)", LM_LOWER, { nace: ["32.5", "26.6"] }),
  s("18.8", "Výroba diagnostických zdravotnických prostředků in vitro", "Výrobce diagnostických zdravotnických prostředků in vitro (nařízení (EU) 2017/746)", LM_LOWER, { nace: ["32.5", "21"] }),
  s("18.9", "Výroba kriticky důležitých zdravotnických prostředků při mimořádné situaci", "Výrobce prostředků ze seznamu kriticky důležitých zdravotnických prostředků (nařízení (EU) 2022/123)", LM, { nace: ["32.5"] }),
  /* 19. Věda a výzkum */
  s(
    "19.1",
    "Výzkum a vývoj",
    "Veřejná výzkumná instituce, výzkumná organizace, vysoká škola nebo výzkumná instituce zaměřená na aplikovaný výzkum pro komerční účely",
    [
      { regime: "higher", when: [["sensitive"], ["critTech"]] },
      { regime: "lower", when: [["otherTech"], ["L", "commercial"], ["M", "commercial"]] },
    ],
    {
      conds: [
        { id: "sensitive", text: "V posledních 5 letech alespoň 2 roky prováděla citlivou výzkumnou činnost – aplikovaný výzkum vojenského materiálu" },
        { id: "critTech", text: "V posledních 5 letech alespoň 2 roky aplikovaný výzkum v oblasti pokročilých polovodičů, umělé inteligence, kvantových technologií nebo biotechnologií" },
        { id: "otherTech", text: "V posledních 5 letech alespoň 2 roky aplikovaný výzkum v oblasti pokročilé konektivity, navigace a digitálních technologií, pokročilého snímání, vesmírných technologií a pohonu, energetických technologií, robotiky a autonomních systémů nebo pokročilých materiálů, výrobních a recyklačních technologií" },
        { id: "commercial", text: "Výzkumná instituce, jejímž hlavním cílem je aplikovaný výzkum pro komerční účely (není vzdělávací institucí)" },
      ],
      nace: ["72", "85.4"],
    },
  ),
  /* 20. Pošta */
  s("20.1", "Poštovní služba", "Provozovatel poštovní služby", LM_LOWER, { nace: ["53.1"] }),
  s("20.2", "Kurýrní služba (dodávání balíků)", "Poskytovatel služby dodávání balíků (nařízení (EU) 2018/644)", LM_LOWER, { nace: ["53.2"] }),
  /* 21. Obranný průmysl */
  s("21.1", "Výroba vojenského materiálu", "Výrobce vojenského materiálu ze seznamu vojenského materiálu", LM, { nace: ["25.4", "30.4", "20.51"] }),
  s("21.2", "Obchod s vojenským materiálem", "Osoba s povolením k obchodu s vojenským materiálem", LM, { nace: ["46.69", "46.1"] }),
  /* 22. Vesmírný průmysl */
  s("22.1", "Zajištění podpory poskytování služeb využívajících kosmického prostoru (mimo službu podle bodu 16.2)", "Provozovatel pozemní infrastruktury pro podporu služeb využívajících kosmického prostoru", LM, { nace: ["61.3", "51.22"] }),
];

export const regulatedService = (code: string) => REGULATED_SERVICES.find((x) => x.code === code);

/* ---------- velikost podniku (doporučení 2003/361/ES) ---------- */

/** Kategorie počtu zaměstnanců RES (číselník ČSÚ 579) → rozsah. */
export const RES_EMPLOYEE_CLASSES: Record<string, { label: string; min: number; max: number | null }> = {
  "110": { label: "bez zaměstnanců", min: 0, max: 0 },
  "120": { label: "1–5", min: 1, max: 5 },
  "130": { label: "6–9", min: 6, max: 9 },
  "210": { label: "10–19", min: 10, max: 19 },
  "220": { label: "20–24", min: 20, max: 24 },
  "230": { label: "25–49", min: 25, max: 49 },
  "240": { label: "50–99", min: 50, max: 99 },
  "310": { label: "100–199", min: 100, max: 199 },
  "320": { label: "200–249", min: 200, max: 249 },
  "330": { label: "250–499", min: 250, max: 499 },
  "340": { label: "500–999", min: 500, max: 999 },
  "410": { label: "1 000–1 499", min: 1000, max: 1499 },
  "420": { label: "1 500–1 999", min: 1500, max: 1999 },
  "430": { label: "2 000–2 499", min: 2000, max: 2499 },
  "440": { label: "2 500–2 999", min: 2500, max: 2999 },
  "450": { label: "3 000–3 999", min: 3000, max: 3999 },
  "460": { label: "4 000–4 999", min: 4000, max: 4999 },
  "470": { label: "5 000–9 999", min: 5000, max: 9999 },
  "480": { label: "10 000 a více", min: 10000, max: null },
};

/** Velikost jen podle zaměstnanců (odhad z RES) – null, když kategorie zasahuje do dvou velikostí nebo není známá. */
export function sizeFromHeadcount(min: number, max: number | null): EnterpriseSize | null {
  const cat = (n: number): EnterpriseSize => (n < 10 ? "micro" : n < 50 ? "small" : n < 250 ? "medium" : "large");
  const a = cat(min);
  return max == null ? (a === "large" ? "large" : null) : a === cat(max) ? a : null;
}

/** Hranice v mil. EUR: obrat / bilanční suma. */
const LIMITS: { size: EnterpriseSize; staff: number; turnover: number; balance: number }[] = [
  { size: "micro", staff: 10, turnover: 2, balance: 2 },
  { size: "small", staff: 50, turnover: 10, balance: 10 },
  { size: "medium", staff: 250, turnover: 50, balance: 43 },
];

/**
 * Kategorie podniku (čl. 2 přílohy doporučení 2003/361/ES): počet zaměstnanců (RJP) je pod hranicí A ZÁROVEŇ obrat NEBO bilanční suma
 * nepřesahuje strop. Údaje za podnik včetně propojených a partnerských podniků (čl. 6). Částky v mil. EUR.
 */
export function enterpriseSize(staff: number, turnoverMEur: number | null, balanceMEur: number | null): EnterpriseSize {
  for (const l of LIMITS) {
    if (staff >= l.staff) continue;
    const fin = turnoverMEur == null && balanceMEur == null ? true : (turnoverMEur != null && turnoverMEur <= l.turnover) || (balanceMEur != null && balanceMEur <= l.balance);
    if (fin) return l.size;
  }
  return "large";
}

export const SIZE_LABELS: Record<EnterpriseSize, string> = { micro: "Mikropodnik", small: "Malý podnik", medium: "Střední podnik", large: "Velký podnik" };
const SIZE_ATOM: Record<EnterpriseSize, string> = { micro: "U", small: "S", medium: "M", large: "L" };

/* ---------- vyhodnocení ---------- */

export interface RsAnswer {
  code: string;
  /** Odpovědi na podmínky služby (id → splněno). */
  conds: Record<string, boolean>;
}
export interface RsServiceResult {
  code: string;
  regime: RegimeLevel | null;
  /** Proč (např. „velký podnik“, „chybí podmínka 5 % obratu“). */
  reason: string;
}
export interface RsResult {
  regime: RegimeLevel | "none";
  services: RsServiceResult[];
}

const atomText = (a: string, def: RegulatedServiceDef) =>
  a === "L" ? "velký podnik" : a === "M" ? "střední podnik" : a === "S" ? "malý podnik" : a === "U" ? "mikropodnik" : (def.conds?.find((c) => c.id === a)?.text ?? a);

export function evaluateService(def: RegulatedServiceDef, size: EnterpriseSize | null, conds: Record<string, boolean>): RsServiceResult {
  const missing = (def.require ?? []).filter((r) => !conds[r]);
  if (missing.length) return { code: def.code, regime: null, reason: `nesplněno: ${missing.map((m) => atomText(m, def)).join("; ")}` };
  const sizeAtom = size ? SIZE_ATOM[size] : null;
  const holds = (a: string) => (["L", "M", "S", "U"].includes(a) ? a === sizeAtom : !!conds[a]);
  for (const r of def.rules)
    for (const conj of r.when)
      if (conj.every(holds)) return { code: def.code, regime: r.regime, reason: conj.length ? conj.map((a) => atomText(a, def)).join(" + ") : "poskytovatel služby" };
  const needsSize = def.rules.some((r) => r.when.some((c) => c.some((a) => ["L", "M", "S", "U"].includes(a))));
  return { code: def.code, regime: null, reason: !size && needsSize ? "není určena velikost podniku" : "podmínky významnosti nejsou splněny" };
}

/** Celkový režim: vyšší povinnosti mají přednost (§ 3 vyhl. 408/2025, § 8 zákona). */
export function evaluateRegulation(size: EnterpriseSize | null, answers: RsAnswer[]): RsResult {
  const services = answers.map((a) => {
    const def = regulatedService(a.code);
    return def ? evaluateService(def, size, a.conds) : { code: a.code, regime: null, reason: "neznámá služba" };
  });
  const regime = services.some((x) => x.regime === "higher") ? "higher" : services.some((x) => x.regime === "lower") ? "lower" : "none";
  return { regime, services };
}

/** Kód odpovídá předponě CZ-NACE („62“ ~ „62“, „620“, „62.03“, „6203“). */
export function naceMatches(code: string, prefix: string): boolean {
  const c = code.replace(/\./g, "");
  const p = prefix.replace(/\./g, "");
  return c.startsWith(p);
}

/** Návrh služeb podle činností CZ-NACE a institucionálního sektoru z RES. */
export function suggestServices(nace: string[], esa: string | null, primaryNace: string | null): { code: string; via: string[]; primary: boolean }[] {
  const out: { code: string; via: string[]; primary: boolean }[] = [];
  for (const d of REGULATED_SERVICES) {
    const via = new Set<string>();
    let primary = false;
    for (const n of nace)
      for (const p of d.nace ?? [])
        if (naceMatches(n, p) && p.replace(/\./g, "").length >= 2) {
          via.add(`CZ-NACE ${n}`);
          if (primaryNace && naceMatches(primaryNace, p)) primary = true;
        }
    if (esa) for (const p of d.esa ?? []) if (esa.startsWith(p)) via.add(`sektor ESA ${esa}`);
    if (via.size) out.push({ code: d.code, via: [...via].slice(0, 4), primary });
  }
  return out.sort((a, b) => Number(b.primary) - Number(a.primary));
}

/* ---------- RES a uložené posouzení ---------- */

export interface ResSubject {
  ico: string;
  name: string;
  address: string | null;
  legalForm: string | null;
  foundedAt: string | null;
  /** Převažující činnost CZ-NACE (nejnovější klasifikace) a všechny činnosti. */
  primaryNace: string | null;
  nace: string[];
  /** Institucionální sektor ESA 2010 (např. 11003 = nefinanční podniky soukromé národní). */
  esaSector: string | null;
  employeeClass: string | null;
  employeeClassLabel: string | null;
  /** Odhad velikosti jen z počtu zaměstnanců (bez obratu a bilance, bez propojených podniků). */
  sizeEstimate: EnterpriseSize | null;
  updatedAt: string | null;
}
export interface ResLookupDto {
  subject: ResSubject;
  suggestions: { code: string; via: string[]; primary: boolean }[];
}

export const RS_SUBJECT_KINDS = ["company", "supplier"] as const;
export type RsSubjectKind = (typeof RS_SUBJECT_KINDS)[number];

export const RegulationAssessmentInput = z.object({
  subjectKind: z.enum(RS_SUBJECT_KINDS),
  subjectId: z.string().uuid(),
  ico: z.string().trim().regex(/^\d{8}$/).nullable().default(null),
  /** Počet zaměstnanců (RJP) včetně propojených a partnerských podniků. */
  staff: z.number().int().min(0).max(10_000_000).nullable().default(null),
  /** Roční obrat a bilanční suma v mil. Kč (přepočet kurzem ČNB k poslednímu dni před posuzovaným rokem, § 2 odst. 2). */
  turnoverMCzk: z.number().min(0).max(100_000_000).nullable().default(null),
  balanceMCzk: z.number().min(0).max(100_000_000).nullable().default(null),
  eurRate: z.number().min(1).max(100).nullable().default(null),
  /** Ruční velikost (přebije výpočet) – např. když jsou čísla za skupinu jinde. */
  sizeOverride: z.enum(["micro", "small", "medium", "large"]).nullable().default(null),
  /** Odhad velikosti z kategorie zaměstnanců RES – použije se, když nejsou vyplněné vlastní údaje. */
  resSize: z.enum(["micro", "small", "medium", "large"]).nullable().default(null),
  linkedNote: z.string().trim().max(2000).default(""),
  services: z
    .array(z.object({ code: z.string().max(10), conds: z.record(z.string().max(30), z.boolean()).default({}) }))
    .max(REGULATED_SERVICES.length)
    .default([]),
  note: z.string().trim().max(4000).default(""),
  /** Jen u vlastní společnosti: zapsat výsledný režim do regulatorního profilu. */
  apply: z.boolean().default(false),
  /** Snímek údajů z RES v okamžiku posouzení. */
  res: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type RegulationAssessmentInput = z.input<typeof RegulationAssessmentInput>;

/** Z čeho je velikost: ruční volba, zaměstnanci + finance, jen zaměstnanci, odhad z RES, neurčeno. */
export type SizeBasis = "override" | "full" | "staff" | "res" | "none";

/** Velikost z vyplněných údajů (null = nelze určit). */
export function sizeFromInput(i: { staff: number | null; turnoverMCzk: number | null; balanceMCzk: number | null; eurRate: number | null; sizeOverride: EnterpriseSize | null; resSize?: EnterpriseSize | null }): {
  size: EnterpriseSize | null;
  basis: SizeBasis;
} {
  if (i.sizeOverride) return { size: i.sizeOverride, basis: "override" };
  if (i.staff == null) return i.resSize ? { size: i.resSize, basis: "res" } : { size: null, basis: "none" };
  const hasFin = (i.turnoverMCzk != null || i.balanceMCzk != null) && !!i.eurRate;
  if (!hasFin) return { size: enterpriseSize(i.staff, null, null), basis: "staff" };
  const eur = (v: number | null) => (v == null ? null : v / i.eurRate!);
  return { size: enterpriseSize(i.staff, eur(i.turnoverMCzk), eur(i.balanceMCzk)), basis: "full" };
}

export interface RegulationAssessmentDto {
  id: string;
  companyId: string;
  subjectKind: RsSubjectKind;
  subjectId: string;
  ico: string | null;
  staff: number | null;
  turnoverMCzk: number | null;
  balanceMCzk: number | null;
  eurRate: number | null;
  sizeOverride: EnterpriseSize | null;
  size: EnterpriseSize | null;
  sizeBasis: SizeBasis;
  linkedNote: string;
  services: RsAnswer[];
  result: RsResult;
  note: string;
  res: Record<string, unknown> | null;
  applied: boolean;
  assessedByName: string | null;
  assessedAt: string;
}

/* ---------- ohlášení regulované služby NÚKIB (v1.63, ADR-157) ---------- */

/** Lhůta pro ohlášení od okamžiku, kdy se na subjekt zákon začne vztahovat (dny) a lhůta pro ohlášení změny údajů. */
export const NUKIB_NOTICE_DAYS = 60;
export const NUKIB_CHANGE_DAYS = 30;

export const RegistrationData = z.object({
  /** Statutární orgán (jména, funkce). */
  statutoryBody: z.string().trim().max(2000).default(""),
  dataBox: z.string().trim().max(20).default(""),
  contactEmail: z.string().trim().max(200).default(""),
  contactPhone: z.string().trim().max(50).default(""),
  /** Pověřená osoba pro kybernetickou bezpečnost (manažer KB), je-li určena. */
  kbName: z.string().trim().max(200).default(""),
  kbRole: z.string().trim().max(200).default(""),
  kbEmail: z.string().trim().max(200).default(""),
  kbPhone: z.string().trim().max(50).default(""),
  /** Veřejné rozsahy IP adres a doménová jména (u služeb digitální infrastruktury). */
  ipRanges: z.string().trim().max(4000).default(""),
  domains: z.string().trim().max(4000).default(""),
  /** Další členské státy EU, kde služby poskytuje. */
  memberStates: z.string().trim().max(1000).default(""),
  note: z.string().trim().max(4000).default(""),
  /** Funkční místo, které ohlášení a změny podává (povinnost v Moje práce). */
  responsiblePositionId: z.string().uuid().nullable().default(null),
});
export type RegistrationData = z.infer<typeof RegistrationData>;
export const RegistrationNotifiedInput = z.object({
  notifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notifiedRef: z.string().trim().max(200).default(""),
});

export interface RegistrationSnapshot {
  data: Omit<RegistrationData, "note" | "responsiblePositionId">;
  regime: RegimeLevel | "none";
  services: string[];
}

export const REGISTRATION_FIELD_LABELS: Record<keyof RegistrationSnapshot["data"] | "regime" | "services", string> = {
  statutoryBody: "Statutární orgán",
  dataBox: "Datová schránka",
  contactEmail: "Kontaktní e-mail",
  contactPhone: "Kontaktní telefon",
  kbName: "Pověřená osoba pro KB",
  kbRole: "Funkce pověřené osoby",
  kbEmail: "E-mail pověřené osoby",
  kbPhone: "Telefon pověřené osoby",
  ipRanges: "Rozsahy IP adres",
  domains: "Doménová jména",
  memberStates: "Další členské státy EU",
  regime: "Režim povinností",
  services: "Regulované služby",
};

/** Změny proti posledním ohlášeným údajům (pole, dříve, nyní). */
export function registrationChanges(cur: RegistrationSnapshot, prev: RegistrationSnapshot | null): { field: keyof typeof REGISTRATION_FIELD_LABELS; before: string; after: string }[] {
  if (!prev) return [];
  const out: { field: keyof typeof REGISTRATION_FIELD_LABELS; before: string; after: string }[] = [];
  for (const k of Object.keys(cur.data) as (keyof RegistrationSnapshot["data"])[]) {
    const a = (prev.data?.[k] ?? "").trim();
    const b = (cur.data[k] ?? "").trim();
    if (a !== b) out.push({ field: k, before: a, after: b });
  }
  if (prev.regime !== cur.regime) out.push({ field: "regime", before: prev.regime, after: cur.regime });
  const ps = [...(prev.services ?? [])].sort().join(", ");
  const cs = [...cur.services].sort().join(", ");
  if (ps !== cs) out.push({ field: "services", before: ps, after: cs });
  return out;
}

export type RegistrationStatus = "not_required" | "to_notify" | "notified" | "changes_pending";

export interface RegistrationDto {
  companyId: string;
  companyName: string;
  ico: string | null;
  address: string | null;
  data: RegistrationData;
  regime: RegimeLevel | "none";
  services: { code: string; name: string; regime: RegimeLevel }[];
  /** Posouzení, ze kterého pocházejí služby (poslední zapsané do profilu). Režim je vždy z regulatorního profilu společnosti (v1.65). */
  assessedAt: string | null;
  /** Režim podle posledního zapsaného posouzení (null = žádné). */
  assessmentRegime: RegimeLevel | "none" | null;
  /** Profil společnosti byl po posouzení ručně změněn – režim v profilu se liší od posouzení. */
  regimeMismatch: boolean;
  status: RegistrationStatus;
  notifiedAt: string | null;
  notifiedRef: string | null;
  changes: { field: string; label: string; before: string; after: string }[];
  /** Termín ohlášení (60 dní od posouzení) nebo ohlášení změny (30 dní od změny). */
  due: string | null;
  /** Chybějící povinné údaje pro ohlášení. */
  missing: string[];
}

/** Povinné údaje ohlášení (podle § 6 zákona – ověřte aktuální formulář na Portálu NÚKIB). */
export function registrationMissing(d: RegistrationData, ico: string | null): string[] {
  const m: string[] = [];
  if (!ico) m.push("IČO");
  if (!d.statutoryBody) m.push(REGISTRATION_FIELD_LABELS.statutoryBody);
  if (!d.contactEmail && !d.contactPhone) m.push("Kontaktní údaje");
  return m;
}
