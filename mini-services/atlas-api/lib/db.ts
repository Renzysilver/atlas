// ATLAS API — lib/db.ts
// Prisma client singleton. Reads DATABASE_URL from env.
// Sandbox uses SQLite; production swap to Postgres is automatic via env.

import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __atlasPrisma: PrismaClient | undefined;
}

export const db =
  globalThis.__atlasPrisma ??
  new PrismaClient({
    log:
      process.env.ATLAS_API_LOG_LEVEL === "debug"
        ? ["query", "info", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__atlasPrisma = db;
}
