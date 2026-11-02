# ADR-052: Zdroje alertů SOC – webhook s tokenem a hlášení phishingu

**Stav:** přijato (v0.57.0)

## Kontext
Fronta SOC dosud přijímala alerty jen z Wazuhu a ručně. Organizace mají další detekce (IDS Suricata, Microsoft Defender)
a zaměstnanci hlásí podezřelé e-maily ad hoc (přeposláním, telefonem). Syslog už umí Wazuh, není důvod ho duplikovat.

## Rozhodnutí
- **Zdroj** (`soc_sources`): název, společnost, šablona (`generic` | `suricata` | `defender`), výchozí závažnost,
  zapnuto. Token `cxs_…` se zobrazí jen při založení / obnově, ukládá se SHA-256 a prvních 12 znaků k rozpoznání.
  Správa `admin:settings`, výpis `soc:read`.
- **Příjem** `POST /api/public/soc/ingest`, `Authorization: Bearer cxs_…` (nebo `X-Contix-Token`). Bez session a cookies,
  proto vyjmuto z kontroly CSRF (jinak by `curl -d` s formulářovým typem neprošel). Tělo: objekt, pole,
  `{events|value|alerts:[…]}` nebo NDJSON; nejvýše 1 MB a 500 událostí. Odpověď 202 se souhrnem.
- **Normalizace** (`soc/ingest.ts`): název, popis, úroveň 0–15, hostitel, cílová a zdrojová IP, uživatel, techniky
  ATT&CK, čas. Suricata jen `event_type: alert` (severity 1/2/3 → vysoká/střední/nízká), Defender MDE i Graph
  alerts_v2 (evidence zařízení / IP / uživatele). Pravidlo `šablona:id` (bez ID otisk názvu).
- **Seskupení** `src:<zdroj>:<pravidlo>:<hostitel bez domény | cílová IP>` – otevřený alert se jen navýší. Potlačení
  (`suppressGroup`) platí i pro napojené nástroje; aktivum podle hostname / FQDN / názvu / IP v rámci společnosti zdroje.
  Pak expozice a korelace jako u Wazuhu; AI triáž provede plánovač.
- **Phishing** `POST /api/soc/phishing` (`incidents:report`, multipart): .eml do 2 MB nebo odesílatel / předmět.
  Z .eml se ukládají jen hlavičky, SPF / DKIM / DMARC, počet Received a IP prvního serveru (jako `srcip`), odkazy
  (max 50), domény a názvy příloh – **ne text ani obsah příloh**. Poznámka zaměstnance jde do poznámek alertu
  (do AI se nepošle). Kampaň = stejný odesílatel + předmět bez RE/FW → jeden alert s počtem hlášení. T1566
  (+ T1204 s přílohou), playbook Phishing, závažnost vysoká při selhání ověření nebo s přílohou, jinak střední.
  Odkazy se v UI zobrazují neaktivní (`hxxp`).

## Důsledky
- Veřejný endpoint je chráněn jen tokenem – token má práva zakládat alerty jedné společnosti, nic víc.
- Syslog, CEF a další formáty dál přes Wazuh (dekodéry, pravidla); nové šablony lze přidat normalizátorem.
