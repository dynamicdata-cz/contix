# Instalace CONTIX na server

Tři způsoby instalace se stejnými skripty:

| | Zdroj | Kdy |
|---|---|---|
| **A. Z repozitáře** | `git clone` z GitLabu, obrazy se sestaví na serveru | vlastní testovací / interní server s přístupem do GitLabu |
| **C. Z veřejného repozitáře** | `git clone` z GitHubu (větev `main` = poslední vydání) | zákazník s přístupem na internet, open-source instalace (kap. 4a) |
| **B. Z balíčku** | `contix-<verze>.tar.gz` s hotovými obrazy (`bundle.sh`) | u zákazníka – server nepotřebuje GitLab ani internet |

Skripty: `infra/scripts/install.sh` (první instalace), `update.sh` (aktualizace se zálohou), `bundle.sh` (balíček).

## 1. Požadavky na server

- Linux x86_64 (Ubuntu 22.04/24.04 LTS, Debian 12, RHEL/Rocky 9), **2 vCPU, 4 GB RAM, 40 GB disk** (+ místo na zálohy); s převodní službou dokumentů (v0.24) doporučeno **6 GB RAM**.
- **Docker Engine** a plugin **docker compose** (`docker compose version`). Instalace na Ubuntu:
  ```bash
  sudo apt-get update && sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
  sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  ```
- Volné porty **80 a 443** (nebo jiné – `--http-port`, `--https-port`). Kontrola: `sudo ss -ltnp | grep -E ':(80|443)\b'`.
- Adresa, pod kterou budou uživatelé CONTIX otevírat (DNS záznam nebo položka v `hosts`).
- Firewall: z uživatelské sítě 443 (a 80 pro přesměrování), ze serveru odchozí spojení na AI server, Wazuh, SMTP, IdP (SSO).

## 2. Certifikát (HTTPS)

| `--tls` | Kdy | Co udělat |
|---|---|---|
| `internal` | interní síť bez certifikační autority (test, menší zákazník) | Caddy vytvoří vlastní CA; její kořenový certifikát `contix-root-ca.crt` nainstalujte do počítačů uživatelů (kap. 5) |
| `files` | zákazník má interní CA (AD CS…) nebo koupený certifikát | před instalací uložte `certs/cert.pem` (certifikát + mezilehlé) a `certs/key.pem` |
| `auto` | server s veřejným DNS a dostupným portem 80/443 z internetu | nic – Caddy získá certifikát Let's Encrypt sám |

> Doména `.local` je vyhrazená pro mDNS (Bonjour) a na macOS může zpomalovat překlad. Pro test postačí,
> u zákazníka používejte skutečný DNS název (např. `contix.firma.cz` nebo `contix.firma.internal`).

## 3. Instalace A – testovací server z GitLabu (např. `contix-test`, 192.0.2.10)

Na serveru jako běžný uživatel (např. admin):

```bash
# 1) přístup do GitLabu jen pro čtení (deploy key)
ssh-keygen -t ed25519 -f ~/.ssh/contix_deploy -N "" -C "contix-deploy@$(hostname)"
cat ~/.ssh/contix_deploy.pub
```

Veřejný klíč vložte v GitLabu: projekt **<skupina>/contix → Settings → Repository → Deploy keys → Add new key**
(bez „Grant write permissions“). Pak:

```bash
cat >> ~/.ssh/config <<'EOF'
Host gitlab-contix
  HostName 192.0.2.5
  Port 2222
  User git
  IdentityFile ~/.ssh/contix_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

sudo mkdir -p /opt/contix && sudo chown "$USER": /opt/contix
git clone gitlab-contix:<skupina>/contix.git /opt/contix
cd /opt/contix

# 2) instalace (sestavení obrazů trvá při prvním běhu 5–10 minut)
sudo ./infra/scripts/install.sh --domain contix.test.local --tls internal --admin admin@firma.cz
```

Skript vytvoří `.env` s vygenerovanými tajemstvími (práva 600), sestaví a spustí kontejnery (`db`, `api`, `web`, `backup`, `converter`),
počká na zdravé API, uloží kořenový certifikát `contix-root-ca.crt` a vypíše **dočasné heslo administrátora**.

**Aktualizace** po `git push` do GitLabu:

```bash
cd /opt/contix && sudo ./infra/scripts/update.sh
```

(záloha DB → `git pull` → sestavení → restart; migrace databáze proběhnou při startu API).

## 4a. Instalace C – z veřejného repozitáře (GitHub)

