/**
 * Vyprázdní databázi pro end-to-end testy (e2e/). Z bezpečnostních důvodů jen pro DB, jejíž název končí na "_e2e".
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
const name = new URL(url).pathname.slice(1);
if (!name.endsWith("_e2e")) {
  console.error(`Odmítnuto: databáze „${name}“ nekončí na _e2e.`);
  process.exit(1);
}
const admin = postgres(url.replace(/\/[^/]+$/, "/postgres"), { max: 1, onnotice: () => {} });
await admin.unsafe(`drop database if exists "${name}" with (force)`);
await admin.unsafe(`create database "${name}"`);
await admin.end();
console.log(`✔ databáze ${name} připravena`);
