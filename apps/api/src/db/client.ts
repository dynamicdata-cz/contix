import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

/**
 * Spojení s databází. JIT vypnutý (v1.72, ADR-165): přehledy jsou dotazy s desítkami poddotazů nad velkými tabulkami
 * a překlad JIT u nich trval déle než samotný dotaz (průvodce 1,8 s → 0,25 s při 20 000 aktivech).
 */
export const PG_CONNECTION = { jit: "off" } as const;
export const sqlClient = postgres(config.DATABASE_URL, { max: 10, onnotice: () => {}, connection: PG_CONNECTION });
export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