Veřejný repozitář obsahuje jen vydání (jeden commit a tag `v<verze>` na vydání), větev `main` je vždy poslední vydání.

```bash
sudo mkdir -p /opt/contix && sudo chown "$USER": /opt/contix
git clone https://github.com/dynamicdata-cz/contix.git /opt/contix
cd /opt/contix
sudo ./infra/scripts/install.sh --domain contix.firma.cz --tls files --admin spravce@firma.cz
# volitelně ukázková data (fiktivní společnost) pro vyzkoušení:
sudo docker compose --profile full exec api bun src/scripts/demo-seed.ts
```

**Aktualizace:** `cd /opt/contix && sudo ./infra/scripts/update.sh` (záloha → `git pull` → sestavení → restart).
Novinky a změny jsou v `CHANGELOG.md`, vydání na stránce Releases repozitáře.

## 4. Instalace B – u zákazníka z balíčku

**Příprava balíčku** (na testovacím serveru nebo jiném Linux amd64 stroji s Dockerem a internetem):

```bash
cd /opt/contix && git pull
./infra/scripts/bundle.sh            # → dist/contix-<verze>.tar.gz + .sha256 (cca 300–500 MB)
```

Na Macu s Apple Silicon balíček nesestavujte (obrazy by byly pro ARM) – případně `--platform linux/amd64` (pomalé).

**U zákazníka:**

```bash
sha256sum -c contix-<verze>.tar.gz.sha256
tar xzf contix-<verze>.tar.gz && sudo mv contix-<verze> /opt/contix && cd /opt/contix
sudo ./infra/scripts/install.sh --domain contix.zakaznik.cz --tls files --admin spravce@zakaznik.cz
```

**Aktualizace u zákazníka:** přeneste nový balíček a spusťte

```bash
cd /opt/contix && sudo ./infra/scripts/update.sh /cesta/contix-<nová verze>.tar.gz
```

Zůstávají `.env`, `certs/`, `backups/` a datové svazky; nahradí se obrazy, `docker-compose.yml`, skripty a dokumentace.

## 5. Klienti – adresa a důvěra certifikátu

**Bez DNS** přidejte do souboru hosts každého počítače (jinak DNS záznam typu A na IP serveru):

```text
192.0.2.10  contix.test.local
```

- macOS / Linux: `sudo sh -c 'echo "192.0.2.10 contix.test.local" >> /etc/hosts'`
- Windows (PowerShell jako správce): `Add-Content C:\Windows\System32\drivers\etc\hosts "192.0.2.10 contix.test.local"`

**Kořenový certifikát** (jen `--tls internal`) – soubor `contix-root-ca.crt` ze složky instalace
(`scp admin@192.0.2.10:/opt/contix/contix-root-ca.crt .`):

- macOS: `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain contix-root-ca.crt`
- Windows (jako správce): `certutil -addstore -f Root contix-root-ca.crt`; v doméně hromadně přes GPO
  (Computer Configuration → Policies → Windows Settings → Security Settings → Public Key Policies → Trusted Root CAs).
- Linux: `sudo cp contix-root-ca.crt /usr/local/share/ca-certificates/contix.crt && sudo update-ca-certificates`
- Firefox má vlastní úložiště: Nastavení → Soukromí a zabezpečení → Certifikáty → Importovat (důvěřovat pro weby),
  nebo `about:config` → `security.enterprise_roots.enabled = true` (převezme certifikáty systému).

**Úpravy v desktopovém Word / Excel (v0.25)** – Office otevírá dokumenty přímo z CONTIXu přes HTTPS (WebDAV):

- Certifikát CONTIXu musí být důvěryhodný v **systémovém** úložišti (Office nepoužívá výjimky prohlížeče) – viz výše.
- Windows: adresu CONTIXu zařaďte do zóny **Místní intranet** (GPO: Computer Configuration → Administrative Templates →
  Windows Components → Internet Explorer → Internet Control Panel → Security Page → *Site to Zone Assignment List*,
  hodnota `https://contix.firma.cz` = `1`). Jinak Office může dokument otevřít v chráněném zobrazení (jen čtení)
  nebo se ptát na důvěryhodnost.
- Prohlížeč se při prvním otevření zeptá, zda povolit odkazy `ms-word:` / `ms-excel:` – povolte (lze zapamatovat).
- macOS: Microsoft 365 pro Mac odkazy podporuje; certifikát musí být v Klíčence (System) jako důvěryhodný.
- Na serveru se nic nenastavuje – WebDAV běží na stejné adrese pod `/dav/…` (token v adrese se nezapisuje do logů).

