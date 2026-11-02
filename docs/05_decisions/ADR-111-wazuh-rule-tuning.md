# ADR-111: Ladění pravidel Wazuh – návrhy, simulace, schválení (fáze 1 bez zápisu do Wazuhu)

**Stav:** přijato (v1.14)

## Kontext

Záložka Ladění pravidel (ADR-047) ukazovala hlučná pravidla a podíl falešných poplachů, ale úpravu musel analytik
vymyslet a napsat ručně. Uživatel chce „agenta“, který pravidla hlídá a optimalizuje. Špatně upravené pravidlo
ale potichu oslepí detekci, proto se postupuje po fázích: (1) návrhy a ověření bez zápisu, (2) nasazení přes Wazuh API
se schválením a možností vrácení – až po ověření fáze 1 v provozu.

## Rozhodnutí

- **Návrh = strukturovaná data** (`soc_rule_tunings`): druh `exclude` (child pravidlo `level="0"`) nebo `level`,
  podmínky jen z výčtu (`srcip`, `dstip`, `user`, `program_name`, `hostname`, `location`, `field` = pole `data.*`),
  porovnání rovnost (pcre2 ukotvený literál) nebo regulární výraz. XML generuje jen `tuningRuleXml` (escapování),
  nikdy se nepřebírá text od uživatele ani modelu. Číslo pravidla `109000 + pořadí` (rozsah lokálních pravidel).
- **Návrh z dat** (`POST /soc/tuning/suggest`, deterministický, bez LLM): pravidlo s ≥ 3 uzavřenými alerty a ≥ 50 %
  falešných poplachů; kandidátní pole ze vzorku událostí v indexeru, agregace hodnot, kandidát s podílem ≥ 40 %
  a bez zásahu do chráněných alertů. Zdůvodnění s čísly se vytvoří automaticky.
- **Simulace** (`POST /soc/tuning/:id/simulate`): počty událostí pravidla a událostí odpovídajících podmínkám ve Wazuh
  Indexeru; **chráněné alerty** (verdikt skutečný útok nebo eskalace) – události stejného agenta v jejich časovém okně.
  Bez indexeru jen nad vzorky alertů CONTIXu s upozorněním.
- **Schválení** `soc:respond`, čtyři oči (nastavení reakcí SOC), simulace nejvýše 7 dní stará; zásah do chráněných
  alertů jen s odůvodněním. Rozhodnutý návrh je neměnný.
- **Nasazení zatím ručně**: `GET /soc/tuning/rules.xml` (schválené návrhy jako `<group name="contix_tuning,">`).
- **Agenti**: čtecí nástroj `soc_rule_noise` (AI dotazy i MCP) – hlučná pravidla a stav návrhů.

## Důsledky

Migrace 0087. Fáze 2 (zápis přes Wazuh API `PUT /rules/files`, restart manageru, verze souboru, vrácení, měření
po 7 dnech) vyžaduje samostatný účet Wazuh API s právem jen na pravidla a samostatné ADR.
