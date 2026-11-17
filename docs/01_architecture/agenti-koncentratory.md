# Agenti a koncentrátory CONTIX – architektura

Stav: **návrh k odsouhlasení** (ADR-177). Navazuje na sběrač ze serverů (ADR-148, ADR-151), který zůstává
podporovaný jako jednodušší varianta.

## 1. Cíle a hranice

### Co agenti přinášejí (a Wazuh ne)

| Oblast | Výstup v CONTIXu |
|---|---|
| **Služby a jejich změny** – naslouchající porty, procesy, balíčky, systemd / Windows služby, plánované úlohy, verze | Model služby na aktivu, časová osa změn |
| **Odchylka od schváleného stavu** – porty, účty, SSH klíče, lokální administrátoři, firewall, služby podle role serveru | Nález „odchylka od základního stavu“ garantovi |
| **Neschválená změna** – změna bez schválené změny (ISMS → Změny) na aktivu v jejím okně | Nález + podnět k přehodnocení rizika |
| **Důkazy k opatřením** – záloha proběhla a je čerstvá, platnost TLS certifikátů, běžící EDR / antivir, stav záplat, šifrování disku, NTP | Výsledek automatického testu opatření (`control_automations`) |
| **Toky mezi službami** – souhrn spojení (kdo s kým, port, počet) bez obsahu | Mapa služeb, vazby aktiv, podklad pro BIA a segmentaci |

### Co agenti nedělají (záměrně)

- **Nesbírají logy ani obsah souborů**: to je role SIEM (Wazuh). Agent nenahrazuje EDR ani SIEM.
- **Nepřijímají žádné příkazy.** Agent jen čte; ze serveru přijímá pouze podepsanou konfiguraci (co sbírat a jak často).
  Neumí spustit příkaz, stáhnout skript ani otevřít shell. To je hlavní bezpečnostní rozdíl oproti nástrojům RMM.
- **Neposílají tajemství.** Z klíčů jen otisky, z konfigurací jen vybraná nastavení nebo hashe, z procesů bez argumentů
  příkazové řádky (lze povolit filtrem).

### Úrovně sběru – CONTIX funguje i bez agentů

Agenti jsou **volitelný modul** (`agents` v `MODULES`). Jádro CONTIXu na jejich datech nezávisí: každá funkce,
která data agentů využívá (služby, změny, důkazy, toky), má výchozí stav „bez dat“ a ruční alternativu.

| Úroveň | Pro koho | Zdroj dat o serverech | Co je potřeba nainstalovat |
|---|---|---|---|
| **0 – bez sběru** | Mikro a malé organizace, Cloud Start | Ruční evidence, import (`IMPORT_FIELDS`), Discovery konektory (AD, Wazuh, NetBox) | Nic |
| **1 – sběrač** | Malé organizace s pár linuxovými servery | `contix-collect.py` (ADR-148, ADR-151) | Skript na serveru |
| **2 – agenti, vestavěný koncentrátor** | Malé a střední organizace s jednou zónou | Agenti → koncentrátor uvnitř CONTIXu | Agent na serveru |
| **3 – agenti a koncentrátory v zónách** | Střední a velké, DMZ / OT / izolované sítě | Agenti → koncentrátor zóny → CONTIX | Agent + koncentrátor na zónu |

- Úroveň se volí za společnost a lze ji kdykoli zvýšit; data nižší úrovně zůstávají (aktivum z importu se spáruje s agentem).
- Moduly bez dat agentů nic nehlásí jako chybu: chybějící důkaz = „bez automatického důkazu“, ne „nesplněno“.

### Vestavěný koncentrátor (úroveň 2)

Pro malé organizace s jednou zónou nemusí běžet samostatný koncentrátor. CONTIX nabídne **vestavěný koncentrátor**:
stejný protokol, stejná registrace a podpisy, jen naslouchá přímo na serveru CONTIXu (port 8443 přes reverzní proxy).

