import { createApp } from "./app";
import { bootstrap } from "./bootstrap";
import { config } from "./config";
import { db } from "./db/client";
import { startAgentCatchUp } from "./modules/agents/process";
import { ensureFrameworks } from "./modules/frameworks/routes";
import { startNotificationScheduler } from "./modules/notifications/service";

await bootstrap(db, config);
// vlastní rámce knihovny do registru i pro plánované úlohy a MCP (ADR-079)
await ensureFrameworks(db).catch((e) => console.warn("Knihovna rámců se nenačetla:", (e as Error).message));
const app = createApp({ db, config });
startNotificationScheduler(db, config);
// zprávy schválených agentů, které čekají na zpracování (ADR-177)
startAgentCatchUp(db);

console.log(`CONTIX API běží na http://localhost:${config.PORT}`);

export default {
  port: config.PORT,
  fetch: app.fetch,
  // Bun má výchozí strop 128 MB; skutečné limity hlídá API (app.ts, ADR-165)
  maxRequestBodySize: 170 * 1024 * 1024,
};
