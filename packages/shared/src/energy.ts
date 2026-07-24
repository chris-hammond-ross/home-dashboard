import { z } from "zod";

/**
 * Power/energy balance allocation, shared by the live widget and the history
 * service, plus the wire types for the history API.
 *
 * The same greedy priority answers two questions with one implementation:
 * "which source is feeding the house right now" (watts, in the browser) and
 * "which source fed the house during this hour" (kWh, on the server). The
 * numbers are unit-agnostic — feed it watts and you get watts back, feed it
 * kilowatt-hours and you get kilowatt-hours.
 */

export type FlowNode = "solar" | "grid" | "home" | "battery";
export type FlowKind = "solar" | "grid" | "export" | "battery" | "charge";

export interface FlowSegment {
  from: FlowNode;
  to: FlowNode;
  /** Magnitude, always positive, in whatever unit the inputs used. */
  amount: number;
  kind: FlowKind;
}

/** One balance point: all values ≥ 0, in a single consistent unit. */
export interface EnergyBalance {
  solar: number;
  gridImport: number;
  gridExport: number;
  batteryCharge: number;
  batteryDischarge: number;
  load: number;
}

/**
 * Greedy power-balance allocation → the six directed flows.
 *
 * Priority: solar serves the home, then charges the battery, then exports; any
 * remaining demand is met by battery discharge, then grid import; leftover grid
 * import can charge the battery (off-peak). Deterministic, so the live diagram
 * and the historical breakdown always tell the same story.
 *
 * `epsilon` drops noise-level flows — 1 W live, a much smaller number for kWh.
 */
export function allocateFlows(balance: EnergyBalance, epsilon = 0): FlowSegment[] {
  let solar = Math.max(0, balance.solar);
  let batteryDischarge = Math.max(0, balance.batteryDischarge);
  let gridImport = Math.max(0, balance.gridImport);
  let home = Math.max(0, balance.load);
  let batteryCharge = Math.max(0, balance.batteryCharge);
  let gridExport = Math.max(0, balance.gridExport);

  const flows: FlowSegment[] = [];
  const push = (from: FlowNode, to: FlowNode, amount: number, kind: FlowKind) => {
    if (amount > epsilon) flows.push({ from, to, amount, kind });
  };

  let x = Math.min(solar, home);
  push("solar", "home", x, "solar");
  solar -= x;
  home -= x;

  x = Math.min(solar, batteryCharge);
  push("solar", "battery", x, "charge");
  solar -= x;
  batteryCharge -= x;

  x = Math.min(solar, gridExport);
  push("solar", "grid", x, "export");
  solar -= x;
  gridExport -= x;

  x = Math.min(batteryDischarge, home);
  push("battery", "home", x, "battery");
  batteryDischarge -= x;
  home -= x;

  x = Math.min(gridImport, home);
  push("grid", "home", x, "grid");
  gridImport -= x;
  home -= x;

  x = Math.min(gridImport, batteryCharge);
  push("grid", "battery", x, "charge");
  gridImport -= x;
  batteryCharge -= x;

  return flows;
}

/** Home consumption split by feeding source — the donut, and the stacked chart. */
export function consumptionMix(
  balance: EnergyBalance,
  epsilon = 0,
): {
  solar: number;
  battery: number;
  grid: number;
} {
  const mix = { solar: 0, battery: 0, grid: 0 };
  for (const flow of allocateFlows(balance, epsilon)) {
    if (flow.to !== "home") continue;
    if (flow.from === "solar") mix.solar += flow.amount;
    else if (flow.from === "battery") mix.battery += flow.amount;
    else if (flow.from === "grid") mix.grid += flow.amount;
  }
  return mix;
}

// ---------------------------------------------------------------------------
// History API wire types (POST /api/energy/history)
// ---------------------------------------------------------------------------

