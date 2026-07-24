import { z } from "zod";

/**
 * Electricity tariff model + costing math.
 *
 * Lives in `shared` because both ends need it: the server validates REST
 * bodies, prices history hour-by-hour and publishes the live band on
 * `core/tariff`; the browser types the settings editor against the same shape.
 *
 * Everything here is pure and dependency-free. Local wall-clock time comes from
 * `Intl.DateTimeFormat` with an IANA zone, so DST is handled without dayjs.
 *
 * Money is in **cents** throughout (51.27 c/kWh, 163.66 c/day) — a tariff is
 * quoted in cents on every Australian bill, and staying in one unit avoids the
 * dollar/cent mix-ups that make a costing bug invisible.
 */

export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * A slice of the week a rate applies to. Minutes are local minutes-of-day:
 * `startMin` inclusive, `endMin` exclusive, so a full day is 0 → 1440.
 * `endMin <= startMin` means the window wraps past midnight (22:00 → 06:00),
 * in which case `days` names the day the window *starts* on.
 */
export const RateWindowSchema = z.object({
  days: z.array(z.enum(WEEKDAYS)).min(1),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440),
});
export type RateWindow = z.infer<typeof RateWindowSchema>;

export const RATE_KINDS = ["peak", "shoulder", "offpeak", "flat"] as const;
export type RateKind = (typeof RATE_KINDS)[number];

/**
 * One priced band. A block with **no windows** is the catch-all: it applies
 * whenever no windowed block matches. `kind` only drives colour and wording —
 * a plan whose fallback rate is genuinely off-peak keeps `kind: "offpeak"` and
 * still acts as the catch-all.
 */
export const RateBlockSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(RATE_KINDS),
  centsPerKwh: z.number(),
  windows: z.array(RateWindowSchema).default([]),
});
export type RateBlock = z.infer<typeof RateBlockSchema>;

/** Where the rates came from, when they were imported from a retailer's CDR data. */
export const TariffSourceSchema = z.object({
  kind: z.literal("aer"),
  brand: z.string(),
  brandName: z.string().optional(),
  planId: z.string(),
  planName: z.string().optional(),
  retrievedAt: z.string(),
});
export type TariffSource = z.infer<typeof TariffSourceSchema>;

export const TariffSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** IANA zone the windows are expressed in, e.g. "Australia/Adelaide". */
  timezone: z.string().min(1).default("Australia/Sydney"),
  dailySupplyCents: z.number().min(0).default(0),
  /** Consumption bands. First matching window wins; a `flat` block is the fallback. */
  importBlocks: z.array(RateBlockSchema).default([]),
  /** Feed-in bands, priced the same way. Usually a single flat block. */
  exportBlocks: z.array(RateBlockSchema).default([]),
  source: TariffSourceSchema.optional(),
});
export type Tariff = z.infer<typeof TariffSchema>;

/** Body of POST /api/tariffs — id optional (server slugifies the name). */
export const CreateTariffSchema = TariffSchema.partial({ id: true });
/** Body of PUT /api/tariffs/:id — id comes from the URL, never the body. */
export const UpdateTariffSchema = TariffSchema.omit({ id: true });

/** Retained `core/tariff` payload: the active plan plus the band in force right now. */
export interface TariffState {
  tariff: Tariff | null;
  /** Import band active at `asOf`, or null when nothing matches. */
  band: { id: string; label: string; kind: RateKind; centsPerKwh: number } | null;
  /** Feed-in rate active at `asOf`, in cents. */
  exportCentsPerKwh: number | null;
  asOf: string;
  /** When the active band next changes — the server re-broadcasts then. */
  nextChangeAt: string | null;
}

// ---------------------------------------------------------------------------
// Local-time resolution
// ---------------------------------------------------------------------------

/** Intl formatters are expensive to build and cheap to reuse. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour12: false,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

const WEEKDAY_BY_NAME: Record<string, Weekday> = {
  Mon: "MON",
  Tue: "TUE",
  Wed: "WED",
  Thu: "THU",
  Fri: "FRI",
  Sat: "SAT",
  Sun: "SUN",
};

export interface LocalParts {
  weekday: Weekday;
  /** Local minutes since midnight, 0–1439. */
  minutes: number;
  /** Local calendar day as YYYY-MM-DD — the key days are bucketed by. */
  dateKey: string;
}

/**
 * Wall-clock parts of a UTC instant in the tariff's zone. Falls back to the
 * host zone if the IANA name is rejected, so a typo degrades to slightly wrong
 * costing rather than a crash on the wall panel.
 */
