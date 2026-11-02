# Nasazení verzí 0.49–0.55 – kontrolní seznam

Verze 0.49–0.55 přinášejí 6 nových migrací (0041–0046) a nové plánované úlohy. Postup počítá s instalací
z GitLabu (`/opt/contix`, `update.sh`). Celý postup trvá zhruba 15–30 minut.

| Verze | Co přináší | Migrace |
|---|---|---|
| 0.49 | Vektory záznamů (rizika, zranitelnosti, incidenty, výjimky), podobné záznamy | 0041 |
| 0.50 | Jednotný AI vstup na Přehledu | 0042 |
| 0.51 | Modul SOC (fronta alertů, ATT&CK, playbooky, AI poradci) | 0043 |
| 0.52 | SOC: případy, lhůty, potlačení, ladění pravidel | 0044 |
| 0.53 | SOC × zranitelnosti a rizika, kapitola SOC ve zprávě | 0045 |
| 0.53.1 | Riziko z tisíců zranitelností aktiva | – |
| 0.54 | Prioritizace zranitelností (CISA KEV, EPSS), plán oprav | 0046 |
| 0.55 | Lhůty oprav, semafor P1, povinnosti | – |
| 0.55.1 | Kontrola po nasazení `verify.sh`, nové kontroly v Provozu | – |

## 1. Před aktualizací

1. Na Macu odeslat změny: `cd ~/MojeProjekty/contix && git push gitlab main`.
2. Na serveru ověřit volné místo (záloha + nové obrazy, aspoň 5 GB): `df -h /opt/contix`.
3. **Přístup na internet pro zdroje hrozeb** (v0.54): server stahuje veřejné soubory z `www.cisa.gov`
   a `epss.cyentia.com` (HTTPS, jen stahování, nic se neodesílá).
   - Přímý přístup: povolit na firewallu odchozí HTTPS na tyto dvě adresy.
   - Přes proxy: doplnit do `/opt/contix/.env` `HTTPS_PROXY` a **`NO_PROXY` s interními službami**
     (vzor v `infra/server.env.example`) – jinak se API nepřipojí k databázi, Open WebUI ani Wazuhu.
   - Bez internetu: nic nenastavovat, soubory se budou nahrávat ručně (krok 3.2).

## 2. Aktualizace

```bash
cd /opt/contix && sudo ./infra/scripts/update.sh
```

Skript udělá zálohu databáze, stáhne změny, sestaví obrazy, spustí migrace a na konci
**`verify.sh --no-ai`** (kontejnery, místo na disku, verze, migrace 47/47, pgvector, Provoz, Wazuh,
dostupnost KEV a EPSS). Výsledek „0 chyb“ = v pořádku; upozornění projděte podle bodu 3.

## 3. Po aktualizaci (v aplikaci)

1. **Administrace → AI asistent**: *Test spojení*; zapnout **Vektory záznamů** (v0.49) – první indexace běží
   na pozadí (u tisíců záznamů desítky minut, stav tamtéž).
2. **Zranitelnosti → Zdroje hrozeb → Stáhnout nyní** (v0.54). Bez internetu: na jiném počítači stáhnout
   `known_exploited_vulnerabilities.json` (cisa.gov) a `epss_scores-current.csv.gz` (epss.cyentia.com)
   a nahrát je tlačítkem *Nahrát soubor*; opakovat aspoň jednou týdně.
3. Zkontrolovat **lhůty oprav** (výchozí P1 7, P2 30, P3 90 dní) tamtéž. Po prvním stažení KEV / EPSS
   zčervenají aktiva se zranitelností P1 – to je záměr (vypnutí: Nastavení → semafor).
4. **Aktiva**: u důležitých serverů vyplnit **garanta (vlastníka)** – jen pak dostane povinnost
   „Oprava zranitelností“.
5. **SOC** (v0.51+): role CISO a Manažer KB dostaly `soc:read` / `soc:write` automaticky, architekt a auditor čtení.
   Zkontrolovat *Lhůty a korelace*, že je v *Incidenty → návrhy z Wazuhu* zapnuté načítání alertů,
   a projít první případy a *Ladění pravidel*.
6. Spustit úplnou kontrolu včetně testovacího dotazu na AI:
   `sudo ./infra/scripts/verify.sh`

## 4. Výměna dříve odhalených tajemství

Klíč k Open WebUI a heslo k Wazuhu byly dříve vloženy do konverzace – považujte je za prozrazené.

**Open WebUI API klíč**
1. V Open WebUI (uživatel, pod kterým CONTIX volá model) vytvořit nový API klíč a **starý smazat**.
2. CONTIX → Administrace → AI asistent → vložit nový klíč → *Uložit* → *Test spojení*.

**Wazuh (indexer / API)**
1. Na serveru Wazuh změnit heslo uživatele, kterého CONTIX používá – Wazuh 4.x:
   `/usr/share/wazuh-indexer/plugins/opensearch-security/tools/wazuh-passwords-tool.sh -u <uživatel> -p '<nové heslo>'`
   (u Docker instalace Wazuhu postup podle jeho dokumentace). Doporučení: místo uživatele `admin`
   vytvořit samostatného uživatele jen pro čtení indexů `wazuh-states-vulnerabilities-*` a `wazuh-alerts-*`.
2. CONTIX → Administrace → Konektory → Wazuh Indexer → nové heslo → *Test*.
3. Pokud je heslo k Wazuh API i v `.env` (`WAZUH_API_PASSWORD`), upravit ho tam a restartovat API:
   `sudo docker compose --profile full up -d api`.

Na závěr znovu `sudo ./infra/scripts/verify.sh`.

## 5. Když se něco nepovede

- Log API: `sudo docker compose --profile full logs --tail 200 api`.
- Návrat: `update.sh` vytvořil zálohu v `backups/`. Nejdřív test obnovy
  `sudo docker compose --profile full run --rm backup restore.sh --test /backups/<soubor>`,
  pak (po zastavení API) `restore.sh /backups/<soubor> --yes` a `git checkout <předchozí commit>` + `update.sh --no-backup`.
