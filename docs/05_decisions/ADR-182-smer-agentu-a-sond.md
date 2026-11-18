# ADR-182: Směr agentů, sond a koncentrátoru – důkazy pro shodu, ne detekce

Stav: **přijato** – fáze A zavedena ve verzi 1.87.0, fáze B–D a povinnosti výrobce zůstávají plánem – navazuje na [ADR-096](ADR-096-continuous-control-monitoring.md),
[ADR-177](ADR-177-agenti-a-koncentratory.md), [ADR-180](ADR-180-hardening-a-kontejnery-z-agenta.md) a [ADR-127](ADR-127-cra-manufacturer-documents.md).

## Kontext

Agent 0.3 posílá inventář, kontejnery a fakta pro hardening, CONTIX je vyhodnocuje (ADR-180). Nabízí se další sondy
(Windows, síťové prvky, certifikáty, zálohy) a rozšiřování koncentrátoru. Hrozí dvě chyby:

1. **Konkurovat SIEM / EDR** (Wazuh) – detekce v reálném čase, sběr logů, reakce. To Wazuh umí lépe a zákazník ho
   často má; druhý agent se stejnou rolí jen přidá zátěž a odpor správců.
2. **Rozšiřovat plochu, kterou nejde udržet** – každý systém, verze a typ zařízení znamená testy, opravy
   a od CRA i povinnosti výrobce (agent a koncentrátor jsou placené komponenty – produkt s digitálními prvky).

Hodnota CONTIXu je v propojení s řízením bezpečnosti: opatření, SoA, rizika, audit. Data ze serverů dnes končí
v inventáři a nálezech, ale nepromítají se do míry zavedení opatření.

## Rozhodnutí (zásady)

1. **Sondy dodávají důkazy pro shodu a rizika.** Každý nový sběr musí mít odpověď na otázku „ke kterému opatření nebo
   riziku je to důkaz“. Co nemá vazbu na opatření (výkon, logy, telemetrie procesů), nesbíráme.
2. **Jen čtení, nic nepřijímají.** Agent ani sonda nespouští příkazy z CONTIXu ani koncentrátoru, nemá naslouchající
   port (agent) a nemění konfiguraci. Přihlašovací údaje pro bezagentní sondy (síťové prvky) zůstávají v zóně –
   na koncentrátoru, nikdy v CONTIXu.
3. **Agent posílá fakta, CONTIX vyhodnocuje** (jako ADR-180). Prahy, texty a mapování na opatření se mění vydáním
   CONTIXu, ne agenta.
4. **Minimum dat**: hodnoty nastavení, práva, jména – ne obsah souborů, hesla, proměnné prostředí, provoz.
5. **Méně sond do hloubky.** Nová platforma nebo typ zařízení až po splnění povinností výrobce (bod 9) pro stávající.

## Plán (fáze podle přínosu)

### A. Hardening jako důkaz k opatřením (jen CONTIX, bez nového agenta)

- Katalog `HARDENING_CHECKS` dostane mapování na požadavky rámců (`HARDENING_REQS`, ID požadavků CONTIXu, např. `cz409:22/6`, `iso27001:A.8.9`, `cis8:4.1`). Opatření se na kontroly napojí přes své požadavky – mapování na konkrétní opatření zákazníka se neudržuje.
- Nové druhy monitorů (ADR-096): `host_hardening` (skóre serverů v rozsahu ≥ X %, rozsah podle štítků / kritičnosti /
  útvaru) a `hardening_check` (vybraná kontrola splněna na N % serverů). Běh = neměnný záznam = vzorek pro SOC 2 Type II.
- Výsledek monitoru se projeví u opatření (návrh míry zavedení, důkaz v SoA, nález při nesplnění) – rozhodnutí
  o míře zavedení dál dělá člověk.
- Přehled „hardening podle opatření“: které servery brání splnění opatření.

### B. Agent pro Windows (Windows Server 2016+, Windows 10/11)

Stejný program a protokol, moduly jen ke čtení přes API systému (bez PowerShellu a externích nástrojů):
místní správci a účty, služby, naslouchající porty, nainstalovaný software, aktualizace (Windows Update Agent),
Defender (stav, signatury, výjimky – jen počet), BitLocker, profily firewallu, auditní politika, SMBv1, LSA ochrana,
RDP s NLA, politika hesel a uzamčení účtů, plánované úlohy (jen program). Kontroly hardeningu podle CIS Windows Server
L1 v katalogu CONTIXu. Služba pod virtuálním účtem s právy jen ke čtení tam, kde to jde; podepsaný MSI.

### C. Bezagentní sondy na koncentrátoru

