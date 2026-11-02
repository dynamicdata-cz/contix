/**
 * Ukázková data pro vyzkoušení CONTIXu (v1.15, ADR-112).
 *   bun run demo:seed                         – použije prvního aktivního administrátora
 *   DEMO_ADMIN_EMAIL=admin@firma.cz bun run demo:seed
 * Na serveru:  docker compose exec api bun src/scripts/demo-seed.ts
 * Data se zakládají přes API do samostatné společnosti „Vzorová strojírna a.s. (ukázka)“; opakované spuštění nic nepřidá.
 * Pro přihlášení skript založí krátkou relaci administrátora a po dokončení ji smaže (záznamy v auditu jsou na tohoto administrátora).
 */
import { COMPANY_HEADER } from "@contix/shared";
import { and, eq } from "drizzle-orm";
import { createApp } from "../app";
import { randomToken, sha256 } from "../auth/crypto";
import { ensureSystemRoles } from "../auth/service";
import { bootstrap } from "../bootstrap";
import { config } from "../config";
import { db, sqlClient } from "../db/client";
import { roles, sessions, userRoles, users } from "../db/schema";
import { DEMO_COMPANY_NAME, seedDemo, type DemoCall } from "./demoData";

await bootstrap(db, config);
await ensureSystemRoles(db);

const wanted = process.env.DEMO_ADMIN_EMAIL?.trim().toLowerCase();
const admins = await db
  .select({ id: users.id, email: users.email })
  .from(users)
  .innerJoin(userRoles, eq(userRoles.userId, users.id))
  .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.key, "admin")))
  .where(eq(users.isActive, true));
const admin = wanted ? admins.find((a) => a.email.toLowerCase() === wanted) : admins[0];
if (!admin) {
  console.error(wanted ? `Administrátor ${wanted} nenalezen.` : "V databázi není aktivní administrátor – nejdřív: bun run admin:create <email> \"Jméno\"");
  process.exit(1);
}

const token = randomToken(32);
await db.insert(sessions).values({ id: sha256(token), userId: admin.id, mfaVerified: true, userAgent: "contix demo-seed", expiresAt: new Date(Date.now() + 15 * 60_000) });
const app = createApp({ db, config });
const origin = new URL(config.APP_URL).origin;
const caller =
  (companyId?: string): DemoCall =>
  async (method, path, body) => {
    const headers: Record<string, string> = { cookie: `contix_session=${token}`, origin };
    if (companyId) headers[COMPANY_HEADER] = companyId;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

try {
  const r = await seedDemo(caller(), (id) => caller(id), (m) => console.log(`  ${m}`));
  if (r.created) console.log(`✔ Ukázková data založena (${admin.email}). Přepněte se v aplikaci na společnost „${DEMO_COMPANY_NAME}“.`);
  else console.log(`Ukázková společnost „${DEMO_COMPANY_NAME}“ už existuje – nic se nezměnilo.`);
} catch (e) {
  console.error(`✖ ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  await sqlClient.end();
}
