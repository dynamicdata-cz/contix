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
- **Automatický test obnovy** (od 1.72, `BACKUP_RESTORE_TEST`): `weekly` (výchozí, v neděli), `daily` nebo `off`.
  Čerstvá záloha se před zašifrováním obnoví do dočasné databáze a ověří se obsah (níže); klíč k dešifrování
  na serveru tedy není potřeba. Výsledek se zapíše jako test obnovy, chyba testu zálohu nezahodí.

```bash
docker compose run --rm backup backup.sh                       # záloha hned
age-keygen -o contix-backup.key                                # klíč pro šifrování (veřejná část do .env)
```

## Test obnovy (§ 26 vyhl. 409, SOC 2 A1.3) – automaticky týdně, ručně kdykoli

Na serveru (ze složky instalace, výchozí `/opt/contix`) – bez názvu souboru se otestuje **nejnovější záloha** (od 1.94):

```bash
cd /opt/contix && sudo docker compose --profile full run --rm backup restore.sh --test
# konkrétní záloha: … restore.sh --test /backups/contix-20261002-023000.dump
# šifrovaná: -e BACKUP_AGE_IDENTITY=/keys/contix-backup.key -v /bezpečné/místo:/keys:ro
```

Skripty jsou v `/opt/contix/infra/scripts`, zálohy ve složce `/opt/contix/backups` (v kontejneru `/backups`).

Obnoví do dočasné databáze, ověří obsah a databázi smaže. Ověření (od 1.72): klíčové evidence (společnosti,
uživatelé, aktiva, rizika, opatření, dokumenty, úkoly, auditní záznam) nesmí být po obnově prázdné, když v provozu
nejsou, migrace nesmí chybět ani být novější než v provozu; do záznamu se uloží doba obnovy a počty jako doklad. Od verze 1.48 se výsledek
(OK / chyba) zapíše do evidence záloh a v **Administrace → Provoz** je kontrola **Test obnovy**: varování, pokud
poslední úspěšný test je starší než 92 dní nebo žádný není, chyba, pokud poslední test selhal. Test zaznamenejte
také jako test plánu obnovy (Kontinuita → plány → test).

## Obnova

```bash
docker compose stop api
docker compose run --rm backup restore.sh /backups/contix-….dump --yes
docker compose start api      # migrace se při startu doplní
```

Obnovujte se stejným `APP_SECRET`, jinak nepůjde dešifrovat MFA a uložená hesla/klíče.
