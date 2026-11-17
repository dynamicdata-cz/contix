/** SBOM CONTIXu (CycloneDX 1.6) z bun.lock: `bun src/scripts/sbom.ts [výstup.json]` (v1.48, ADR-145). */
import { writeFileSync } from "node:fs";
import { findBunLock, sbomFromDisk } from "../lib/sbom";

const lock = findBunLock();
if (!lock) {
  console.error("bun.lock nenalezen");
  process.exit(1);
}
const json = JSON.stringify(sbomFromDisk(lock), null, 2);
const out = process.argv[2];
if (out) {
  writeFileSync(out, json);
  console.error(`SBOM zapsán do ${out}`);
} else console.log(json);
