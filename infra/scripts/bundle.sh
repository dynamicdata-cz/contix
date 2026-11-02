#!/usr/bin/env bash
# CONTIX – balíček pro instalaci u zákazníka bez přístupu do GitLabu / internetu.
# Spouštějte na stroji s Dockerem a internetem (ideálně Linux amd64, např. testovací server).
#
#   ./infra/scripts/bundle.sh [--platform linux/amd64] [--out ./dist]
#
# Výsledek: dist/contix-<verze>.tar.gz (+ .sha256) s obrazy, docker-compose.yml, skripty a návodem.
source "$(dirname "$0")/lib.sh"

PLATFORM="linux/amd64" OUT="$ROOT/dist"
while [ $# -gt 0 ]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) die "Neznámý parametr $1" ;;
  esac
done
need_docker
VERSION="$(grep -o 'CONTIX_VERSION = "[^"]*"' packages/shared/src/ops.ts | cut -d'"' -f2)"
[ -n "$VERSION" ] || die "Nepodařilo se zjistit verzi."
[ -z "$(git status --porcelain 2>/dev/null)" ] || warn "Pracovní kopie obsahuje necommitnuté změny – balíček je obsahuje také."

export DOCKER_DEFAULT_PLATFORM="$PLATFORM" CONTIX_TAG="$VERSION"
info "Sestavuji obrazy $VERSION pro ${PLATFORM}…"
dc build --pull
docker pull --platform "$PLATFORM" pgvector/pgvector:pg17 >/dev/null

name="contix-$VERSION"
stage="$(mktemp -d)/$name"
mkdir -p "$stage/infra/scripts" "$stage/infra/proxy" "$stage/docs/04_operations" "$OUT"
# balíček obsahuje hotové obrazy – sekce build se odstraní
sed '/^    build: /d' docker-compose.yml >"$stage/docker-compose.yml"
cp infra/server.env.example "$stage/infra/"
cp infra/scripts/lib.sh infra/scripts/install.sh infra/scripts/update.sh infra/scripts/verify.sh "$stage/infra/scripts/"
cp docs/04_operations/*.md "$stage/docs/04_operations/"
echo "$VERSION" >"$stage/VERSION"
info "Ukládám obrazy (několik set MB)…"
docker save "contix-api:$VERSION" "contix-web:$VERSION" "contix-backup:$VERSION" "contix-converter:$VERSION" pgvector/pgvector:pg17 | gzip -1 >"$stage/images.tar.gz"
tar czf "$OUT/$name.tar.gz" -C "$(dirname "$stage")" "$name"
(cd "$OUT" && sha256sum "$name.tar.gz" >"$name.tar.gz.sha256")
rm -rf "$(dirname "$stage")"
ok "Balíček: $OUT/$name.tar.gz ($(du -h "$OUT/$name.tar.gz" | cut -f1))"
echo "   U zákazníka: tar xzf $name.tar.gz && cd $name && sudo ./infra/scripts/install.sh --domain contix.zakaznik.cz"
