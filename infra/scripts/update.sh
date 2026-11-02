#!/usr/bin/env bash
# CONTIX – aktualizace na serveru. Před aktualizací vytvoří zálohu databáze.
#
#   z repozitáře:   sudo ./infra/scripts/update.sh            (git pull z GitLabu / GitHubu + sestavení obrazů)
#   z balíčku:      sudo ./infra/scripts/update.sh /cesta/contix-0.22.0.tar.gz
#   bez zálohy:     přidejte --no-backup (nedoporučeno)
source "$(dirname "$0")/lib.sh"

BUNDLE="" BACKUP=1
for a in "$@"; do
  case "$a" in
    --no-backup) BACKUP=0 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) BUNDLE="$a" ;;
  esac
done
need_docker
[ -f .env ] || die "Chybí .env – nejdřív spusťte install.sh."
api_version() { dc exec -T api bun -e "fetch('http://localhost:3000/api/health').then(r=>r.json()).then(j=>console.log(j.version))" 2>/dev/null || true; }
before="$(api_version)"

if [ "$BACKUP" = 1 ]; then
  info "Záloha databáze před aktualizací…"
  dc run --rm backup backup.sh || die "Záloha selhala – aktualizace přerušena (použijte --no-backup jen pokud víte, co děláte)."
  ok "Záloha hotová."
fi

mkdir -p fonts # vlastní písma pro převodní službu (v0.24)
if [ -n "$BUNDLE" ]; then
  [ -f "$BUNDLE" ] || die "Balíček $BUNDLE neexistuje."
  tmp="$(mktemp -d)"
  tar xzf "$BUNDLE" -C "$tmp"
  src="$(find "$tmp" -maxdepth 1 -mindepth 1 -type d | head -1)"
  [ -f "$src/VERSION" ] || die "Neplatný balíček (chybí VERSION)."
  info "Aktualizace na verzi $(cat "$src/VERSION")…"
  # konfigurace (.env, certs, backups) zůstává; nahradí se jen soubory dodávky
  cp -r "$src"/docker-compose.yml "$src"/VERSION "$src"/infra "$src"/docs . 2>/dev/null || true
  (cd "$src" && gunzip -c images.tar.gz | docker load)
  env_set CONTIX_TAG "$(cat VERSION)"
  rm -rf "$tmp"
  dc up -d --no-build --remove-orphans
else
  [ -d .git ] || die "Není to git repozitář – zadejte cestu k balíčku s novou verzí."
  info "Stahuji změny z repozitáře…"
  if [ -n "${SUDO_USER:-}" ]; then sudo -u "$SUDO_USER" git pull --ff-only; else git pull --ff-only; fi
  dc up -d --build --remove-orphans
fi
wait_healthy
docker image prune -f >/dev/null 2>&1 || true
ok "Aktualizováno: ${before:-?} → $(api_version)."
echo "   Migrace databáze proběhly při startu API."
info "Kontrola po aktualizaci (infra/scripts/verify.sh)…"
"$(dirname "$0")/verify.sh" --no-ai || warn "Kontrola našla chyby – viz výpis výše a Administrace → Provoz."