- Agent v tomto režimu komunikuje se serverem CONTIXu, ale stále přes rozhraní koncentrátoru (`/v1/batch`), ne přes API CONTIXu.
  Přechod na samostatný koncentrátor = změna adresy v konfiguraci agenta, bez přeinstalace.
- Vestavěný koncentrátor nemá frontu na disku ani filtry zóny (data jdou rovnou do příjmu); limity na agenta platí.
- Podpisy zpráv agenta se ověřují stejně jako u samostatného koncentrátoru.

## 2. Komponenty

```
 Zóna OT                 Zóna DMZ                 Kancelářská síť
 ┌──────────┐            ┌──────────┐             ┌──────────┐
 │ agent(y) │            │ agent(y) │             │ agent(y) │
 │ senzor*  │            └────┬─────┘             └────┬─────┘
 └────┬─────┘                 │ mTLS                   │ mTLS
      │ mTLS             ┌────▼───────┐           ┌────▼───────┐
 ┌────▼───────┐          │koncentrátor│           │koncentrátor│
 │koncentrátor│          │   DMZ      │           │  kancelář  │
 │   OT       │─────────►│(kaskáda)   │           └────┬───────┘
 └────────────┘ odchozí  └────┬───────┘                │ odchozí HTTPS (mTLS)
   (nebo export             │ odchozí HTTPS (mTLS)    │
    do souboru)            ┌▼────────────────────────▼┐
                           │          CONTIX           │
                           │  příjem /api/agent/…      │
                           └───────────────────────────┘
 * senzor = pasivní sledování provozu koncentrátorem (OT, kde agent nejde nainstalovat)
```

| Komponenta | Technologie | Kde běží | Role |
|---|---|---|---|
| **Agent** | Go, jeden statický program (Linux amd64/arm64, Windows) | Server / stanice | Čte stav, počítá změny, podepisuje zprávy |
| **Koncentrátor** | Go (stejný kód, jiná role), kontejner nebo malý virtuál | Jeden na zónu | Registrace agentů, mTLS, fronta, filtr, předání do CONTIXu, export do souboru |
| **Senzor** (volitelný) | Modul koncentrátoru | Zóna OT | Pasivní zjištění zařízení a toků ze zrcadleného portu (SPAN) |
| **CONTIX** | Stávající API | Server CONTIXu | Ověření podpisů, uložení, vyhodnocení, zobrazení |

Repozitáře: `contix-agent` (agent + koncentrátor, Go) a v CONTIXu příjem dat. **Protokol** (schémata zpráv)
je verzovaný a jeho referenční popis (JSON Schema) je v obou repozitářích stejný; testy v CONTIXu ověřují
vzorové zprávy vygenerované agentem.

## 3. Zóny a tok dat

- Data tečou **jen směrem nahoru**: agent → koncentrátor → (koncentrátor vyšší zóny) → CONTIX.
- Agent zná jen adresu svého koncentrátoru a nikdy nevolá API CONTIXu (u úrovně 2 je koncentrátor vestavěný v serveru CONTIXu, rozhraní je stejné). Mezi zónami stačí jedno odchozí
  pravidlo firewallu (koncentrátor → CONTIX nebo koncentrátor → nadřazený koncentrátor, TCP 443).
- **Kaskáda**: koncentrátor může předávat nadřazenému koncentrátoru (např. OT → DMZ → CONTIX). Zprávy se nepřebalují,
  podpisy agentů zůstávají.
- **Bez spojení (izolovaná síť)**: koncentrátor uloží dávky do podepsaného souboru `.ctxb`, který se přenese
  a nahraje v CONTIXu (Administrace → Konektory). Opačným směrem stejným způsobem putuje konfigurace.
- **Datová dioda**: protokol nepotřebuje odpověď, protože potvrzení jsou volitelná. Bez nich koncentrátor posílá
  dávky opakovaně a CONTIX odstraní duplicity podle `(agent, seq)`. Jednou denně jde úplný snímek, který srovná
  případné ztráty.
- Koncentrátor patří **společnosti** (nebo skupině s mapováním na společnosti jako u Wazuhu). Zóna je jeho vlastnost
  a zobrazuje se u aktiv.

