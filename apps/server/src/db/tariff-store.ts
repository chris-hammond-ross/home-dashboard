import type Database from "better-sqlite3";
import { TariffSchema, type Tariff } from "@home-dashboard/shared";
import { ConflictError, NotFoundError } from "./screen-store.js";

/** Ids that would collide with static /api/tariffs/* route segments. */
const RESERVED_IDS = new Set(["retailers", "plans", "active"]);

interface TariffRow {
  id: string;
  name: string;
  is_active: number;
  position: number;
  config: string;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export interface StoredTariff extends Tariff {
  active: boolean;
}

/**
 * SQLite-backed tariff persistence, mirroring ScreenStore: pure storage, with
 * TariffService layering broadcasting on top. Invariant maintained by every
 * mutation: exactly one active tariff whenever at least one exists (zero is
 * legal — the dashboard simply shows kWh without cost).
 *
 * Multiple tariffs exist so you can keep last year's plan alongside this one
 * and switch when you re-contract. Costing always uses the active tariff.
 */
export class TariffStore {
  constructor(private db: Database.Database) {}

  list(): StoredTariff[] {
    const rows = this.db.prepare("SELECT * FROM tariffs ORDER BY position").all() as TariffRow[];
    return rows.map((row) => this.toTariff(row));
  }

  get(id: string): StoredTariff | undefined {
    const row = this.db.prepare("SELECT * FROM tariffs WHERE id = ?").get(id) as
      TariffRow | undefined;
    return row ? this.toTariff(row) : undefined;
  }

  active(): StoredTariff | null {
    const row = this.db.prepare("SELECT * FROM tariffs WHERE is_active = 1").get() as
      TariffRow | undefined;
    return row ? this.toTariff(row) : null;
  }

  /** Timestamp of the newest write — the cache key for priced history. */
  revision(): string {
    const row = this.db.prepare("SELECT MAX(updated_at) AS ts FROM tariffs").get() as {
      ts: string | null;
    };
    return row.ts ?? "none";
  }

  create(input: Tariff, active?: boolean): StoredTariff {
    const tariff = TariffSchema.parse(input);
    if (RESERVED_IDS.has(tariff.id)) {
      throw new ConflictError(`tariff id "${tariff.id}" is reserved`);
    }
    this.db.transaction(() => {
      if (this.exists(tariff.id)) {
        throw new ConflictError(`tariff "${tariff.id}" already exists`);
      }
      const first = this.count() === 0;
      this.db
        .prepare(
          `INSERT INTO tariffs (id, name, is_active, position, config)
           VALUES (?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM tariffs), ?)`,
        )
        .run(tariff.id, tariff.name, active || first ? 1 : 0, JSON.stringify(tariff));
      this.ensureSingleActive(active || first ? tariff.id : undefined);
    })();
    return this.get(tariff.id)!;
  }

  update(id: string, input: Omit<Tariff, "id">): StoredTariff {
    const tariff = TariffSchema.parse({ ...input, id });
    this.db.transaction(() => {
      if (!this.exists(id)) throw new NotFoundError(`tariff "${id}" not found`);
      this.db
        .prepare(`UPDATE tariffs SET name = ?, config = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(tariff.name, JSON.stringify(tariff), id);
      this.ensureSingleActive();
    })();
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.transaction(() => {
      if (!this.exists(id)) throw new NotFoundError(`tariff "${id}" not found`);
      this.db.prepare("DELETE FROM tariffs WHERE id = ?").run(id);
      this.ensureSingleActive();
    })();
  }

  setActive(id: string): void {
    this.db.transaction(() => {
      if (!this.exists(id)) throw new NotFoundError(`tariff "${id}" not found`);
      this.ensureSingleActive(id);
    })();
  }

  /** base, base-2, base-3, … — first id not taken and not reserved. */
  uniquifyId(base: string): string {
    const stem = base || "tariff";
    let candidate = stem;
    for (let n = 2; RESERVED_IDS.has(candidate) || this.exists(candidate); n++) {
      candidate = `${stem}-${n}`;
    }
    return candidate;
  }

  private count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM tariffs").get() as { n: number };
    return row.n;
  }

  private exists(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM tariffs WHERE id = ?").get(id) !== undefined;
  }

  /**
   * preferId set → make it the sole active tariff. Otherwise, if none is
   * active but tariffs exist, promote the first by position.
   */
  private ensureSingleActive(preferId?: string): void {
    if (preferId !== undefined) {
      this.db.prepare("UPDATE tariffs SET is_active = 0 WHERE id <> ?").run(preferId);
      this.db.prepare("UPDATE tariffs SET is_active = 1 WHERE id = ?").run(preferId);
      return;
    }
    const actives = (
      this.db.prepare("SELECT COUNT(*) AS n FROM tariffs WHERE is_active = 1").get() as {
        n: number;
      }
    ).n;
    if (actives === 1) return;
    if (actives > 1) {
      const first = this.db
        .prepare("SELECT id FROM tariffs WHERE is_active = 1 ORDER BY position LIMIT 1")
        .get() as { id: string };
      this.ensureSingleActive(first.id);
      return;
    }
    const first = this.db.prepare("SELECT id FROM tariffs ORDER BY position LIMIT 1").get() as
      { id: string } | undefined;
    if (first) this.db.prepare("UPDATE tariffs SET is_active = 1 WHERE id = ?").run(first.id);
  }

  private toTariff(row: TariffRow): StoredTariff {
    let config: unknown;
    try {
      config = JSON.parse(row.config);
    } catch {
      throw new Error(`tariff "${row.id}" has corrupt config JSON in the database`);
    }
    // Columns are the source of truth for id/name; the blob holds the rates.
    return {
      ...TariffSchema.parse({ ...(config as object), id: row.id, name: row.name }),
      active: row.is_active === 1,
    };
  }
}
