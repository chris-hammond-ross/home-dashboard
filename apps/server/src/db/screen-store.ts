import type Database from "better-sqlite3";
import { ScreenSchema, type ScreenConfig } from "@home-dashboard/shared";

/** Ids that would collide with static /api/screens/* route segments. */
const RESERVED_IDS = new Set(["generated", "reorder", "default"]);

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class InvalidReorderError extends Error {}

interface ScreenRow {
  id: string;
  name: string;
  columns: number;
  is_default: number;
  generated: number;
  position: number;
  widgets: string;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/**
 * SQLite-backed screen persistence. Pure storage: no hub, no plugins — the
 * ScreenService layers broadcasting on top. Invariant maintained by every
 * mutation: exactly one default screen whenever at least one screen exists
 * (zero screens is legal — the kiosk renders an empty state).
 */
export class ScreenStore {
  constructor(private db: Database.Database) {}

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM screens").get() as { n: number };
    return row.n;
  }

  list(): ScreenConfig[] {
    const rows = this.db.prepare("SELECT * FROM screens ORDER BY position").all() as ScreenRow[];
    return rows.map((row) => this.toScreen(row));
  }

  get(id: string): ScreenConfig | undefined {
    const row = this.db.prepare("SELECT * FROM screens WHERE id = ?").get(id) as
      ScreenRow | undefined;
    return row ? this.toScreen(row) : undefined;
  }

  create(input: ScreenConfig): ScreenConfig {
    const screen = ScreenSchema.parse(input);
    if (RESERVED_IDS.has(screen.id)) {
      throw new ConflictError(`screen id "${screen.id}" is reserved`);
    }
    this.db.transaction(() => {
      if (this.exists(screen.id)) {
        throw new ConflictError(`screen "${screen.id}" already exists`);
      }
      this.db
        .prepare(
          `INSERT INTO screens (id, name, columns, is_default, generated, position, widgets)
           VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM screens), ?)`,
        )
        .run(
          screen.id,
          screen.name,
          screen.columns,
          screen.default ? 1 : 0,
          screen.generated ? 1 : 0,
          JSON.stringify(screen.widgets),
        );
      this.ensureSingleDefault(screen.default ? screen.id : undefined);
    })();
    return this.get(screen.id)!;
  }

  /** Full replace. Always stores generated=false: any edit adopts the screen. */
  update(id: string, input: Omit<ScreenConfig, "id">): ScreenConfig {
    const screen = ScreenSchema.parse({ ...input, id });
    this.db.transaction(() => {
      if (!this.exists(id)) throw new NotFoundError(`screen "${id}" not found`);
      this.db
        .prepare(
          `UPDATE screens
           SET name = ?, columns = ?, is_default = ?, generated = 0, widgets = ?, updated_at = ${NOW}
           WHERE id = ?`,
        )
        .run(
          screen.name,
          screen.columns,
          screen.default ? 1 : 0,
          JSON.stringify(screen.widgets),
          id,
        );
      this.ensureSingleDefault(screen.default ? id : undefined);
    })();
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.transaction(() => {
      if (!this.exists(id)) throw new NotFoundError(`screen "${id}" not found`);
      this.db.prepare("DELETE FROM screens WHERE id = ?").run(id);
      this.ensureSingleDefault();
    })();
  }

  /** ids must be an exact permutation of every stored screen id. */
  reorder(ids: string[]): void {
    this.db.transaction(() => {
      const existing = (this.db.prepare("SELECT id FROM screens").all() as { id: string }[]).map(
        (r) => r.id,
      );
      const wanted = new Set(ids);
      if (
        ids.length !== existing.length ||
        wanted.size !== ids.length ||
        !existing.every((id) => wanted.has(id))
      ) {
        throw new InvalidReorderError(
          `reorder must list every screen id exactly once (have: ${existing.sort().join(", ")})`,
        );
      }
      const setPosition = this.db.prepare("UPDATE screens SET position = ? WHERE id = ?");
      ids.forEach((id, index) => setPosition.run(index, id));
    })();
  }

  setDefault(id: string): void {
    this.db.transaction(() => {
      if (!this.exists(id)) throw new NotFoundError(`screen "${id}" not found`);
      this.ensureSingleDefault(id);
    })();
  }

