/**
 * bun apps/api/src/scripts/publish-scan.ts <adresář> [soubor se zákazy]
 * Výchozí soubor se zákazy: $CONTIX_PUBLISH_DENY nebo ~/.config/contix/publish-deny.txt (mimo repozitář).
 * Návratový kód 1 = nalezeny problémy (export se nezveřejní). Výjimka na řádku: komentář „publish-scan: allow“.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseDenyList, scanTree } from "./publishScan";

const dir = process.argv[2];
if (!dir) {
  console.error("Použití: bun apps/api/src/scripts/publish-scan.ts <adresář> [soubor se zákazy]");
  process.exit(2);
}
const denyFile = process.argv[3] ?? process.env.CONTIX_PUBLISH_DENY ?? join(homedir(), ".config/contix/publish-deny.txt");
const deny = existsSync(denyFile) ? parseDenyList(readFileSync(denyFile, "utf8")) : [];
if (!deny.length) console.warn(`⚠ Bez lokálního seznamu zákazů (${denyFile}) – interní IP, servery a zákazníky nelze zkontrolovat.`);

const { files, hits } = scanTree(dir, deny);
if (hits.length) {
  for (const h of hits) console.error(`✖ ${h.file}${h.line ? `:${h.line}` : ""}  [${h.rule}]  ${h.excerpt}`);
  console.error(`\nNalezeno ${hits.length} problémů v ${files} souborech – export se nezveřejní.`);
  process.exit(1);
}
console.log(`✔ Kontrola v pořádku: ${files} souborů, ${deny.length} lokálních zákazů.`);