export function localParts(timezone: string, ms: number): LocalParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterFor(timezone).formatToParts(new Date(ms));
  } catch {
    parts = formatterFor(Intl.DateTimeFormat().resolvedOptions().timeZone).formatToParts(
      new Date(ms),
    );
  }
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  // en-GB renders midnight as "24" in some engines; normalize to 0.
  const hour = Number(get("hour")) % 24;
  return {
    weekday: WEEKDAY_BY_NAME[get("weekday")] ?? "MON",
    minutes: hour * 60 + Number(get("minute")),
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

const previousDay = (day: Weekday): Weekday =>
  WEEKDAYS[(WEEKDAYS.indexOf(day) + WEEKDAYS.length - 1) % WEEKDAYS.length]!;

/** Does a window cover this local instant? Handles midnight wrap. */
export function windowCovers(window: RateWindow, at: LocalParts): boolean {
  const { startMin, endMin } = window;
  const days = new Set(window.days);
  if (endMin > startMin) {
    return days.has(at.weekday) && at.minutes >= startMin && at.minutes < endMin;
  }
  // Wraps midnight: the tail belongs to the previous local day's window.
  if (at.minutes >= startMin) return days.has(at.weekday);
  if (at.minutes < endMin) return days.has(previousDay(at.weekday));
  return false;
}

/**
 * The block in force at an instant: the first windowed block whose window
 * covers it, else the first windowless block (the catch-all), else null.
 * Declaration order is the tiebreaker, so overlapping windows resolve
 * predictably.
 */
export function resolveBlock(blocks: RateBlock[], timezone: string, ms: number): RateBlock | null {
  const at = localParts(timezone, ms);
  for (const block of blocks) {
    if (block.windows.some((w) => windowCovers(w, at))) return block;
  }
  return blocks.find((b) => b.windows.length === 0) ?? null;
}

/**
 * When the import band next changes, scanning forward a minute at a time (up
 * to 48h — enough to cross any window boundary, and DST-safe because every
 * step re-derives local time). Returns null if the band never changes.
 */
export function nextBandChange(tariff: Tariff, fromMs: number): number | null {
  const current = resolveBlock(tariff.importBlocks, tariff.timezone, fromMs)?.id ?? null;
  const step = 60_000;
  const limit = fromMs + 48 * 60 * 60 * 1000;
  for (let ms = fromMs + step; ms <= limit; ms += step) {
    const id = resolveBlock(tariff.importBlocks, tariff.timezone, ms)?.id ?? null;
    if (id !== current) return ms;
  }
  return null;
}

/** Snapshot of the tariff for the retained `core/tariff` topic. */
export function tariffState(tariff: Tariff | null, atMs: number): TariffState {
  if (!tariff) {
    return {
      tariff: null,
      band: null,
      exportCentsPerKwh: null,
      asOf: new Date(atMs).toISOString(),
      nextChangeAt: null,
    };
  }
  const band = resolveBlock(tariff.importBlocks, tariff.timezone, atMs);
  const exportBlock = resolveBlock(tariff.exportBlocks, tariff.timezone, atMs);
  const next = nextBandChange(tariff, atMs);
  return {
    tariff,
    band: band
      ? { id: band.id, label: band.label, kind: band.kind, centsPerKwh: band.centsPerKwh }
      : null,
    exportCentsPerKwh: exportBlock?.centsPerKwh ?? null,
    asOf: new Date(atMs).toISOString(),
    nextChangeAt: next === null ? null : new Date(next).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Costing
// ---------------------------------------------------------------------------

/** One hour of metered energy — the unit history is priced in. */
export interface HourEnergy {
  /** UTC epoch ms at the start of the hour. */
  start: number;
  importKwh: number;
  exportKwh: number;
}

export interface HourCost {
  importCents: number;
  /** Feed-in credit, as a positive number. */
  exportCents: number;
  /** Import band that applied, for stacking the chart by band. */
  blockId: string | null;
  blockKind: RateKind | null;
}

/**
 * Price one hour. The band is resolved at the hour's *start* — HA's hourly
 * statistics are already aligned to the local hour, and every published TOU
 * window in the CDR data starts on an hour boundary, so an hour never
 * straddles two bands in practice.
 */
export function priceHour(tariff: Tariff, hour: HourEnergy): HourCost {
  const importBlock = resolveBlock(tariff.importBlocks, tariff.timezone, hour.start);
  const exportBlock = resolveBlock(tariff.exportBlocks, tariff.timezone, hour.start);
  return {
    importCents: hour.importKwh * (importBlock?.centsPerKwh ?? 0),
    exportCents: hour.exportKwh * (exportBlock?.centsPerKwh ?? 0),
    blockId: importBlock?.id ?? null,
    blockKind: importBlock?.kind ?? null,
  };
}

export interface BandTotal {
  blockId: string;
  label: string;
  kind: RateKind;
  centsPerKwh: number;
  kwh: number;
  cents: number;
}

export interface CostSummary {
  /** Import consumption split by the band that priced it, in tariff order. */
  byBand: BandTotal[];
  importCents: number;
  exportCents: number;
  supplyCents: number;
  /** What the period actually costs: import + supply − feed-in credit. */
  netCents: number;
}

/**
 * Total a run of hours. `supplyDays` is passed in rather than derived from the
 * hours because the caller knows whether a part-day should be charged (today's
 * partial day still incurs the full daily supply charge on a real bill).
 */
export function summarise(tariff: Tariff, hours: HourEnergy[], supplyDays: number): CostSummary {
  const byBand = new Map<string, BandTotal>();
  for (const block of tariff.importBlocks) {
    byBand.set(block.id, {
      blockId: block.id,
      label: block.label,
      kind: block.kind,
      centsPerKwh: block.centsPerKwh,
      kwh: 0,
      cents: 0,
    });
  }

  let importCents = 0;
  let exportCents = 0;
  for (const hour of hours) {
    const cost = priceHour(tariff, hour);
    importCents += cost.importCents;
    exportCents += cost.exportCents;
    const band = cost.blockId ? byBand.get(cost.blockId) : undefined;
    if (band) {
      band.kwh += hour.importKwh;
      band.cents += cost.importCents;
    }
  }

  const supplyCents = tariff.dailySupplyCents * supplyDays;
  return {
    byBand: [...byBand.values()].filter((b) => b.kwh > 0),
    importCents,
    exportCents,
    supplyCents,
    netCents: importCents + supplyCents - exportCents,
  };
}

/** "$12.34" / "−$1.20" — one place so server logs and the UI agree. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** Minutes-of-day → "HH:MM", for the settings editor and band labels. */
export function formatMinutes(min: number): string {
  const clamped = Math.max(0, Math.min(1440, min)) % 1440;
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** "HH:MM" → minutes-of-day. Returns null on anything unparseable. */
export function parseMinutes(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}
