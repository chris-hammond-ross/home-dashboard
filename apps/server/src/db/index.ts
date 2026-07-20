import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

/** Relative storage paths resolve against the config file's directory (cwd varies). */
export function resolveDbPath(configPath: string, storagePath: string): string {
  return isAbsolute(storagePath) ? storagePath : resolve(dirname(configPath), storagePath);
}

export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    runMigrations(db);
  } catch (err) {
    db.close();
    const code = (err as { code?: string }).code;
    if (code === "SQLITE_NOTADB" || code === "SQLITE_CORRUPT") {
      throw new Error(
        `Database at ${dbPath} is corrupt or not SQLite. Delete it to start fresh ` +
          `(screens will re-import from the YAML seed) or restore a backup.`,
      );
    }
    throw err;
  }
  return db;
}
