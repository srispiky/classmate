import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";

export interface TestConnectionOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface TestConnectionResult {
  success: boolean;
  version?: string;
  error?: string;
}

export async function testConnection(opts: TestConnectionOptions): Promise<TestConnectionResult> {
  const testPool = new Pool({
    host: opts.host,
    port: opts.port,
    database: opts.database,
    user: opts.user,
    password: opts.password,
    connectionTimeoutMillis: 5000,
  });
  try {
    const client = await testPool.connect();
    let version = "";
    try {
      const r = await client.query("SELECT version()");
      version = (r.rows[0] as { version: string })?.version ?? "";
    } finally {
      client.release();
    }
    return { success: true, version };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await testPool.end();
  }
}
