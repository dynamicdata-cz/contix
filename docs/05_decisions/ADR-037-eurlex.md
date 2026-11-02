# ADR-037: Předpisy EU z EUR-Lex (CELLAR) v modulu Legislativa

**Stav:** přijato (v0.39.0)

## Kontext
Kromě českých předpisů (e-Sbírka, ADR-035) potřebují povinné osoby sledovat přímo použitelná nařízení a směrnice EU
(NIS2 a prováděcí nařízení 2024/2690, DORA, GDPR, AI Act, CRA, eIDAS, CER). EUR-Lex nemá jednoduché REST API; „My RSS“
vyžaduje účet EU Login. Úřad pro publikace EU ale zpřístupňuje celé úložiště **CELLAR** veřejně a bez registrace.

## Rozhodnutí
- Nový zdroj předpisu `eurlex` (`legal_source`), identifikace `/eu/<jazyk>/<CELEX>` (např. `/eu/cs/32022L2555`).
  Každý jazyk znění (cs, en) je samostatný předpis – texty v různých jazycích se mezi sebou neporovnávají.
- **Metadata**: SPARQL `https://publications.europa.eu/webapi/rdf/sparql` (ontologie CDM). Jedním dotazem se načte základní akt
  (`resource_legal_id_celex`, platnost `resource_legal_in-force`, `resource_legal_date_end-of-validity`) a všechna
  konsolidovaná znění (`act_consolidated_based_on_resource_legal`) s XHTML položkou ve zvoleném jazyce.
- **Výběr znění**: nejnovější konsolidované znění dostupné v jazyce (datum z CELEX `0…-RRRRMMDD`, i budoucí), jinak původní akt.
  Novější znění bez překladu se poznamená v `meta.newerUntranslated`.
- **Text**: XHTML položka (`…/resource/cellar/<id>/DOC_n`). Parser (`eurlexParse.ts`) využívá identifikátory ELI
  (`art_N`, `anx_X`); článek → fragment `cl_N`, odstavce („1.“, „1a.“) → `cl_N-odst_M`, příloha → `priloha_X`,
  přílohy číslované po bodech „1.1.1.“ (2024/2690) → `priloha_X-bod_1.1.1`. Body odůvodnění, poznámky pod čarou,
  značky změn (▼M2) a výhrady se vynechávají (konsolidace odůvodnění nemá – rozdíl by byl falešný).
  Starší XHTML bez ELI se dělí podle nadpisů „Článek N“ / „PŘÍLOHA“.
- **Kontrola** jednou denně plánovačem (CELLAR nemá kanál změn pro jednotlivý akt); šetrně – sekvenčně, prodleva 500 ms,
  opakování při 429/5xx.
- **Mapování na rámce**: DORA (`32022R2554`) → rámec `dora` (článek → `dora:N`); NIS2 (`32022L2555`) a prováděcí nařízení
  (`32024R2690`) → rámec `nis2` (v0.40): odstavec směrnice → písmena `nis2:21/2/a…`, bod přílohy → `nis2:P1.1.1`
  (oddíl `1.1` → jeho body). Ostatní předpisy EU zatím rámec nemají – sledování, rozdíly a posouzení fungují, dotčené požadavky se nedohledají.
- **Rámec NIS2** (v0.40, `frameworks/data/nis2.ts`): úřední české znění čl. 20, 21 (odst. 1–4) a 23 (odst. 1–4) směrnice
  a celé přílohy 2024/2690 (161 bodů, písmena jako body požadavku), převzaté z CELLAR (opakované použití dle rozhodnutí 2011/833/EU).
  ID jsou stabilní (`nis2:<čl>/<odst>/<písm>`, `nis2:P<bod>`); mapování z vyhlášky 409 `CROSSWALK_409_NIS2` je orientační.
- Konfigurace: `EURLEX_SOURCE` (on | off, výchozí on), `EURLEX_SPARQL_URL`. Server potřebuje odchozí HTTPS na `publications.europa.eu`.

## ENISA
ENISA vydává doporučení a metodiky (ne právní předpisy) a nenabízí API ani RSS. Zatím se vedou jako ručně vedený předpis;
případná evidence „metodik“ s vazbou na požadavky je samostatný krok.

## Důsledky
- Změna struktury XHTML v CELLAR se projeví jen v parseru; ochrana proti zápisu nesmyslů zůstává ze `syncAct`
  (prázdný text nebo převaha neurčených klíčů → chyba, znění se neuloží).
- Limity endpointu (60 s na dotaz, max. 5 spojení z IP) – dotazy jsou cílené na jeden CELEX, běží sekvenčně.