export const ENERGY_ROLES = [
  "solar",
  "gridImport",
  "gridExport",
  "batteryCharge",
  "batteryDischarge",
  "home",
] as const;
export type EnergyRole = (typeof ENERGY_ROLES)[number];

/**
 * Where one role's history comes from. `kind: "energy"` is a kWh statistic
 * (exact); `kind: "power"` integrates the hourly mean of a watt sensor, which
 * is approximate but works with the entities the widget already binds.
 */
export const EnergySourceSchema = z.object({
  statisticId: z.string().min(1),
  kind: z.enum(["energy", "power"]),
  /** Flip the sign first, matching the widget's invertGrid/invertBattery props. */
  invert: z.boolean().default(false),
  /**
   * Which half of a signed meter this role takes. A single signed grid sensor
   * feeds `gridImport` with the default `"positive"` and `gridExport` with
   * `"negative"`; a one-way meter is already positive, so the default is right
   * for it too. `"magnitude"` is the rare opt-in for a sensor whose sign is
   * meaningless — it must never be the default, or a meter reset (a large
   * negative `change`) would be counted as consumption.
   */
  sign: z.enum(["positive", "negative", "magnitude"]).default("positive"),
});
export type EnergySource = z.infer<typeof EnergySourceSchema>;

export const ENERGY_BUCKETS = ["hour", "day", "month"] as const;
export type EnergyBucket = (typeof ENERGY_BUCKETS)[number];

export const EnergyHistoryRequestSchema = z.object({
  /** Integration id holding the history, e.g. "ha". */
  integration: z.string().default("ha"),
  /** Sparse by design — a household with no battery simply omits those roles. */
  roles: z.partialRecord(z.enum(ENERGY_ROLES), EnergySourceSchema),
  /** ISO instants; `end` is exclusive. */
  start: z.string(),
  end: z.string(),
  bucket: z.enum(ENERGY_BUCKETS),
  /** Also fetch the preceding equal-length range for a period-on-period delta. */
  comparePrevious: z.boolean().default(true),
});
export type EnergyHistoryRequest = z.infer<typeof EnergyHistoryRequestSchema>;

/** kWh per role for one bucket, plus the home mix and cost split. */
export interface EnergyBucketRow {
  /** ISO instant at the start of the bucket. */
  start: string;
  kwh: Record<EnergyRole, number>;
  /** Home consumption split by feeding source (kWh). */
  mix: { solar: number; battery: number; grid: number };
  /** Import cost by tariff band id (cents); empty when no tariff is active. */
  centsByBand: Record<string, number>;
  /** Feed-in credit for the bucket (cents, positive). */
  exportCents: number;
}

export interface EnergyTotals {
  kwh: Record<EnergyRole, number>;
  mix: { solar: number; battery: number; grid: number };
}

export interface EnergyHistoryResponse {
  buckets: EnergyBucketRow[];
  totals: EnergyTotals;
  /** Same shape for the preceding equal-length range, when requested. */
  previous: EnergyTotals | null;
  /** Cost over the whole range; null when no tariff is active. */
  cost: {
    /** Ordered as the tariff declares them; the UI ramps them by centsPerKwh. */
    byBand: {
      blockId: string;
      label: string;
      kind: string;
      centsPerKwh: number;
      kwh: number;
      cents: number;
    }[];
    importCents: number;
    exportCents: number;
    supplyCents: number;
    netCents: number;
    previousNetCents: number | null;
  } | null;
  /** True when any role fell back to integrating mean power. */
  estimated: boolean;
  /** Roles that produced no data at all — surfaced so the UI can explain a gap. */
  missing: EnergyRole[];
  tariff: { id: string; name: string; timezone: string } | null;
}

/** Empty per-role record — the accumulator seed everywhere buckets are built. */
export function emptyRoleKwh(): Record<EnergyRole, number> {
  return {
    solar: 0,
    gridImport: 0,
    gridExport: 0,
    batteryCharge: 0,
    batteryDischarge: 0,
    home: 0,
  };
}