Kořenová CA je ve svazku `contix_caddy_data` – zálohujte ho (kap. 9). Při jeho ztrátě vznikne nová CA a certifikát
je nutné do klientů nainstalovat znovu.

## 6. Po instalaci

1. Otevřete `https://contix.test.local`, přihlaste se dočasným heslem (vypsal ho `install.sh`; znovu:
   `sudo docker compose --profile full logs api | grep -A1 "Vytvořen administrátor"`), nastavte nové heslo a **MFA**.
2. **Administrace → Nastavení** – název organizace, režim (vyšší/nižší povinnosti), moduly.
3. **Administrace → AI asistent** a **Konektory → Wazuh** – kap. 7 a 8.
4. **Data** – Import dat (Excel/CSV): nejdřív organizace a funkční místa, pak aktiva, procesy, rizika, opatření,
   dodavatelé (viz [import](../03_modules/import/overview.md)). Technická aktiva doplní Wazuh.
5. **SSO, SMTP** – proměnné v `.env` (vzor `infra/server.env.example`), pak `sudo docker compose --profile full up -d`.
6. **Administrace → Provoz** – všechny kontroly zelené. První záloha proběhne v noci, hned ručně:
   `sudo docker compose --profile full run --rm backup backup.sh`.

## 7. Napojení lokální AI (Open WebUI + Ollama)

CONTIX (kontejner `api`) se k modelu připojuje **přímo po síti** – SSH tunel není potřeba. Open WebUI ale musí
poslouchat na síťové adrese, ne jen na `127.0.0.1` (výchozí stav po instalaci).

**Na serveru s Open WebUI** (příklad: `ai-server`, 192.0.2.20, Open WebUI spuštěné přes `docker run`):

```bash
# zjistit obraz, GPU a mapování portů
sudo docker inspect -f '{{.Config.Image}} | GPU: {{json .HostConfig.DeviceRequests}}' open-webui
sudo docker ps --format '{{.Names}}  {{.Ports}}' | grep open-webui     # např. 127.0.0.1:8080->8080

# kontejner vytvořit znovu se stejnými svazky (data, uživatelé i API klíče zůstanou)
sudo docker stop open-webui && sudo docker rename open-webui open-webui-old
sudo docker run -d --name open-webui --restart unless-stopped --gpus all \
  -p 127.0.0.1:8080:8080 -p 192.0.2.20:8080:8080 \
  -v open-webui:/app/backend/data -v open-webui-ollama:/root/.ollama \
  ghcr.io/open-webui/open-webui:ollama
curl -s -o /dev/null -w "%{http_code}\n" http://192.0.2.20:8080/health    # 200
sudo docker exec open-webui nvidia-smi --query-gpu=name --format=csv,noheader  # GPU vidí
sudo docker rm open-webui-old                                                 # až vše funguje
sudo ufw allow from <IP CONTIXu> to any port 8080 proto tcp                   # pokud běží ufw
```

`--gpus all` jen pokud původní kontejner GPU používal (`DeviceRequests` není `null`). Je-li Open WebUI spuštěné
přes compose, stačí v něm změnit `ports` a `docker compose up -d`. Bez `WEBUI_SECRET_KEY` se uživatelé Open WebUI
musí po změně znovu přihlásit; API klíče platí dál.

**Kontrola ze serveru CONTIX:**
`curl -s -H "Authorization: Bearer <klíč>" http://192.0.2.20:8080/api/models | head -c 200`

**V CONTIXu – Administrace → AI asistent:** typ OpenAI-kompatibilní, adresa `http://192.0.2.20:8080/api`,
model `gpt-oss:20b`, API klíč (Open WebUI → Nastavení → Účet → API klíče; pro CONTIX samostatný klíč),
*Zapnout AI asistenta* → **Uložit a otestovat spojení**. MCP nechte vypnuté (viz [AI dotazy a MCP](../03_modules/ai/queries_mcp.md)).

## 8. Napojení Wazuhu (aktiva a zranitelnosti)

CONTIX potřebuje **dva účty jen pro čtení** – Wazuh API (agenti, software) a Wazuh Indexer (zranitelnosti, Wazuh 4.8+):

| Účet | Port | Kde se zakládá | Oprávnění |
|---|---|---|---|
| `contix-ro` | 55000 | Wazuh dashboard → **Server management → Security → Users** | role `readonly`, „Allow run as“ vypnuto |
| `contix-indexer` | 9200 | Wazuh dashboard → **Indexer management → Security** | vlastní role `contix_vuln_read` (níže) |

