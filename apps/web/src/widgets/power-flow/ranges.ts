import dayjs, { type Dayjs } from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek.js";
import type { EnergyBucket, EnergyRole, EnergySource } from "@home-dashboard/shared";
import type { WidgetConfig } from "@home-dashboard/shared";

// Weeks start on Monday — dayjs defaults to Sunday, which reads wrong on an
// Australian bill and misaligns week-on-week comparisons.
dayjs.extend(isoWeek);

/**
 * Range maths and widget-prop → history-request translation for the energy
 * drill-down. Kept out of the modal so the date arithmetic is readable and the
 * modal stays about layout.
 */

export type RangeMode = "day" | "week" | "month" | "year" | "custom";

/**
 * What Mantine's range picker hands back. Mantine 8 emits "YYYY-MM-DD" strings
 * but its type still admits Date, so both are accepted and normalised here
 * rather than cast away at the call site.
 */
export type PickedRange = [string | Date | null, string | Date | null];

export interface ResolvedRange {
  /** ISO instants; `end` is exclusive. */
  start: string;
  end: string;
  bucket: EnergyBucket;
  /** What the header says, e.g. "Tue 14 July" or "July 2026". */
  title: string;
  /** Wording for the period-on-period comparison line. */
  previousLabel: string;
}

/** Bucket wide enough that a long custom range stays readable. */
function autoBucket(days: number): EnergyBucket {
  if (days <= 2) return "hour";
  if (days <= 70) return "day";
  return "month";
}

export function resolveRange(
  mode: RangeMode,
  anchor: Dayjs,
  custom: PickedRange,
): ResolvedRange | null {
  switch (mode) {
    case "day": {
      const start = anchor.startOf("day");
      return {
        start: start.toISOString(),
        end: start.add(1, "day").toISOString(),
        bucket: "hour",
        title: start.format("ddd D MMMM"),
        previousLabel: "yesterday",
      };
    }
    case "week": {
      const start = anchor.startOf("isoWeek");
      return {
        start: start.toISOString(),
        end: start.add(1, "week").toISOString(),
        bucket: "day",
        title: `${start.format("D MMM")} – ${start.add(6, "day").format("D MMM")}`,
        previousLabel: "previous week",
      };
    }
    case "month": {
      const start = anchor.startOf("month");
      return {
        start: start.toISOString(),
        end: start.add(1, "month").toISOString(),
        bucket: "day",
        title: start.format("MMMM YYYY"),
        previousLabel: "previous month",
      };
    }
    case "year": {
      const start = anchor.startOf("year");
      return {
        start: start.toISOString(),
        end: start.add(1, "year").toISOString(),
        bucket: "month",
        title: start.format("YYYY"),
        previousLabel: "previous year",
      };
    }
    case "custom": {
      const [from, to] = custom;
      if (!from || !to) return null;
      const start = dayjs(from).startOf("day");
      // The picker's end date is inclusive; the API's is exclusive.
      const end = dayjs(to).startOf("day").add(1, "day");
      const days = end.diff(start, "day");
      return {
        start: start.toISOString(),
        end: end.toISOString(),
        bucket: autoBucket(days),
        title: `${start.format("D MMM")} – ${end.subtract(1, "day").format("D MMM YYYY")}`,
        previousLabel: `previous ${days} days`,
      };
    }
  }
}

/** Step the anchor one whole period back or forward. */
export function stepAnchor(mode: RangeMode, anchor: Dayjs, direction: -1 | 1): Dayjs {
  const unit = mode === "custom" ? "day" : mode;
  return anchor.add(direction, unit);
}

/** Axis + tooltip wording for a bucket start, given how wide the bucket is. */
export function bucketLabels(
  startIso: string,
  bucket: EnergyBucket,
): { label: string; fullLabel: string } {
  const at = dayjs(startIso);
  if (bucket === "hour") {
    return { label: at.format("ha"), fullLabel: at.format("ddd D MMM, h:mm a") };
  }
  if (bucket === "day") {
    return { label: at.format("D"), fullLabel: at.format("dddd D MMMM") };
  }
  return { label: at.format("MMM"), fullLabel: at.format("MMMM YYYY") };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * Build the history request's role map from the widget's props.
 *
 * Prefers the `…EnergyStat` kWh statistics when configured; otherwise falls
 * back to the power (W) entities the widget already binds, which the server
 * integrates. That fallback is why the drill-down works the moment the widget
 * does, with no extra Home Assistant setup.
 *
 * A single signed grid/battery sensor is split into its two directions by
 * `sign`, and `invertGrid` / `invertBattery` carry straight through — the same
 * props that fix a reversed meter on the live diagram fix it in history too.
 */
export function rolesFromConfig(config: WidgetConfig): Partial<Record<EnergyRole, EnergySource>> {
  const props = config.props;
  const roles: Partial<Record<EnergyRole, EnergySource>> = {};
  const invertGrid = props.invertGrid === true;
  const invertBattery = props.invertBattery === true;

  const energy = (key: string): EnergySource | null => {
    const id = str(props[key]);
    return id ? { statisticId: id, kind: "energy", invert: false, sign: "positive" } : null;
  };
  const power = (
    key: string,
    opts: { invert?: boolean; sign?: EnergySource["sign"] } = {},
  ): EnergySource | null => {
    const id = str(props[key]);
    return id
      ? {
          statisticId: id,
          kind: "power",
          invert: opts.invert ?? false,
          sign: opts.sign ?? "positive",
        }
      : null;
  };
  const put = (role: EnergyRole, ...candidates: (EnergySource | null)[]) => {
    const hit = candidates.find((c): c is EnergySource => c !== null);
    if (hit) roles[role] = hit;
  };

  put("solar", energy("solarEnergyStat"), power("solarEntity"));
  put(
    "gridImport",
    energy("gridImportEnergyStat"),
    power("gridEntity", { invert: invertGrid, sign: "positive" }),
    power("gridImportEntity"),
  );
  put(
    "gridExport",
    energy("gridExportEnergyStat"),
    power("gridEntity", { invert: invertGrid, sign: "negative" }),
    power("gridExportEntity"),
  );
  put(
    "batteryCharge",
    energy("batteryChargeEnergyStat"),
    power("batteryEntity", { invert: invertBattery, sign: "positive" }),
    power("batteryChargeEntity"),
  );
  put(
    "batteryDischarge",
    energy("batteryDischargeEnergyStat"),
    power("batteryEntity", { invert: invertBattery, sign: "negative" }),
    power("batteryDischargeEntity"),
  );
  put("home", energy("homeEnergyStat"), power("homeEntity"));

  return roles;
}
