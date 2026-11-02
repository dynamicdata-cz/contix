import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

export const sqlClient = postgres(config.DATABASE_URL, { max: 10, onnotice: () => {} });
export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