## 4. Identita a důvěra

### Kořen důvěry

- Instalace CONTIXu má **podpisový klíč instalace** (Ed25519). Podepisuje konfiguraci pro koncentrátory a agenty
  a certifikáty koncentrátorů. Soukromý klíč je v DB šifrovaný `APP_SECRET` (stejně jako ostatní tajemství), veřejný
  klíč se při registraci přenese do koncentrátoru a agentů (pinning).
- Vydání programů podepisuje **klíč vydavatele** (DynamicData, mimo zákaznické instalace). Agent i koncentrátor
  ověřují aktualizace jen proti němu.

### Registrace koncentrátoru

1. Správce v CONTIXu založí koncentrátor (název, společnost, zóna) a dostane **jednorázový registrační kód**
   (platnost 24 h, v DB jen otisk).
2. Koncentrátor si vygeneruje dvojici klíčů a pošle žádost o certifikát s kódem.
3. CONTIX vydá **klientský certifikát koncentrátoru** (mTLS do CONTIXu) a certifikát **podřízené CA zóny**
   s omezením na agenty této zóny. Vrátí podepsanou výchozí konfiguraci a veřejný klíč instalace.

### Registrace agenta

1. Instalátor dostane adresu koncentrátoru, otisk jeho CA a **registrační token zóny**. Token má omezený počet
   použití a platnost a lze ho kdykoli zneplatnit.
2. Agent vygeneruje **dva klíče**: TLS klíč (mTLS ke koncentrátoru) a **podpisový klíč zpráv** (Ed25519).
3. Koncentrátor vydá TLS certifikát ze své CA zóny a předá do CONTIXu **veřejný podpisový klíč agenta** spolu
   s identitou hostitele (machine-id / SMBIOS UUID, hostname).
4. V CONTIXu je agent ve stavu **„čeká na schválení“**. U zóny lze nastavit automatické schválení. Neschválený agent
  posílá data, ale ta se jen ukládají do karantény, nezpracovávají se.

### Proč dva klíče

mTLS chrání spojení agent ↔ koncentrátor. Podpis zpráv chrání **původ dat až do CONTIXu**, takže napadený koncentrátor
nemůže data agenta podvrhnout ani pozměnit, jen je zahodit. CONTIX ověřuje podpis proti klíči schválenému
při registraci.

### Odvolání

Zablokování agenta nebo koncentrátoru v CONTIXu se promítne do podepsané konfigurace (seznam odvolaných).
Koncentrátor pak agenta odmítne a CONTIX jeho zprávy zahazuje i při přenosu souborem.

## 5. Protokol

- **Transport**: HTTPS (TLS 1.3, mTLS) agent → koncentrátor `POST /v1/batch`; koncentrátor → CONTIX
  `POST /api/public/agent/v1/batches` (podepsaný požadavek, kap. 12). Komprese gzip. Agent nemá žádný naslouchající port.
- **Obálka zprávy**:

```jsonc
{
  "v": 1,
  "agent": "a8f3…",          // id agenta přidělené při registraci
  "seq": 18234,              // rostoucí pořadí – odhalí mezery a opakování
  "ts": "2026-11-17T08:12:44Z",
  "kind": "change",          // hello | snapshot | change | evidence | flows
  "payload": { … },
  "sig": "base64(Ed25519(kanonický JSON bez sig))"
}
```

- **Druhy zpráv**:

| `kind` | Kdy | Obsah |
|---|---|---|
| `hello` | Start, každých 15 min | Verze, OS, uptime, stav modulů, posun hodin |
| `snapshot` | Denně (náhodná minuta) a po startu | Úplný stav: služby, porty, balíčky, účty, klíče, firewall, plánované úlohy |
| `change` | Při změně (kontrola každých 5 min) | Rozdíl proti poslednímu stavu: co, z čeho na co, kdy zjištěno |
| `evidence` | Podle konfigurace (typicky denně) | Výsledky kontrol: záloha, certifikáty, EDR, záplaty, šifrování disku, NTP |
| `flows` | Každou hodinu | Souhrn spojení: proces/služba → cíl (IP, port, protokol), počet, první a poslední výskyt |