Koncentrátor zóny (je uvnitř sítě) jednou denně čte cíle ze seznamu povolených adres:

- **Síťové prvky a firewally** (SSH / REST API, účet jen pro čtení): otisk běžící a uložené konfigurace, změny,
  vybraná nastavení (správa jen šifrovaně, SNMPv3, NTP, syslog, AAA, verze firmwaru) → důkaz pro bezpečnost sítě
  a řízení změn. Celá konfigurace se do CONTIXu neposílá (obsahuje tajemství), jen otisk a vybrané hodnoty.
- **Certifikáty a TLS** služeb v zóně (platnost, protokoly, šifry) – doplní dnešní kontrolu TLS (ADR-096 `tls_expiry`).
- **Zálohy**: stav posledních úloh z API zálohovacího systému (začít jedním – Veeam nebo Proxmox Backup Server) →
  důkaz pro kontinuitu (BIA, RTO / RPO).

Kontrola M365 / Entra ID zůstává v konektorech CONTIXu (API), ne v agentovi.

### D. Koncentrátor – jen přenos a zóna

Dokončit **vložený koncentrátor** (pro malé zákazníky bez samostatného serveru) a **řetězení zón** (OT → DMZ →
CONTIX). Žádné další funkce – koncentrátor stojí na hranici sítí a každá funkce navíc zvětšuje plochu útoku.

### Zavedení fáze A (1.87.0)

- `HARDENING_REQS` v `shared/hardening.ts` (každá kontrola ≥ 1 požadavek; test ověřuje, že ID existují v katalogu rámců),
  `hardeningChecksForRequirements(ids)`.
- Monitory `host_hardening` (metrika skóre, `minScore`, `staleDays`, `productionOnly`) a `hardening_check` (metrika %,
  `minPct`, `checkIds` – prázdné = podle požadavků opatření). Data jen z aktuálních hlášení (`hardeningHosts`, výchozí 7 dní).
- `GET /api/monitors/control-hardening/:controlId` (controls:read, jména serverů jen s assets:read) a karta v detailu opatření.
- Rozsah podle štítků / kritičnosti / útvaru zatím není (jen produkční servery) – doplní se podle zpětné vazby.
- Návrh míry zavedení opatření z výsledku monitoru zatím není automatický; o míře zavedení rozhoduje člověk.

### Fáze B v mezidobí

Windows servery pokrývá Wazuh SCA (monitor `sca_score`). Katalog a monitory jsou obecné – kontroly pro Windows se
po fázi B přidají do `HARDENING_CHECKS` se stejným mapováním a monitory je převezmou bez změny. Do té doby agent
nevydává sestavení pro Windows (vypadá jako hotová podpora, ale nic nesbírá).

## Co dělat nebudeme

Detekce v reálném čase, sběr a korelace logů, reakce na incidenty (izolace, ukončení procesu), skenování
zranitelností na serveru (to dělá Wazuh / skener – CONTIX výsledky importuje), vzdálené spouštění příkazů, správa
konfigurace (zápis). Na tyto potřeby CONTIX odkazuje na Wazuh a další nástroje a jejich výsledky využívá.

## Povinnosti výrobce (CRA) – podmínka dalšího rozšiřování

Agent a koncentrátor jsou produkt s digitálními prvky, DynamicData je výrobce. Před fází B:

1. **Podepsaná vydání** (Ed25519 / minisign nebo cosign, veřejný klíč v README a v CONTIXu; instalační skripty
   podpis ověřují) a **SBOM** (CycloneDX) u každého vydání.
2. **Zvládání zranitelností**: SECURITY.md s kontaktem a lhůtami, evidence v samotném CONTIXu (modul CRA – agent jako
   vlastní produkt, VEX), hlášení aktivně zneužívaných zranitelností (od 11. 9. 2026).
3. **Doba podpory** a politika aktualizací (zastaralou verzi CONTIX ukazuje na mapě propojení – ADR-181).
4. Reprodukovatelné sestavení zůstává (už je).

## Důsledky

- Největší přínos (fáze A) nevyžaduje nového agenta – data už jsou. Doporučené pořadí: CRA body 1–2 → A → B → C → D.
- Hranice placených komponent: agent / koncentrátor / sondy placené, vyhodnocení a mapování na opatření součást CONTIXu
  (CONTIX funguje i bez agenta – ruční evidence, Wazuh, sběrač).
- Otevřené otázky: certifikát pro podpis kódu Windows (EV, cena), uložení přihlašovacích údajů sond na koncentrátoru
  (šifrování klíčem koncentrátoru), výběr prvního zálohovacího systému a síťových výrobců podle zákazníků.
