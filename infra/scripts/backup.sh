#!/usr/bin/env bash
# Záloha databáze CONTIX (pg_dump, vlastní formát) + kontrola čitelnosti, volitelné šifrování (age),
# kopie mimo server, retence a zápis výsledku do tabulky backup_runs (zobrazí se v Administrace → Provoz).
#
#   backup.sh            jednorázová záloha
#   backup.sh --loop     denně v BACKUP_TIME (služba backup v docker compose)
#
# Proměnné: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE (standard libpq)
#           BACKUP_DIR (/backups) BACKUP_KEEP_DAYS (14) BACKUP_TIME (02:30)
#           BACKUP_AGE_RECIPIENT (veřejný klíč age → šifrování) BACKUP_COPY_DIR (kopie mimo server)
set -euo pipefail

export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-contix}" PGDATABASE="${PGDATABASE:-contix}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

record() { # status file size encrypted message
  psql -q -v ON_ERROR_STOP=1 \
    -v started="$STARTED" -v status="$1" -v file="$2" -v size="$3" -v enc="$4" -v msg="$5" -v host="$(hostname)" <<'SQL' || echo "VAROVÁNÍ: výsledek zálohy se nepodařilo zapsat do databáze" >&2
insert into backup_runs (started_at, finished_at, status, file, size_bytes, encrypted, host, message)
values (:'started'::timestamptz, now(), :'status', nullif(:'file', ''), nullif(:'size', '')::bigint, :'enc'::boolean, :'host', nullif(:'msg', ''));
SQL
}

run_backup() {
  STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local ts tmp out size enc=false msg=""
  ts="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  tmp="$BACKUP_DIR/.contix-$ts.dump.part"
  out="$BACKUP_DIR/contix-$ts.dump"

  if ! pg_dump -Fc -Z 6 -f "$tmp" 2>"$tmp.err"; then
    msg="pg_dump selhal: $(tail -c 400 "$tmp.err")"
    rm -f "$tmp" "$tmp.err"
    echo "$msg" >&2
    record error "" "" false "$msg"
    return 1
  fi
  rm -f "$tmp.err"
  # záloha musí být čitelná pro pg_restore (ověření struktury archivu)
  if ! pg_restore --list "$tmp" >/dev/null; then
    rm -f "$tmp"
    record error "" "" false "Archiv zálohy není čitelný (pg_restore --list)"
    return 1
  fi

  if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
    age -r "$BACKUP_AGE_RECIPIENT" -o "$out.age" "$tmp"
    rm -f "$tmp"
    out="$out.age"
    enc=true
  else
    mv "$tmp" "$out"
  fi
  sha256sum "$out" | sed "s#  .*/#  #" >"$out.sha256"
  size="$(stat -c %s "$out")"

  if [[ -n "${BACKUP_COPY_DIR:-}" ]]; then
    if cp "$out" "$out.sha256" "$BACKUP_COPY_DIR/"; then
      msg="kopie: $BACKUP_COPY_DIR"
    else
      msg="VAROVÁNÍ: kopie do $BACKUP_COPY_DIR selhala"
    fi
  fi

  # retence (lokálně i v kopii)
  find "$BACKUP_DIR" -maxdepth 1 -name 'contix-*' -mtime +"$KEEP_DAYS" -delete || true
  [[ -n "${BACKUP_COPY_DIR:-}" ]] && find "$BACKUP_COPY_DIR" -maxdepth 1 -name 'contix-*' -mtime +"$KEEP_DAYS" -delete || true

  echo "Záloha OK: $out ($size B)${msg:+ – $msg}"
  record ok "$(basename "$out")" "$size" "$enc" "$msg"
}

seconds_until() { # HH:MM → sekundy do nejbližšího výskytu
  local now target
  now=$(date +%s)
  target=$(date -d "today $1" +%s)
  ((target <= now)) && target=$(date -d "tomorrow $1" +%s)
  echo $((target - now))
}

if [[ "${1:-}" == "--loop" ]]; then
  at="${BACKUP_TIME:-02:30}"
  echo "Služba záloh: denně v $at (TZ=${TZ:-UTC}), retence $KEEP_DAYS dní, adresář $BACKUP_DIR"
  until pg_isready -q; do sleep 5; done
  while true; do
    s=$(seconds_until "$at")
    echo "Další záloha za $((s / 60)) min"
    sleep "$s"
    run_backup || true
  done
else
  run_backup
fi