- **Potvrzení**: CONTIX vrací pro každého agenta nejvyšší souvislé zpracované `seq`. Koncentrátor podle toho
  maže frontu. Mezera v `seq` se zobrazí jako „chybějící data“.
- **Konfigurace**: koncentrátor si každých 5 minut stáhne z CONTIXu **podepsaný balíček konfigurace** (moduly,
  intervaly, filtry, základní stavy rolí, odvolané identity) a agenti si ho stahují od koncentrátoru. Agent použije
  jen konfiguraci s platným podpisem instalace a vyšší verzí, než má.
- **Kompatibilita**: koncentrátor přijímá i stávající `contix-collect.py` (inventář). Obalí ho a podepíše vlastním
  klíčem. V CONTIXu je takový zdroj označen nižší úrovní důvěry („ověřeno koncentrátorem“).

## 6. Koncentrátor

- **Fronta na disku** (append-only soubory po dávkách): limit velikosti (výchozí 2 GB) a doba uchování (7 dní).
  Při zaplnění zahazuje nejdřív `flows`, nikdy `change`.
- **Filtry a minimalizace**: odstranění argumentů procesů, maskování vybraných polí, povolené moduly podle zóny.
  Pravidla jsou součástí podepsané konfigurace, aby šla auditovat.
- **Limity**: počet zpráv a velikost dávky na agenta (ochrana proti zahlcení).
- **Vlastní stav** (verze, fronta, počet agentů, chyby, platnost certifikátů) posílá jako `hello` koncentrátoru.
- **Nasazení**: kontejner (docker compose) nebo připravený obraz virtuálu. Naslouchá jen na 8443 do zóny, odchozí
  jen do CONTIXu. Klíče v souboru s právy 0600, volitelně v TPM.
- **Senzor (OT)**: pasivně ze SPAN zjišťuje zařízení (MAC, IP, výrobce podle OUI, protokoly Modbus / S7 / DNP3 /
  BACnet podle portů) a toky. Do sítě nic neposílá.

## 7. Agent

- **Jen čte.** Linux: běží jako root kvůli `authorized_keys` a pravidlům firewallu (nebo s omezenými capabilities,
  pokud moduly dovolí). Windows: služba pod účtem LocalSystem s omezeným tokenem, čtení přes WMI, registr a API.
- **Moduly** zapínané konfigurací: `services`, `ports`, `packages`, `accounts`, `ssh_keys`, `firewall`,
  `scheduled`, `containers`, `evidence.backup`, `evidence.certs`, `evidence.edr`, `evidence.patches`,
  `evidence.disk_encryption`, `evidence.time`, `flows`.
- **Výpočet změn lokálně**: agent drží poslední odeslaný stav (šifrovaně na disku) a posílá jen rozdíly. Úplný
  snímek jednou denně slouží ke kontrole konzistence.
- **Tok spojení**: Linux přes `/proc/net` a conntrack / eBPF (pokud je k dispozici), Windows přes
  `GetExtendedTcpTable` a ETW. Vzorkuje se a agreguje, nezachytává obsah.
- **Nároky**: cíl < 30 MB RAM, < 1 % CPU v průměru, < 5 MB/den dat na běžný server.
- **Aktualizace**: podepsané balíčky distribuuje koncentrátor. Automatická aktualizace je volitelná podle zóny.
  Agent ověří podpis vydavatele, starší verzi nepřijme a ponechá si jednu verzi pro návrat.

## 8. Zpracování v CONTIXu

### Data