**Role pro indexer** (Indexer management → Security → Roles → Create role):
- Cluster permissions: `cluster_composite_ops_ro`
- Index permissions: indexy `wazuh-states-vulnerabilities-*` (zranitelnosti) a `wazuh-alerts-*` (alerty → návrhy
  událostí) – každý potvrdit Enterem, oprávnění `read`
- Pak Internal users → Create `contix-indexer` a v roli záložka **Mapped users → Manage mapping** → přidat uživatele.

Nepoužívejte účet `admin` indexeru (smí vše včetně mazání indexů).

**Indexer poslouchá ve výchozím stavu jen na localhostu.** Na Wazuh serveru zpřístupněte jen HTTP rozhraní
(port 9200; interní transport 9300 zůstává lokální, takže se nezapnou přísnější startovací kontroly OpenSearch):

```bash
sudo ss -ltnp | grep -E ':(9200|55000)\b'            # 127.0.0.1:9200 = jen lokálně
sudo cp /etc/wazuh-indexer/opensearch.yml /etc/wazuh-indexer/opensearch.yml.bak-contix
echo 'http.host: "0.0.0.0"' | sudo tee -a /etc/wazuh-indexer/opensearch.yml
sudo systemctl restart wazuh-indexer && sleep 45 && sudo systemctl is-active wazuh-indexer
sudo ufw allow from <IP CONTIXu> to any port 9200 proto tcp comment "CONTIX"   # pokud běží ufw
```

Návrat: obnovit `opensearch.yml.bak-contix` a restartovat `wazuh-indexer`.

**Kontrola ze serveru CONTIX:**

```bash
curl -sk -u 'contix-ro:HESLO' -X POST "https://<wazuh>:55000/security/user/authenticate?raw=true" | head -c 40; echo
curl -sk -u 'contix-indexer:HESLO' "https://<wazuh>:9200/wazuh-states-vulnerabilities-*/_count"; echo
```

**V CONTIXu – Administrace → Konektory → Wazuh:** URL API `https://<wazuh>:55000` + `contix-ro`, URL indexeru
`https://<wazuh>:9200` + `contix-indexer`, *Ověřovat TLS* vypnout při výchozích self-signed certifikátech Wazuhu,
u obou **Otestovat** → **Uložit**. Pak **Discovery & import → Wazuh** (první synchronizace).

**Automatická synchronizace:** aktiva, software a zranitelnosti se pak synchronizují samy podle nastavení konektoru
(výchozí každých 24 h; 6 / 12 h nebo vypnuto) – plánovač kontroluje každých 15 minut, interval se počítá od posledního
běhu (i ručního). Wazuh **alerty** → návrhy bezpečnostních událostí se načítají každých 15 minut.
Stav posledního běhu je u konektoru a v Discovery & import.

## 8a. Převodní služba dokumentů (PDF, vyhledávání, porovnání)

Kontejner `converter` (LibreOffice) převádí Word/Excel/PowerPoint do PDF pro čtení v portálu, čte text z PDF
pro vyhledávání a porovnání verzí. Běží v **interní síti bez přístupu ven** a neotevírá žádný port; originály dokumentů nemění.

- Písma: obsahuje písma metricky shodná s Microsoft Office (Calibri → Carlito, Cambria → Caladea, Arial/Times → Liberation).
  Pro **Aptos** (výchozí písmo M365) nebo firemní písmo nahrajte soubory `.ttf`/`.otf` do složky `fonts/` v instalaci
  a spusťte `sudo docker compose --profile full restart converter`. U dokumentů převedených dříve zvolte v CONTIXu
  u souboru „Zkusit znovu“, případně nechte gestora nahrát vlastní PDF exportované z Wordu (má přednost – použije se
  beze změny vzhledu, jen s doložkou).
- Stav: Administrace → Provoz („Převodní služba dokumentů“: počet čekajících a chybných převodů).
- Vypnutí: `CONVERTER_URL=` (prázdné) v `.env` – PDF náhledy Wordu nebudou, text pro vyhledávání se čte jen z formátů Office.
- Po aktualizaci na v0.24 se existující soubory zpracují postupně plánovačem (dávky každých 15 minut).

## 9. Zálohy a obnova

