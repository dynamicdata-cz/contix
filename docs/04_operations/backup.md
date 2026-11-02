# Zálohy a obnova

## Co se zálohuje

Celá databáze (`pg_dump -Fc`) – všechna evidence, dokumenty ISMS (verze jsou v DB), nastavení a šifrovaná tajemství.
Mimo DB je jen konfigurace (`.env` – **zálohujte zvlášť a bezpečně**, obsahuje `APP_SECRET`) a certifikáty Caddy.

## Služba `backup`

- Denně v `BACKUP_TIME` (výchozí 02:30, `TZ=Europe/Prague`) vytvoří `contix-YYYYMMDD-HHMMSS.dump` + `.sha256`.
- Ověří čitelnost archivu (`pg_restore --list`), smaže zálohy starší než `BACKUP_KEEP_DAYS` (14).
- `BACKUP_AGE_RECIPIENT=age1…` → záloha se zašifruje veřejným klíčem [age](https://age-encryption.org);
  privátní klíč uchovávejte mimo server (trezor, offline).
- `BACKUP_COPY_DIR` → kopie na připojený NAS / síťový disk (pravidlo 3-2-1).
- Výsledek (i chyba) se zapíše do `backup_runs` → Administrace → Provoz, metrika `contix_backup_last_success_timestamp_seconds`.

```bash
docker compose run --rm backup backup.sh                       # záloha hned
age-keygen -o contix-backup.key                                # klíč pro šifrování (veřejná část do .env)
```

## Test obnovy (pravidelně, např. čtvrtletně – § 26 vyhl. 409, SOC 2 A1.3)

```bash
docker compose run --rm -v $PWD/backups:/backups backup restore.sh --test /backups/contix-20261002-023000.dump
# šifrovaná: -e BACKUP_AGE_IDENTITY=/keys/contix-backup.key -v /bezpečné/místo:/keys:ro
```

Obnoví do dočasné databáze, vypíše počty tabulek/uživatelů/rizik a databázi smaže. Výsledek zaznamenejte jako test
plánu obnovy (Kontinuita → plány → test).

## Obnova

```bash
docker compose stop api
docker compose run --rm backup restore.sh /backups/contix-….dump --yes
docker compose start api      # migrace se při startu doplní
```

Obnovujte se stejným `APP_SECRET`, jinak nepůjde dešifrovat MFA a uložená hesla/klíče.