| Tabulka | Obsah |
|---|---|
| `concentrators` | Společnost, zóna, nadřazený koncentrátor, certifikát (otisk), stav, verze, poslední spojení |
| `agents` | Koncentrátor, aktivum, identita hostitele, veřejný podpisový klíč, stav (čeká / schválen / blokován), verze, poslední `seq`, poslední spojení |
| `agent_events` | Přijaté zprávy (append-only, dělené po měsících, doba uchování podle nastavení – výchozí 13 měsíců) |
| `host_inventories` (rozšíření) | Aktuální stav hostitele ze snímku agenta – stávající tabulka sběrače (kap. 12) |
| `services` | Model služby: aktivum, název, port(y), proces, balíček a verze, správce; první a poslední výskyt |
| `service_flows` | Agregované toky služba → cíl za den |
| `baselines` | Schválený stav podle role serveru (povolené porty, služby, účty, administrátoři) |
| `host_inventory_changes` (rozšíření) | Změny s klasifikací a vazbou na schválenou změnu (kap. 12) |

### Vyhodnocení změn

Každá změna dostane klasifikaci:

1. **Očekávaná**: odpovídá základnímu stavu role (např. aktualizace balíčku v okně záplat).
2. **Schválená**: na aktivum existuje schválená změna (ISMS → Změny) a změna spadá do jejího časového okna.
3. **Neschválená**: ostatní. Vznikne nález pro technického garanta se lhůtou podle závažnosti a podnět
   k přehodnocení rizik aktiva. Garant ji může dodatečně spárovat se změnou nebo potvrdit jako očekávanou
   (s doplněním základního stavu).

### Důkazy k opatřením

Výsledky `evidence` se mapují na automatické testy opatření (`control_automations`). Opatření „Zálohování“ tak má
denní důkaz z každého serveru: poslední úspěšná záloha, stáří a velikost. Do zprávy pro audit jde souhrn a výjimky.

### Vazby a aktiva

- Agent se páruje s aktivem podle identity hostitele (stejně jako sběrač). Nové hostitele navrhne jako aktiva
  v Discovery.
- Ze `service_flows` vzniknou **navržené vazby** podpůrných aktiv (aplikace → databáze, server → úložiště). Správce
  je potvrdí a pak slouží pro dědění CIA, BIA a útočné cesty.

## 9. Zobrazení

1. **Mapa služeb**: služby a toky mezi nimi, seskupené podle zón. Barvy podle kritičnosti aktiva a stavu
   (neschválená změna, odchylka, chybějící data). Filtr podle zóny, útvaru a procesu. Navazuje na graf vazeb aktiv.
2. **Časová osa změn**: na aktivu, v zóně i v celé organizaci. Klasifikace změn, vazba na schválené změny,
   souvislost s incidenty a alerty SOC.
3. **Zóny a flotila**: koncentrátory a agenti, verze, poslední spojení, fronty, mezery v datech, certifikáty
   před vypršením.
4. **Služba na aktivu**: karta služeb s verzemi, porty, odchylkami a historií.

## 10. Bezpečnost a CRA

- Agent i koncentrátor jsou **produkty s digitálními prvky** (CRA). DynamicData jako výrobce zajistí podepsaná vydání,
  SBOM (CycloneDX) u každého vydání, zveřejněný postup hlášení zranitelností, bezpečnostní aktualizace po dobu podpory
  a hlášení aktivně zneužívaných zranitelností.
- Sestavení reprodukovatelné, závislosti minimální (standardní knihovna Go a ověřené moduly), podpis vydání
  klíčem vydavatele (offline / HSM).
- Model hrozeb: napadený agent (vidí jen svůj hostitel, nemůže psát jinam), napadený koncentrátor (nepodvrhne data
  agentů, nemá oprávnění v CONTIXu kromě příjmu dat své zóny), ukradený registrační token (omezený počet a platnost,
  schvalování agentů), odposlech (TLS 1.3), opakování zpráv (`seq` a čas).
- Penetrační test agenta a koncentrátoru před prvním nasazením u zákazníka.

## 11. Fáze

