# ADR-073: Cortex a MISP

- Stav: přijato (v0.78)

## Kontext
SOC v CONTIXu má vlastní alerty, případy, IOC, playbooky i zásahy (ADR-046 až 062). Napojení na TheHive by vytvořilo druhý zdroj pravdy pro případy, proto se nepřidává. Přínosem jsou dvě věci, které CONTIX nemá: **analyzátory Cortexu** (obohacení IOC) a **MISP** (komunitní sdílení indikátorů, v ČR rozšířené). Obě integrace ale mohou posílat data mimo organizaci, což je v rozporu s výchozí zásadou „nic neodesílat“.

## Rozhodnutí
- Nastavení globálně v `app_settings` (`soc.integrations`): interní domény, Cortex (adresa, API klíč šifrovaně, TLP/PAP, allow-list analyzátorů, seznam načtený testem), MISP (adresa, klíč šifrovaně, stahování, vyhledávání, sdílení). Klíče nikdy do odpovědí, chyb ani auditu.
- **Ochrana interních údajů** `enrichGuard` (`shared/socEnrich.ts`): soukromé IP, jednoslovná jména, interní přípony (.local, .lan, .internal, .corp, .test, .home.arpa…) a domény z nastavení se neodešlou – při analýze ani sdílení.
- **Cortex**: analyzátor spouští jen analytik (soc:write), jen z allow-listu a jen s podporovaným datovým typem (`cortexDataType`). Ven jde jen hodnota, typ, TLP, PAP a neutrální popis. Odhad dosahu `cortexReach` (lokální / odesílá třetí straně / neověřeno) podle katalogu Cortex-Analyzers pomáhá správci při povolování. Výsledek se čeká až 40 s, jinak dokončí plánovač (`pollEnrichments`, po 24 h chyba). Uloží se taxonomie, verdikt `verdictOf` a zkrácená plná zpráva do `soc_enrichments` (vazba na alert / IOC).
- **MISP – stahování**: `mispPullRecords` (`/attributes/restSearch`, období, to_ids, publikované, štítky, warninglisty) → `parseMispAttributes` → `storeFeed(…, "misp")`; běží v `refreshThreatIntel` se stejným porovnáním a hledáním ve Wazuhu jako abuse.ch.
- **MISP – vyhledání hodnoty**: na pokyn analytika, výsledek `mispLookupTaxonomies` (to_ids = škodlivé) s odkazy na události.
- **MISP – sdílení**: nové oprávnění `soc:share` (CISO, manažer KB); jen platné IOC, bez poznámek, nová událost s distribucí / TLP / úrovní hrozby z nastavení, publikace volitelná; `soc_iocs.misp_event_id`.
- Každé spuštění, dotaz a sdílení → audit.

## Důsledky
- Responders Cortexu se nepoužívají – zásahy řeší modul reakcí se schválením (ADR-055).
- Analyzátory, které CONTIX nezná, jsou „neověřené“ – správce musí posoudit sám.