  /**
   * Onboarding bulk write: drop every generated screen, append the incoming
   * set (forced generated) after the user screens. Incoming ids that collide
   * with a surviving user screen are skipped — the user's screen wins.
   */
  replaceGenerated(screens: ScreenConfig[]): {
    added: string[];
    replacedCount: number;
    skipped: string[];
  } {
    const incoming = screens.map((s) => ScreenSchema.parse({ ...s, generated: true }));
    const added: string[] = [];
    const skipped: string[] = [];
    let replacedCount = 0;
    this.db.transaction(() => {
      const oldDefault = (
        this.db.prepare("SELECT id FROM screens WHERE is_default = 1").get() as
          { id: string } | undefined
      )?.id;
      replacedCount = (
        this.db.prepare("SELECT COUNT(*) AS n FROM screens WHERE generated = 1").get() as {
          n: number;
        }
      ).n;
      this.db.prepare("DELETE FROM screens WHERE generated = 1").run();

      const survivors = (
        this.db.prepare("SELECT id FROM screens ORDER BY position").all() as { id: string }[]
      ).map((r) => r.id);
      const setPosition = this.db.prepare("UPDATE screens SET position = ? WHERE id = ?");
      survivors.forEach((id, index) => setPosition.run(index, id));

      const userIds = new Set(survivors);
      let position = survivors.length;
      const insert = this.db.prepare(
        `INSERT INTO screens (id, name, columns, is_default, generated, position, widgets)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      );
      for (const screen of incoming) {
        if (userIds.has(screen.id) || RESERVED_IDS.has(screen.id)) {
          skipped.push(screen.id);
          continue;
        }
        insert.run(
          screen.id,
          screen.name,
          screen.columns,
          screen.id === oldDefault ? 1 : 0,
          position++,
          JSON.stringify(screen.widgets),
        );
        added.push(screen.id);
      }
      this.ensureSingleDefault();
    })();
    return { added, replacedCount, skipped };
  }

  /**
   * First-boot seed from the YAML config. Runs only when the table is empty
   * AND the import has never happened — deleting every screen in the UI must
   * not resurrect the YAML seeds on restart. Deleting the DB file re-seeds.
   * Returns the number of screens imported (-1 when the import was skipped).
   */
  importFromConfig(screens: ScreenConfig[]): number {
    if (this.count() > 0 || this.metaGet("screens_imported") !== undefined) return -1;
    let imported = 0;
    this.db.transaction(() => {
      const insert = this.db.prepare(
        `INSERT INTO screens (id, name, columns, is_default, generated, position, widgets)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      screens.forEach((raw, index) => {
        const screen = ScreenSchema.parse(raw);
        if (RESERVED_IDS.has(screen.id)) return;
        insert.run(
          screen.id,
          screen.name,
          screen.columns,
          screen.default ? 1 : 0,
          screen.generated ? 1 : 0,
          index,
          JSON.stringify(screen.widgets),
        );
        imported++;
      });
      this.ensureSingleDefault();
      this.metaSet("screens_imported", new Date().toISOString());
    })();
    return imported;
  }

  /** base, base-2, base-3, … — first id not taken and not reserved. */
  uniquifyId(base: string): string {
    const stem = base || "screen";
    let candidate = stem;
    for (let n = 2; RESERVED_IDS.has(candidate) || this.exists(candidate); n++) {
      candidate = `${stem}-${n}`;
    }
    return candidate;
  }

  private exists(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM screens WHERE id = ?").get(id) !== undefined;
  }

  /**
   * preferId set → make it the sole default. Otherwise, if no default exists
   * but screens do, promote the first by position.
   */
  private ensureSingleDefault(preferId?: string): void {
    if (preferId !== undefined) {
      this.db.prepare("UPDATE screens SET is_default = 0 WHERE id <> ?").run(preferId);
      this.db.prepare("UPDATE screens SET is_default = 1 WHERE id = ?").run(preferId);
      return;
    }
    const defaults = (
      this.db.prepare("SELECT COUNT(*) AS n FROM screens WHERE is_default = 1").get() as {
        n: number;
      }
    ).n;
    if (defaults === 1) return;
    if (defaults > 1) {
      const first = this.db
        .prepare("SELECT id FROM screens WHERE is_default = 1 ORDER BY position LIMIT 1")
        .get() as { id: string };
      this.ensureSingleDefault(first.id);
      return;
    }
    const first = this.db.prepare("SELECT id FROM screens ORDER BY position LIMIT 1").get() as
      { id: string } | undefined;
    if (first) this.db.prepare("UPDATE screens SET is_default = 1 WHERE id = ?").run(first.id);
  }

  private metaGet(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  private metaSet(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  private toScreen(row: ScreenRow): ScreenConfig {
    let widgets: unknown;
    try {
      widgets = JSON.parse(row.widgets);
    } catch {
      throw new Error(`screen "${row.id}" has corrupt widgets JSON in the database`);
    }
    return ScreenSchema.parse({
      id: row.id,
      name: row.name,
      columns: row.columns,
      default: row.is_default === 1,
      generated: row.generated === 1,
      widgets,
    });
  }
}
