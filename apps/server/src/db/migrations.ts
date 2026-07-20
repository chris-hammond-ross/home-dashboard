import type Database from "better-sqlite3";

/**
 * Hand-rolled migration runner on PRAGMA user_version. Append-only: new
 * features (alerts, settings KV, …) add entries with the next id; each
 * migration runs in its own transaction and bumps user_version.
 */
interface Migration {
  id: number;
  name: string;
  up(db: Database.Database): void;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: "screens",
    up(db) {
      db.exec(`
        CREATE TABLE screens (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          columns    INTEGER NOT NULL DEFAULT 4,
          is_default INTEGER NOT NULL DEFAULT 0,
          generated  INTEGER NOT NULL DEFAULT 0,
          position   INTEGER NOT NULL,
          widgets    TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        CREATE TABLE meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  const pending = migrations.filter((m) => m.id > current).sort((a, b) => a.id - b.id);
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.id}`);
    })();
  }
}
