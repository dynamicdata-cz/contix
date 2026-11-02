#!/usr/bin/env bash
# Společné funkce instalačních skriptů CONTIX.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

info() { printf '\033[1;34m▶\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m✖\033[0m %s\n' "$*" >&2; exit 1; }

need_docker() {
  command -v docker >/dev/null || die "Docker není nainstalován (https://docs.docker.com/engine/install/)."
  docker info >/dev/null 2>&1 || die "Docker neběží nebo nemáte oprávnění – spusťte se sudo nebo přidejte uživatele do skupiny docker."
  docker compose version >/dev/null 2>&1 || die "Chybí plugin docker compose (balíček docker-compose-plugin)."
}

dc() { docker compose --profile full "$@"; }

env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }

env_set() { # klíč hodnota – nahradí nebo přidá řádek v .env
  local k="$1" v="$2"
  if grep -qE "^#? ?$k=" .env; then
    sed -i.bak -E "s|^#? ?$k=.*|$k=${v//|/\\|}|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$k" "$v" >>.env
  fi
}

# Čeká na zdravé API (healthcheck kontejneru)
wait_healthy() {
  local i st
  for i in $(seq 1 60); do
    st="$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q api)" 2>/dev/null || echo starting)"
    [ "$st" = healthy ] && return 0
    sleep 5
  done
  dc logs --tail 50 api >&2
  die "API se nespustilo (stav: $st). Výpis logu je výše."
}

bundle_mode() { [ -f images.tar.gz ] || [ -f images.tar ]; }

load_images() {
  local f
  for f in images.tar.gz images.tar; do
    [ -f "$f" ] || continue
    info "Načítám obrazy z ${f}…"
    if [[ "$f" == *.gz ]]; then gunzip -c "$f" | docker load; else docker load -i "$f"; fi
  done
}
