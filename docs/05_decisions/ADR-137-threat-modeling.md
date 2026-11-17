# ADR-137: Modelování hrozeb podle reality prostředí (v1.40)

## Kontext

Rizikové scénáře z dat (ADR-114) hodnotily primární aktivum se signály jeho okolí, ale neukazovaly, **jak** se útočník
k aktivu dostane, hodnocení existujících rizik se s daty (BIA, incidenty, účinnost opatření) nesrovnávalo
a katalog hrozeb nebral ohled na odvětví. Threat modeling aplikací a projektů se dělal mimo CONTIX.

## Rozhodnutí

1. **Útočné cesty** (`attackPaths`, `shared/threatModeling.ts`): deterministický graf pohybů útočníka z evidence –
   vstupy (aktiva z internetu podle KEV / kritické / MFA, phishing na nejslabší koncové stanice), závislosti
   (`runs_on`, `uses`, `network`, `backup`, vazby podpůrné → primární), laterální pohyb v segmentu (`segmentOf`
   podle CIDR `net_segments`; bez doložené segmentace = plochá síť) a identita (uzel `IDENTITY_NODE`: krádež
   údajů → doménový účet → servery, snadnost podle privilegovaných účtů bez MFA a slabin Kerberos). Snadnost kroku
   jen z doložených slabin, cesta = Dijkstra nad −ln snadnosti, alternativní cesta jiným vstupem, úroveň `pathLevel`,
   úzká hrdla s doporučením. Vstupy jen `attackPathsFor` (`risks/modeling.ts`, z `measureCompany` /
   `capabilityDtos`, jen čtení). Rozhodnutí `attack_path_decisions` (klíč vstup>cíl): riziko jen na pokyn přes
   `POST /api/risks` (dispatch, cesta se přepočítá na serveru), nebo akceptace se zdůvodněním.
2. **Kalibrace** (`calibrateRisk`): dopad = max z MTPD (`mtpdLevel4`, jinak `suggestMtpd`), dopadů BIA, osobních
   údajů (zvláštní kategorie = nejvyšší) a významných incidentů; bez dat CIA / kritičnost. Hrozba = střed + incidenty
   12 měsíců + alerty 90 dní + expozice + aktéři. Zranitelnost = střed ± doložená účinnost opatření
   (`evidencedEffectiveness`) + KEV / kritické zranitelnosti. Podklady dávkově `calibrationInputs`; použití jen na
   pokyn přes `PATCH /api/risks/:id` se `reviewNote` (historie přehodnocení, ADR-058).
3. **Aktéři pro odvětví**: orientační katalog `THREAT_ACTORS` (veřejné zprávy, techniky ATT&CK), relevance
   `actorRelevance` (odvětví / oportunistický +3, zmínky informačního servisu +1 až 3, MISP +2, techniky v SOC +1,
   ruční rozhodnutí se zdůvodněním má přednost), profil `threat_profiles`. Posun šablon `sectorDelta` jen se zadaným odvětvím
   (+1 vysoce relevantní aktér, −1 odvětví zadáno a technika nikoho relevantního) – v `evaluateScenario(… sector)`
   a v kalibraci; nepersistuje se, počítá `threatLandscape` (`risks/landscape.ts`).
4. **Threat model STRIDE** (`threat_models`): prvky `TmElement` (externí entita, proces, úložiště, tok; zóna důvěry,
   data, ověření, šifrování, logování), hrozby jen `strideThreats` (STRIDE-per-element, závažnost z citlivosti dat,
   hranice důvěry a vlastností; rozhodnutí u stávajících klíčů zůstávají), předvyplnění z grafu `seedElements`.
   Riziko z hrozby jen `POST …/threats/risk` (kódy katalogu `STRIDE_CATALOG`), `riskId` nastavuje jen server.
   Zpráva `threatModelHtml` (tisk / Word).

## Důsledky

- Kvalita cest a kalibrace roste s evidencí vazeb aktiv, segmentů, BIA a testů opatření – UI upozorní na nízkou jistotu.
- Katalog aktérů je data – aktualizace = úprava `THREAT_ACTORS` (bez migrace); nic se neodesílá ven.
