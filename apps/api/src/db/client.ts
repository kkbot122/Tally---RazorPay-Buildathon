import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

export function createDatabase(databaseUrl: string) {
  const sql: Sql = postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 5,
  });
  const db = drizzle(sql);

  return {
    db,
    sql,
    async check() {
      await sql`select 1`;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

export type DatabaseClient = ReturnType<typeof createDatabase>["db"];
