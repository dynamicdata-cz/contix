# Nasazení

> **Postup instalace krok za krokem** (testovací server z GitLabu i zákazník z balíčku, certifikáty, klienti,
> předávací seznam) je v [install.md](install.md). Tato stránka popisuje složení a provozní detaily.

## Docker Compose (jeden server)

```bash
cp .env.example .env        # vyplňte APP_SECRET, POSTGRES_PASSWORD, APP_URL, CONTIX_DOMAIN, METRICS_TOKEN
docker compose --profile full up -d --build
docker compose logs -f api  # první administrátor: ADMIN_EMAIL/ADMIN_PASSWORD nebo dočasné heslo v logu
```

| Služba | Obsah |
|---|---|
| `db` | PostgreSQL 17 + pgvector, data ve svazku `pgdata`, port jen na 127.0.0.1 |
| `api` | Bun + Hono, při startu spustí migrace; healthcheck `/api/health` |
| `web` | Caddy: SPA + reverzní proxy `/api` → `api:3000`, automatické TLS pro `CONTIX_DOMAIN` |
| `backup` | denní záloha DB do `./backups` (viz [backup.md](backup.md)) |

- **TLS**: `CONTIX_DOMAIN` + `CONTIX_TLS_MODE` = `auto` (Let's Encrypt, veřejné DNS), `internal` (vlastní CA Caddy pro
  interní síť) nebo `files` (`certs/cert.pem` + `certs/key.pem` od CA zákazníka); porty `HTTP_PORT`/`HTTPS_PORT`.
- **APP_URL** = veřejná adresa (pro SSO a kontrolu Origin), **APP_SECRET** min. 32 znaků – šifruje MFA, hesla SMTP,
  API klíče; při ztrátě je nutné tato tajemství zadat znovu.
- **Aktualizace**: `sudo ./infra/scripts/update.sh` (záloha → git pull → sestavení → restart) nebo
  `update.sh <balíček.tar.gz>`; migrace se aplikují při startu API.
- **Více instancí API**: plánovač (upozornění, Wazuh alerty) běží jen na držiteli zámku v DB – bezpečné škálovat.

## AI model (Ollama / Open WebUI)

API CONTIXu musí na model dosáhnout:

- **Stejný server**: port publikovaný jen na `127.0.0.1` (`-p 127.0.0.1:8080:8080`) z kontejneru API dosažitelný není.
  Nejjednodušší je připojit Open WebUI do sítě CONTIXu (`docker network connect contix_default open-webui`) a v aplikaci
  zadat `http://open-webui:8080/api`; port na hostiteli může zůstat jen na 127.0.0.1.
- **Jiný server (GPU stroj)**: publikujte port jen do interní sítě (`-p <interní IP>:8080:8080`) a omezte firewallem
  na server CONTIX, nebo použijte SSH tunel (`ssh -N -L 8080:127.0.0.1:8080 gpu-server`).
- **Vývoj na notebooku**: SSH tunel na GPU server a v aplikaci `http://127.0.0.1:8080/api`.
- API klíč: Open WebUI → Nastavení → Účet → API klíče (uživatel s přístupem k modelu).

## Kontrola po nasazení

1. `curl https://contix.firma.cz/api/health` → `{"status":"ok"}`
2. Administrace → Provoz: všechny kontroly zelené (záloha po první noci).
3. Administrace → AI asistent → Otestovat spojení.

## Kontrola po nasazení (v0.55.1)

`sudo ./infra/scripts/verify.sh` – kontejnery, místo na disku, verze, migrace, pgvector, všechny kontroly z Provozu,
test AI, Wazuh Indexer a dostupnost zdrojů hrozeb (CISA KEV, EPSS). Spouští se i na konci `update.sh` (bez testu AI).
Postup pro verze 0.49–0.55 včetně výměny tajemství: [upgrade-0.49-0.55.md](upgrade-0.49-0.55.md).
