# ADR-035: Legislativa – sledování předpisů z e-Sbírky, posouzení změn a AI skóre dokumentace

**Stav:** přijato (v0.34.0)

## Kontext
Organizace musí sledovat změny předpisů (ZKB 264/2025, vyhlášky 408–410/2025 Sb. a další) a doložit, kdo změnu posoudil,
co znamená pro požadavky, opatření a vnitřní dokumenty a jaké úkoly z ní vznikly. e-Sbírka poskytuje REST API (OpenAPI 3.0,
jen čtení, přístupový klíč z registrace u MV ČR) se stálými URL a ELI. Katalog otevřených dat upozorňuje na možné změny
identifikátorů fragmentů a struktury dat se spuštěním e-Legislativy (leden 2027). Normy ISO jsou chráněny autorským právem.

## Rozhodnutí
- Modul `legislation`, oprávnění `legislation:read` / `legislation:write` (ciso, security_manager zápis; auditor čtení).
- Konektor `modules/legislation/esbirka.ts`: hlavička `esel-api-access-key`, sekvenčně (~4 dotazy/s), opakování při 429/5xx,
  cesty na jednom místě (`PATHS`), pole odpovědí se čtou tolerantně; surová metadata a `schemaVersion` se ukládají ke znění.
- **Identita fragmentu = klíč odvozený z citace** (`fragmentKey`: `par_6-odst_1-pism_a`, `cl_5`, `k_5.2`), ID fragmentů zdroje jen
  informativně (`sourceId`). Rozdíl (`diffFragments`) ignoruje fragmenty, které změnily jen klíč a text zůstal (přečíslování / změna struktury).
  Pokud by po změně schématu nebylo možné citace rozpoznat (>50 % generických klíčů), znění se neuloží a předpis se označí chybou.
- Předpisy ze Sbírky jsou společné (`legal_acts.company_id = null`), sledování (`legal_watch`), posouzení (`legal_reviews`) a úkoly
  (`legal_tasks`) jsou per společnost. Ručně vedené předpisy a normy (licencovaný text ISO) jsou soukromé pro společnost.
- Plánovač jednou denně (`processLegislationSync`, jen sledované předpisy, jen s klíčem a zapnutým modulem); stejné znění se
  jednou týdně stáhne znovu a porovná podle hashe obsahu. Nové znění → `legal_changes` + posouzení pro každou sledující společnost
  s termínem 14 dní a odpovědným funkčním místem; povinnost v `collectObligations`.
- Dotčené požadavky: `ACT_FRAMEWORK` / `frameworkId` + `requirementsForFragment`; z nich opatření (`control_requirements`) a dokumenty
  (`policy_requirements`, oddíly vyhlášky dle režimu společnosti).
- Posouzení potvrzuje odpovědná osoba (držitel funkčního místa nebo `legislation:write`): stav „posouzeno“ vyžaduje míru dopadu
  a zdůvodnění, uzavření vyžaduje vyřízené úkoly; ukládá se kdo a kdy.
- AI (lokální model): `legal_change` – shrnutí změny a návrh úkolů (ID dokumentů / požadavků ověřena), aplikace jen po `decide`.
  `policy_review` rozšířeno na skóre pokrytí požadavků (`gapScore`) s náměty ke zlepšení; přijaté náměty = připomínky k dokumentu.

## Doplněk v0.35: otevřená data bez registrace
- Zdroj `ESBIRKA_SOURCE` (`auto` | `api` | `opendata` | `off`, výchozí auto = API s klíčem, jinak otevřená data), výběr `createLegalSource` (`source.ts`).
- Otevřená data (`opendata.ts`): veřejný SPARQL endpoint `opendata.eselpoint.gov.cz/sparql` nad slovníkem `slovník.gov.cz/datový/sbírka/pojem/`
  (akt → `má-znění` → `má-fragment-znění` → `obsahuje-fragment` / `text-fragmentu`). Klíč fragmentu z `url-fragmentu-znění` (stejná kotva jako REST API),
  bez kotvy z cesty IRI označení bez čísel `frag_*`. Stránkování keyset podle `pořadí-fragmentu` (Virtuoso nedovolí řazení s OFFSET > 10 000).
  Vstupy do dotazu jen validované stálé URL; dotazy POST.
- Sleduje se **nejnovější vyhlášené znění** (i s budoucí účinností) – posouzení vznikne hned po zveřejnění novely.
- RSS `e-sbirka.gov.cz/rss/zmeny` (okno ~50 položek): nové znění sledovaného předpisu → okamžitá kontrola; zrušení → `meta.rss.repeal` (zobrazeno u předpisu).

## Důsledky
- Cesty API e-Sbírky je nutné ověřit proti OpenAPI specifikaci po registraci klienta; server potřebuje odchozí HTTPS na `api.e-sbirka.gov.cz`.
- Při změně schématu (e-Legislativa) se upraví jen konektor (`PATHS`, čtení polí) a zvýší `ESBIRKA_SCHEMA_VERSION`; historie znění zůstává porovnatelná díky klíčům z citací.
