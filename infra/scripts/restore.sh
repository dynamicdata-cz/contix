#!/usr/bin/env bash
# Obnova databáze CONTIX ze zálohy (backup.sh).
#
#   restore.sh --test [soubor]       test obnovy do dočasné databáze s ověřením obsahu (§ 26 / SOC 2 A1.3);
#                                    bez souboru vezme nejnovější zálohu v /backups (v1.94);
#                                    služba záloh ho spouští sama jednou týdně (BACKUP_RESTORE_TEST)
#   ze serveru:  cd /opt/contix && sudo docker compose --profile full run --rm backup restore.sh --test
#   restore.sh <soubor> --yes        obnova do PGDATABASE (PŘEPÍŠE data – nejdřív zastavte API!)
#
# Šifrované zálohy (*.age) vyžadují privátní klíč: BACKUP_AGE_IDENTITY=/cesta/k/klici.txt
set -euo pipefail
export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-contix}" PGDATABASE="${PGDATABASE:-contix}"

usage() { sed -n '2,10p' "$0"; exit 1; }
MODE=restore
[[ "${1:-}" == "--test" ]] && { MODE=test; shift; }
FILE="${1:-}"
# test bez souboru = nejnovější záloha (v1.94)
if [[ "$MODE" == test && -z "$FILE" ]]; then
  FILE="$(ls -1t "${BACKUP_DIR:-/backups}"/contix-*.dump "${BACKUP_DIR:-/backups}"/contix-*.dump.age 2>/dev/null | head -1 || true)"
  [[ -z "$FILE" ]] && { echo "V ${BACKUP_DIR:-/backups} není žádná záloha – nejdřív spusťte backup.sh." >&2; exit 1; }
  echo "Test obnovy nejnovější zálohy: $FILE"
fi
[[ -z "$FILE" || ! -f "$FILE" ]] && usage

# kontrolní součet
if [[ -f "$FILE.sha256" ]]; then
  (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" >/dev/null) || { echo "Kontrolní součet nesouhlasí!" >&2; exit 2; }
fi

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ENC=false
[[ "$FILE" == *.age ]] && ENC=true
SRC="$FILE"
if [[ "$FILE" == *.age ]]; then
  [[ -z "${BACKUP_AGE_IDENTITY:-}" ]] && { echo "Šifrovaná záloha – nastavte BACKUP_AGE_IDENTITY" >&2; exit 2; }
  SRC="$(mktemp /tmp/contix-restore.XXXXXX)"
  trap 'rm -f "$SRC"' EXIT
  age -d -i "$BACKUP_AGE_IDENTITY" -o "$SRC" "$FILE"
fi

# výsledek testu obnovy do backup_runs (Administrace → Provoz, kontrola „Test obnovy“) – v1.48, ADR-145
# RESTORE_LABEL = název souboru do záznamu (automatický test v backup.sh testuje dočasný soubor před šifrováním)
record_test() { # status message
  psql -q -v ON_ERROR_STOP=1 -v started="$STARTED" -v status="$1" -v file="${RESTORE_LABEL:-$(basename "$FILE")}" -v enc="$ENC" -v msg="$2" -v host="$(hostname)" <<'SQL' || echo "VAROVÁNÍ: výsledek testu obnovy se nepodařilo zapsat do databáze" >&2
insert into backup_runs (started_at, finished_at, status, file, encrypted, host, message, kind)
values (:'started'::timestamptz, now(), :'status', :'file', :'enc'::boolean, :'host', nullif(:'msg', ''), 'restore_test');
SQL
}

if [[ "$MODE" == test ]]; then
  DB="contix_restore_test_$(date +%s)"
  T0=$(date +%s)
  createdb "$DB"
  trap 'dropdb --if-exists "$DB"; [[ "$SRC" != "$FILE" ]] && rm -f "$SRC"' EXIT
  if ! pg_restore --no-owner -d "$DB" "$SRC" 2>"/tmp/contix-restore-$$.err"; then
    msg="pg_restore selhal: $(tail -c 400 "/tmp/contix-restore-$$.err")"
    rm -f "/tmp/contix-restore-$$.err"
    echo "$msg" >&2
    record_test error "$msg"
    exit 3
  fi
  rm -f "/tmp/contix-restore-$$.err"
  # ověření obsahu (v1.72, ADR-165): klíčové evidence nesmí být v obnovené databázi prázdné, když v provozní nejsou,
  # migrace nesmí chybět; počty jdou do záznamu testu jako doklad (SOC 2 A1.3, § 26 vyhlášky)
  count() { psql -d "$1" -Atc "select count(*) from $2" 2>/dev/null || echo "?"; }
  tables=$(psql -d "$DB" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")
  migr=$(count "$DB" drizzle.__drizzle_migrations)
  live_migr=$(count "$PGDATABASE" drizzle.__drizzle_migrations)
  problems=""
  summary=""
  for t in companies users assets risks controls policies tasks audit_log; do
    r=$(count "$DB" "$t")
    l=$(count "$PGDATABASE" "$t")
    summary+="$t $r, "
    if [[ "$r" == "?" ]]; then
      problems+="chybí tabulka $t; "
    elif [[ "$l" =~ ^[0-9]+$ && "$l" -gt 0 && "$r" -eq 0 ]]; then
      problems+="$t je prázdná (v provozu $l); "
    fi
  done
  if [[ "$migr" == "?" || "$migr" -eq 0 ]]; then
    problems+="chybí migrace; "
  elif [[ "$live_migr" =~ ^[0-9]+$ && "$migr" -gt "$live_migr" ]]; then
    problems+="záloha má novější schéma ($migr migrací) než provoz ($live_migr); "
  fi
  secs=$(( $(date +%s) - T0 ))
  msg="obnova za $secs s, tabulek $tables, migrací $migr; ${summary%, }"
  if [[ -n "$problems" ]]; then
    msg="Obsah zálohy neodpovídá: ${problems%; } ($msg)"
    record_test error "$msg"
    echo "$msg" >&2
    exit 4
  fi
  record_test ok "$msg"
  echo "Test obnovy OK: $msg"
  exit 0
fi

[[ "${2:-}" == "--yes" ]] || { echo "Obnova PŘEPÍŠE databázi $PGDATABASE na $PGHOST. Zastavte API a spusťte znovu s --yes." >&2; exit 1; }
pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$SRC"
echo "Obnova dokončena. Spusťte API (migrace se doplní při startu)."
