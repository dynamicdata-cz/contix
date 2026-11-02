#!/usr/bin/env bash
# CONTIX – zveřejnění vydání do veřejného repozitáře (GitHub) jako čistá historie (v1.15, ADR-112).
#
#   infra/scripts/publish.sh <klon veřejného repozitáře> [--ref v1.15.0] [--push]
#
# Hlavní vývoj zůstává v interním GitLabu. Do veřejného repozitáře se přenese jen obsah vydání
# (git archive – bez historie, bez souborů s export-ignore v .gitattributes) jako jeden commit s tagem v<verze>.
# Před zveřejněním proběhne kontrola tajemství a interních údajů; při nálezu se nic nezapíše.
# Interní údaje (IP adresy, názvy serverů a zákazníků) patří do ~/.config/contix/publish-deny.txt (mimo repozitář),
# jeden na řádek: doslovný text, `re:` regulární výraz, `rei:` bez rozlišení velikosti písmen.
# Autor commitu: PUBLISH_AUTHOR="Jméno <e-mail>" (jinak nastavení gitu ve veřejném klonu).
set -euo pipefail

info() { printf '\033[1;34m▶\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✖\033[0m %s\n' "$*" >&2; exit 1; }

TARGET="" REF="HEAD" PUSH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="${2:?--ref potřebuje hodnotu}"; shift ;;
    --push) PUSH=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) TARGET="$1" ;;
  esac
  shift
done
[ -n "$TARGET" ] || die "Zadejte cestu ke klonu veřejného repozitáře (git clone git@github.com:dynamicdata-cz/contix.git)."

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || die "Adresář $TARGET neexistuje."
[ -d "$TARGET/.git" ] || die "$TARGET není git repozitář."
[ "$TARGET" != "$ROOT" ] || die "Cílem nesmí být interní repozitář."
command -v bun >/dev/null || die "Chybí bun (kontrola exportu)."
command -v rsync >/dev/null || die "Chybí rsync."

cd "$ROOT"
git diff --quiet && git diff --cached --quiet || die "Interní repozitář má neuložené změny – nejdřív commit."
git rev-parse --verify --quiet "$REF^{commit}" >/dev/null || die "Neznámá revize $REF."
VERSION="$(git show "$REF:packages/shared/src/ops.ts" | sed -n 's/.*CONTIX_VERSION = "\([^"]*\)".*/\1/p' | head -1)"
[ -n "$VERSION" ] || die "Verzi se nepodařilo zjistit (packages/shared/src/ops.ts)."
TAG="v$VERSION"

if [ -n "$(git -C "$TARGET" status --porcelain)" ]; then die "Veřejný klon má neuložené změny."; fi
if git -C "$TARGET" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then die "Tag $TAG ve veřejném repozitáři už existuje."; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
info "Export $REF (verze $VERSION)…"
git archive --format=tar "$REF" | tar -x -C "$TMP"

info "Kontrola tajemství a interních údajů…"
bun "$ROOT/apps/api/src/scripts/publish-scan.ts" "$TMP" || die "Kontrola selhala – opravte nálezy v GitLabu a vydejte novou verzi."

info "Přenos do ${TARGET}…"
rsync -a --delete --exclude .git "$TMP"/ "$TARGET"/
cd "$TARGET"
git add -A
if git diff --cached --quiet; then ok "Žádné změny proti veřejnému repozitáři."; exit 0; fi

NOTES="$(awk -v v="$VERSION" 'index($0, "## " v) == 1 { p = 1; next } /^## / { if (p) exit } p' CHANGELOG.md 2>/dev/null || true)"
MSG="$(printf 'CONTIX %s\n\n%s\n' "$VERSION" "${NOTES:-Viz CHANGELOG.md.}")"
if [ -n "${PUBLISH_AUTHOR:-}" ]; then git commit -q --author="$PUBLISH_AUTHOR" -m "$MSG"; else git commit -q -m "$MSG"; fi
git tag -a "$TAG" -m "CONTIX $VERSION"
ok "Připraveno: commit a tag $TAG ve $TARGET ($(git diff --shortstat HEAD~1 2>/dev/null || echo 'první vydání'))."

if [ "$PUSH" = 1 ]; then
  git push -q origin HEAD --follow-tags
  ok "Odesláno (git push origin HEAD --follow-tags). Vydání na GitHubu vytvořte z tagu $TAG."
else
  echo "   Zkontrolujte (git -C \"$TARGET\" show --stat) a odešlete: git -C \"$TARGET\" push origin HEAD --follow-tags"
fi
