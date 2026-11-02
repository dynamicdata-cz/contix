/**
 * Vytvoří lokálního administrátora s dočasným heslem.
 *   bun run admin:create admin@firma.cz "Jan Novák"
 */
import { createAdmin } from "../auth/service";
import { db, sqlClient } from "../db/client";

const [email, name] = process.argv.slice(2);
if (!email) {
  console.error('Použití: bun run admin:create <email> ["Jméno Příjmení"]');
  process.exit(1);
}
const r = await createAdmin(db, email, name ?? "Administrátor");
if (!r) console.error(`Uživatel ${email} už existuje.`);
else console.log(`\n✔ Administrátor ${email} vytvořen.\n  Dočasné heslo: ${r.generatedPassword}\n  Po prvním přihlášení bude vyžadována změna hesla.\n`);
await sqlClient.end();
