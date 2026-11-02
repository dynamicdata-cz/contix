#!/usr/bin/env bash
# Obnova databáze CONTIX ze zálohy (backup.sh).
#
#   restore.sh --test <soubor>       test obnovy do dočasné databáze (doporučeno pravidelně – § 26 / SOC 2 A1.3)
#   restore.sh <soubor> --yes        obnova do PGDATABASE (PŘEPÍŠE data – nejdřív zastavte API!)
#
# Šifrované zálohy (*.age) vyžadují privátní klíč: BACKUP_AGE_IDENTITY=/cesta/k/klici.txt
set -euo pipefail
export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-contix}" PGDATABASE="${PGDATABASE:-contix}"

usage() { sed -n '2,8p' "$0"; exit 1; }
MODE=restore
[[ "${1:-}" == "--test" ]] && { MODE=test; shift; }
FILE="${1:-}"
[[ -z "$FILE" || ! -f "$FILE" ]] && usage

# kontrolní součet
if [[ -f "$FILE.sha256" ]]; then
  (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" >/dev/null) || { echo "Kontrolní součet nesouhlasí!" >&2; exit 2; }
fi

SRC="$FILE"
if [[ "$FILE" == *.age ]]; then
  [[ -z "${BACKUP_AGE_IDENTITY:-}" ]] && { echo "Šifrovaná záloha – nastavte BACKUP_AGE_IDENTITY" >&2; exit 2; }
  SRC="$(mktemp /tmp/contix-restore.XXXXXX)"
  trap 'rm -f "$SRC"' EXIT
  age -d -i "$BACKUP_AGE_IDENTITY" -o "$SRC" "$FILE"
fi

if [[ "$MODE" == test ]]; then
  DB="contix_restore_test_$(date +%s)"
  createdb "$DB"
  trap 'dropdb --if-exists "$DB"; [[ "$SRC" != "$FILE" ]] && rm -f "$SRC"' EXIT
  pg_restore --no-owner -d "$DB" "$SRC"
  tables=$(psql -d "$DB" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")
  users=$(psql -d "$DB" -Atc "select count(*) from users")
  risks=$(psql -d "$DB" -Atc "select count(*) from risks")
  migr=$(psql -d "$DB" -Atc "select count(*) from drizzle.__drizzle_migrations" 2>/dev/null || echo "?")
  echo "Test obnovy OK: tabulek $tables, uživatelů $users, rizik $risks, migrací $migr"
  exit 0
fi

[[ "${2:-}" == "--yes" ]] || { echo "Obnova PŘEPÍŠE databázi $PGDATABASE na $PGHOST. Zastavte API a spusťte znovu s --yes." >&2; exit 1; }
pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$SRC"
echo "Obnova dokončena. Spusťte API (migrace se doplní při startu)."
