#!/usr/bin/env bash
# CONTIX – zveřejnění vydání do veřejného repozitáře (GitHub) jako čistá historie (v1.15, ADR-112, ADR-178).
#
#   infra/scripts/publish.sh <klon veřejného repozitáře> [--ref v1.83.0] [--source <repozitář>] [--require-deny] [--push]
#
# Hlavní vývoj zůstává v interním GitLabu. Do veřejného repozitáře se přenese jen obsah vydání
# (git archive – bez historie, bez souborů s export-ignore v .gitattributes) jako jeden commit s tagem v<verze>.
# Před zveřejněním proběhne kontrola tajemství a interních údajů; při nálezu se nic nezapíše.
# Interní údaje (IP adresy, názvy serverů a zákazníků) patří do ~/.config/contix/publish-deny.txt (mimo repozitář),
# jeden na řádek: doslovný text, `re:` regulární výraz, `rei:` bez rozlišení velikosti písmen; v CI $CONTIX_PUBLISH_DENY.
# Verze: z tagu `v<verze>` (--ref), jinak z packages/shared/src/ops.ts. --source = jiný interní repozitář (contix-agent),
# kontrola běží vždy skriptem CONTIXu. --require-deny = bez seznamu zákazů skončit (v CI povinné).
# Autor commitu: PUBLISH_AUTHOR="Jméno <e-mail>" (jinak nastavení gitu ve veřejném klonu).
set -euo pipefail

info() { printf '\033[1;34m▶\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✖\033[0m %s\n' "$*" >&2; exit 1; }

TARGET="" REF="HEAD" PUSH=0 SRC="" REQUIRE_DENY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="${2:?--ref potřebuje hodnotu}"; shift ;;
    --source) SRC="${2:?--source potřebuje hodnotu}"; shift ;;
    --require-deny) REQUIRE_DENY=1 ;;
    --push) PUSH=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) TARGET="$1" ;;
  esac
  shift
done
[ -n "$TARGET" ] || die "Zadejte cestu ke klonu veřejného repozitáře (git clone git@github.com:dynamicdata-cz/contix.git)."

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$(cd "${SRC:-$ROOT}" 2>/dev/null && pwd)" || die "Zdrojový repozitář ${SRC} neexistuje."
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || die "Adresář $TARGET neexistuje."
[ -d "$TARGET/.git" ] || die "$TARGET není git repozitář."
[ "$TARGET" != "$SRC" ] && [ "$TARGET" != "$ROOT" ] || die "Cílem nesmí být interní repozitář."
command -v bun >/dev/null || die "Chybí bun (kontrola exportu)."
command -v rsync >/dev/null || die "Chybí rsync."

DENY="${CONTIX_PUBLISH_DENY:-$HOME/.config/contix/publish-deny.txt}"
if [ "$REQUIRE_DENY" = 1 ] && ! grep -qv '^[[:space:]]*\(#\|$\)' "$DENY" 2>/dev/null; then
  die "Chybí nebo je prázdný seznam zákazů ($DENY) – bez něj nelze zkontrolovat interní údaje."
fi

cd "$SRC"
git diff --quiet && git diff --cached --quiet || die "Interní repozitář má neuložené změny – nejdřív commit."
git rev-parse --verify --quiet "$REF^{commit}" >/dev/null || die "Neznámá revize $REF."
VERSION=""
case "$REF" in
  v[0-9]*) git rev-parse -q --verify "refs/tags/$REF" >/dev/null && VERSION="${REF#v}" ;;
esac
if [ -z "$VERSION" ] && git cat-file -e "$REF:packages/shared/src/ops.ts" 2>/dev/null; then
  VERSION="$(git show "$REF:packages/shared/src/ops.ts" | sed -n 's/.*CONTIX_VERSION = "\([^"]*\)".*/\1/p' | head -1)"
fi
[ -n "$VERSION" ] || die "Verzi se nepodařilo zjistit – zadejte tag vydání (--ref v<verze>)."
if git cat-file -e "$REF:packages/shared/src/ops.ts" 2>/dev/null; then
  CODE_VERSION="$(git show "$REF:packages/shared/src/ops.ts" | sed -n 's/.*CONTIX_VERSION = "\([^"]*\)".*/\1/p' | head -1)"
  [ "$CODE_VERSION" = "$VERSION" ] || die "Tag v$VERSION neodpovídá verzi $CODE_VERSION v ops.ts."  # tag a kód se musí shodovat
fi
TAG="v$VERSION"

if [ -n "$(git -C "$TARGET" status --porcelain)" ]; then die "Veřejný klon má neuložené změny."; fi
if git -C "$TARGET" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then die "Tag $TAG ve veřejném repozitáři už existuje."; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
info "Export $REF z $(basename "$SRC") (verze $VERSION)…"
git archive --format=tar "$REF" | tar -x -C "$TMP"

info "Kontrola tajemství a interních údajů…"
bun "$ROOT/apps/api/src/scripts/publish-scan.ts" "$TMP" "$DENY" || die "Kontrola selhala – opravte nálezy v GitLabu a vydejte novou verzi."

info "Přenos do ${TARGET}…"
rsync -a --delete --exclude .git "$TMP"/ "$TARGET"/
cd "$TARGET"
git add -A
if git diff --cached --quiet; then ok "Žádné změny proti veřejnému repozitáři."; exit 0; fi

NAME="$(basename "$SRC")"; [ "$SRC" = "$ROOT" ] && NAME="CONTIX"
NOTES="$(awk -v v="$VERSION" 'index($0, "## " v) == 1 { p = 1; next } /^## / { if (p) exit } p' CHANGELOG.md 2>/dev/null || true)"
MSG="$(printf '%s %s\n\n%s\n' "$NAME" "$VERSION" "${NOTES:-Viz CHANGELOG.md.}")"
if [ -n "${PUBLISH_AUTHOR:-}" ]; then git commit -q --author="$PUBLISH_AUTHOR" -m "$MSG"; else git commit -q -m "$MSG"; fi
git tag -a "$TAG" -m "$NAME $VERSION"
ok "Připraveno: commit a tag $TAG ve $TARGET ($(git diff --shortstat HEAD~1 2>/dev/null || echo 'první vydání'))."

if [ "$PUSH" = 1 ]; then
  git push -q origin HEAD --follow-tags
  ok "Odesláno (git push origin HEAD --follow-tags). Vydání na GitHubu vytvořte z tagu $TAG."
else
  echo "   Zkontrolujte (git -C \"$TARGET\" show --stat) a odešlete: git -C \"$TARGET\" push origin HEAD --follow-tags"
fi
