#!/usr/bin/env bash
# CONTIX – první instalace na server (Docker Compose).
#
#   sudo ./infra/scripts/install.sh --domain contix.firma.cz [--tls internal|auto|files] [--admin admin@firma.cz]
#                                  [--http-port 80] [--https-port 443]
#
# Funguje ve stažené kopii repozitáře (obrazy se sestaví) i v rozbaleném balíčku pro zákazníka
# (obsahuje images.tar.gz – obrazy se jen načtou, server nepotřebuje internet ani přístup do GitLabu).
source "$(dirname "$0")/lib.sh"

DOMAIN="" TLS="internal" ADMIN="" HTTP=80 HTTPS=443
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --tls) TLS="$2"; shift 2 ;;
    --admin) ADMIN="$2"; shift 2 ;;
    --http-port) HTTP="$2"; shift 2 ;;
    --https-port) HTTPS="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "Neznámý parametr $1 (viz --help)" ;;
  esac
done
case "$TLS" in auto|internal|files) ;; *) die "--tls musí být auto, internal nebo files" ;; esac

need_docker

if [ -f .env ]; then
  warn ".env už existuje – ponechávám ho (parametry --domain/--tls/--admin se ignorují). Pro aktualizaci použijte update.sh."
else
  [ -n "$DOMAIN" ] || die "Zadejte --domain (adresa, pod kterou budou uživatelé CONTIX otevírat)."
  [ -f infra/server.env.example ] || die "Chybí infra/server.env.example."
  cp infra/server.env.example .env
  chmod 600 .env
  url="https://$DOMAIN"; [ "$HTTPS" = 443 ] || url="$url:$HTTPS"
  env_set CONTIX_DOMAIN "$DOMAIN"
  env_set CONTIX_TLS_MODE "$TLS"
  env_set HTTP_PORT "$HTTP"
  env_set HTTPS_PORT "$HTTPS"
  env_set APP_URL "$url"
  env_set APP_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
  env_set POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  env_set METRICS_TOKEN "$(openssl rand -hex 24)"
  [ -n "$ADMIN" ] && env_set ADMIN_EMAIL "$ADMIN"
  [ -f VERSION ] && env_set CONTIX_TAG "$(cat VERSION)"
  ok "Vytvořen .env (tajemství vygenerována, práva 600)."
fi

TLS="$(env_get CONTIX_TLS_MODE)"; DOMAIN="$(env_get CONTIX_DOMAIN)"; HTTPS="$(env_get HTTPS_PORT)"
if [ "$TLS" = files ] && { [ ! -f certs/cert.pem ] || [ ! -f certs/key.pem ]; }; then
  die "Režim files: nahrajte certifikát do certs/cert.pem (vč. mezilehlých) a klíč do certs/key.pem."
fi
BK="$(env_get BACKUP_HOST_DIR)"; mkdir -p certs fonts "${BK:-./backups}"

if bundle_mode; then
  load_images
  info "Spouštím CONTIX $(cat VERSION 2>/dev/null)…"
  dc up -d --no-build
else
  info "Sestavuji obrazy a spouštím CONTIX (první sestavení trvá několik minut)…"
  dc up -d --build
fi
wait_healthy
ok "API běží."

if [ "$TLS" = internal ]; then
  info "Čekám na vystavení certifikátu interní CA…"
  for _ in $(seq 1 30); do
    dc cp web:/data/caddy/pki/authorities/local/root.crt ./contix-root-ca.crt >/dev/null 2>&1 && break
    sleep 2
  done
  if [ -f contix-root-ca.crt ]; then
    chmod 644 contix-root-ca.crt # veřejný certifikát – musí jít stáhnout přes scp běžným uživatelem
    ok "Kořenový certifikát CA: $ROOT/contix-root-ca.crt – nainstalujte ho do počítačů uživatelů (docs/04_operations/install.md)."
  else
    warn "Kořenový certifikát se nepodařilo zkopírovat – zkuste později: docker compose cp web:/data/caddy/pki/authorities/local/root.crt ."
  fi
fi

echo
pw="$(dc logs api 2>/dev/null | grep -A1 'Vytvořen administrátor' | grep -o 'Dočasné heslo: .*' | tail -1 || true)"
ok "Hotovo. CONTIX: $(env_get APP_URL)"
[ -n "$pw" ] && echo "   Administrátor $(env_get ADMIN_EMAIL) – $pw (po přihlášení bude vyžadována změna)"
[ -z "$(env_get ADMIN_EMAIL)" ] && echo "   Administrátora vytvoříte: docker compose exec api bun src/scripts/create-admin.ts admin@firma.cz \"Jméno\""
echo "   Bez DNS přidejte na klientech do hosts: $(hostname -I 2>/dev/null | awk '{print $1}') $DOMAIN"
echo "   Kontrola: Administrace → Provoz; zálohy: ls ${BK:-./backups}"
