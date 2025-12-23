import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Use postgres.js (better ESM bundling support than node-postgres)
const client = postgres(process.env.DATABASE_URL || "");
export const db = drizzle(client, { schema });