| Fáze | Obsah | Výsledek |
|---|---|---|
| **1** | Protokol v1 (podpis, JCS), koncentrátor (Go) samostatný i vestavěný v CONTIXu, registrace a mTLS, podpisy, fronta, předávání; v CONTIXu typ připojení *koncentrátor*, příjem, schvalování agentů; stávající sběrač přes koncentrátor | Bezpečný sběr ze zón se stávajícími daty |
| **2** | Agent v Go pro Linux a Windows: `snapshot`, `change`, moduly služeb, portů, balíčků, účtů, klíčů, firewallu, plánovaných úloh | Služby a časová osa změn |
| **3** | Základní stavy rolí, klasifikace změn, vazba na ISMS → Změny, nálezy pro garanty; `evidence` a automatické testy opatření | Neschválené změny, důkazy k opatřením |
| **4** | `flows`, navržené vazby, mapa služeb, zóny a flotila | Grafika |
| **5** | Senzor OT, kaskáda koncentrátorů, export do souboru a dioda, automatické aktualizace | Izolované a OT zóny |

Fáze 1 a 2 lze pilotovat na dvou zónách (kancelář, DMZ) a desítce serverů.

## 12. Upřesnění vůči pravidlům CONTIXu (2026-11-17)

1. **Změny hostitele** navazují na `normalizeInventory` / `diffHostInventory` / `host_inventory_changes` (ADR-152) – tabulky
   se rozšíří o zdroj a klasifikaci, žádná paralelní `host_changes` ani `host_state`.
2. **Důkazy `evidence`** = nové druhy průběžného monitorování (`CONTROL_MONITOR_KINDS` + `MONITOR_SPEC` + `collectMonitor`,
   zápis `recordRun`, ADR-096 / ADR-109), ne samostatné `control_automations`.
3. **Neschválená změna** = nový zdroj v `FINDING_SOURCES` (větev v `loadUnified`, úkoly jako `host_finding`).
4. **Podnět k přehodnocení rizika** jen nový druh v `riskTriggers` (při čtení, nepersistuje se).
5. **`agent_events`**: retence mazáním po dávkách (plánovač s `acquireLease`); dělení po měsících jen pokud to vynutí objem
   (vyžadovalo by výjimku z pravidla „migrace ručně neupravuj“).
6. **Schéma protokolu**: zdrojem pravdy jsou Zod schémata v `packages/shared`, JSON Schema pro `contix-agent` se z nich generuje.
7. **Příjem** `POST /api/public/agent/v1/batches` (registrace `/register`, agenti `/agents`) je mimo přihlášení i CSRF,
   v `INLINE_GUARDED` s kontrolou v handleru. **Koncentrátor → CONTIX se neověřuje klientským certifikátem**, ale podpisem
   každého požadavku klíčem Ed25519 koncentrátoru (hlavičky `x-contix-concentrator`, `x-contix-date`, `x-contix-signature`
   nad `concentratorSigningString`: prefix, metoda, cesta, čas, SHA-256 těla; čas ±5 min). Důvod: TLS končí na reverzní
   proxy (Caddy), takže mTLS by vyžadovalo předávání certifikátu v hlavičce; podpis je nezávislý na proxy. mTLS zůstává
   mezi agentem a koncentrátorem (CA zóny v koncentrátoru). Koncentrátor = připojení `connections.kind = concentrator`,
   registrační kód jen jako SHA-256, jednorázový, 24 h.
8. **SBOM agenta** z Go modulů (CycloneDX) v CI repozitáře `contix-agent`; vydání podle ADR-178.
9. **Kanonický JSON** pro podpis = RFC 8785 (JCS); stejná implementace v Go (agent) a TS (CONTIX), ověřená společnými vzorovými zprávami.

## 13. Otevřené otázky

1. **Licence a distribuce** agenta a koncentrátoru: AGPL jako CONTIX, nebo samostatná licence?
2. **Windows od začátku** (fáze 2), nebo nejdřív jen Linux?
3. **Umístění koncentrátoru**: kontejner na existujícím serveru zóny, nebo vlastní malý virtuál (doporučeno pro DMZ a OT)?
4. **Doba uchování** událostí (výchozí 13 měsíců – roční audit + rezerva)?
5. **eBPF pro toky** (přesnější, vyžaduje novější jádro), nebo jen `/proc/net` vzorkování?
