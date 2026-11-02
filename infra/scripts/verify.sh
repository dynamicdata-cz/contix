#!/usr/bin/env bash
# CONTIX – kontrola po nasazení / aktualizaci (spouští se i na konci update.sh).
#
#   sudo ./infra/scripts/verify.sh           kontejnery, verze, migrace, Provoz, AI, Wazuh, zdroje KEV/EPSS
#   sudo ./infra/scripts/verify.sh --no-ai   bez testovacího dotazu na AI model
#
# Návratový kód 1 = aspoň jedna chyba. Tajemství se nevypisují.
source "$(dirname "$0")/lib.sh"
need_docker
[ -f .env ] || die "Chybí .env – nejdřív spusťte install.sh."

info "Kontejnery"
dc ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' || true
bad="$(dc ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null | awk '$2!="running" || ($3!="" && $3!="healthy") {print $1}' | grep -v '^backup$' || true)"
[ -z "$bad" ] && ok "Všechny služby běží." || warn "Problém se službami: $bad (dc logs <služba>)"

info "Místo na disku"
df -h . | tail -1 | awk '{ printf "   %s volných z %s (%s obsazeno)\n", $4, $2, $5 }'
used="$(df -P . | tail -1 | awk '{print $5}' | tr -d %)"
[ "${used:-0}" -lt 90 ] || warn "Disk je zaplněný z ${used} % – zálohy a databáze potřebují místo."

info "Aplikace (kontrola uvnitř kontejneru API)"
dc exec -T api bun src/scripts/verify.ts "$@"
