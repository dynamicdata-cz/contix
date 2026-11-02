import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sqlClient } from "./client";

await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
console.log("✔ migrace aplikovány");
await sqlClient.end();
