import type { Config } from "./config";
import { appSecret } from "./config";
import type { Db } from "./db/client";
import { inArray } from "drizzle-orm";
import { createAdmin, ensureSystemRoles, userCount } from "./auth/service";
import { discoveryRuns } from "./db/schema";
import { seedRiskCatalog } from "./modules/risks/routes";

/** Při startu: systémové role + první administrátor (pokud v DB nikdo není). */
export async function bootstrap(db: Db, config: Config) {
  appSecret(config); // v produkci selže bez APP_SECRET
  await ensureSystemRoles(db);
  await seedRiskCatalog(db);
  // běhy discovery přerušené restartem serveru
  await db
    .update(discoveryRuns)
    .set({ status: "failed", error: "Přerušeno restartem serveru", finishedAt: new Date() })
    .where(inArray(discoveryRuns.status, ["running", "queued"]));
  if ((await userCount(db)) > 0) return;

  if (config.ADMIN_EMAIL) {
    const r = await createAdmin(db, config.ADMIN_EMAIL, "Administrátor", config.ADMIN_PASSWORD);
    if (r?.generatedPassword)
      console.log(
        `\n  ▶ Vytvořen administrátor ${config.ADMIN_EMAIL}\n    Dočasné heslo: ${r.generatedPassword}\n    (po prvním přihlášení bude vyžadována změna)\n`,
      );
    else if (r) console.log(`  ▶ Vytvořen administrátor ${config.ADMIN_EMAIL}`);
  } else {
    console.log("\n  ⚠ V databázi není žádný uživatel. Vytvořte administrátora:\n    bun run admin:create admin@firma.cz \"Jméno Příjmení\"\n");
  }
}