- Služba `backup` zálohuje DB denně v `BACKUP_TIME` do `backups/` (retence `BACKUP_KEEP_DAYS`), viz [backup.md](backup.md).
- U zákazníka nastavte **šifrování** (`BACKUP_AGE_RECIPIENT`) a **kopii mimo server** (`BACKUP_COPY_DIR`, NAS).
- Mimo DB zálohujte `.env` (obsahuje `APP_SECRET` – bez něj nejdou dešifrovat MFA a uložená hesla) a svazek
  s certifikáty:
  `sudo docker run --rm -v contix_caddy_data:/d -v "$PWD":/b alpine tar czf /b/caddy-data.tgz -C /d .`
- Obnovu si vyzkoušejte hned po instalaci (`infra/scripts/restore.sh`, postup v [backup.md](backup.md)).

## 10. Užitečné příkazy (ve složce instalace)

```bash
sudo docker compose --profile full ps              # stav kontejnerů
sudo docker compose --profile full logs -f api     # log API
sudo docker compose --profile full restart api     # restart API
sudo docker compose --profile full down            # zastavení (data zůstávají ve svazcích)
sudo docker compose exec api bun src/scripts/create-admin.ts jmeno@firma.cz "Jméno Příjmení"
sudo ./infra/scripts/update.sh                     # aktualizace (záloha → git pull → sestavení → restart)
```

**Čistá reinstalace** (nevratně maže data – předtím záloha a její kopie mimo server):

| Varianta | Příkazy |
|---|---|
| Jen prázdná databáze (konfigurace a certifikát zůstanou) | `sudo docker compose --profile full down && sudo docker volume rm contix_pgdata && sudo ./infra/scripts/install.sh` |
| Úplně od nuly (nová hesla i CA – certifikát znovu do klientů) | `sudo docker compose --profile full down -v --remove-orphans && sudo rm -f .env contix-root-ca.crt && sudo ./infra/scripts/install.sh --domain … --tls … --admin …` |
| Odinstalace | `sudo docker compose --profile full down -v --rmi all --remove-orphans && cd / && sudo rm -rf /opt/contix` |

## 11. Řešení problémů

| Příznak | Příčina / řešení |
|---|---|
| `install.sh`: `API se nespustilo`, v logu `Cannot find module …` | starší verze obrazu (< 0.21.1) – `git pull` a znovu `sudo ./infra/scripts/install.sh` |
| Prohlížeč: „Bad Gateway“ | kontejner `api` neběží / restartuje se: `docker compose --profile full ps` a `logs --tail 50 api` |
| `scp … contix-root-ca.crt: Permission denied` | starší instalace: `sudo chmod 644 /opt/contix/contix-root-ca.crt` |
| Prohlížeč hlásí nedůvěryhodný certifikát | kořenový certifikát není v systému klienta (kap. 5) nebo nebyl restartován prohlížeč |
| `contix.test.local` se nenačte | chybí položka v `hosts` / DNS; ověřte `ping contix.test.local` |
| AI: „Nelze se spojit s AI serverem“ | Open WebUI poslouchá jen na localhostu nebo blokuje firewall (kap. 7) |
| AI: HTTP 401 | neplatný API klíč nebo v Open WebUI vypnuté API klíče (Administrace → Obecné) |
| Wazuh indexer: `Connection refused` | indexer jen na localhostu (`network.host: 127.0.0.1`) – kap. 8 |
| Wazuh indexer: 403 / 404 | roli chybí index (`wazuh-states-vulnerabilities-*`, `wazuh-alerts-*`) nebo mapování uživatele / není zapnutá detekce zranitelností |

## 12. Předávací kontrolní seznam (zákazník)

- [ ] Server dle kap. 1, Docker, porty, firewall
- [ ] Certifikát (`files` od CA zákazníka / `internal` + rozdání kořenového certifikátu GPO)
- [ ] DNS záznam, `APP_URL` odpovídá adrese v prohlížeči
- [ ] Administrátor zákazníka: změna hesla, MFA; dočasné účty dodavatele odstraněny
- [ ] SSO (AD FS / Entra ID) a mapování skupin na role
- [ ] Zálohy: šifrování, kopie mimo server, **test obnovy** zapsán
- [ ] Monitoring (`/api/metrics` s `METRICS_TOKEN`, viz [monitoring.md](monitoring.md))
- [ ] AI asistent jen s lokálním modelem (kap. 7); MCP vypnuté nebo omezené na IP adresy
- [ ] Wazuh: účty jen pro čtení, automatická synchronizace zapnutá, první běh úspěšný (kap. 8)
- [ ] Předán `.env` (bezpečně) a kontakty pro podporu; zapsána verze (`cat VERSION` / Administrace → Provoz)
