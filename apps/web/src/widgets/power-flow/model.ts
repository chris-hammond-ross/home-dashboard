/**
 * Shared data model for the Home power-flow widget. Both visual variants
 * (node map, switchboard) render the SAME derived `PowerFlowView`, so all the
 * sensor-reading, unit-normalizing and flow-allocation logic lives here once.
 *
 * The widget is read-only: it subscribes to HA sensor entities and computes
 * where power is flowing. The prototypes faked this per-scenario; here it is
 * derived from live watt readings.
 */
import {
  allocateFlows,
  type FlowKind,
  type TariffState,
  type WidgetConfig,
} from "@home-dashboard/shared";
import { useTopic } from "../../lib/socket.js";
import { useEntityMap, type EntityPayload } from "../lights/shared.js";

export type NodeId = "solar" | "grid" | "home" | "battery";
export type { FlowKind };

/** Fixed categorical color per flow role (see tokens.css `--flow-*`). */
export const FLOW_COLOR: Record<FlowKind, string> = {
  solar: "var(--flow-solar)",
  grid: "var(--flow-grid)",
  export: "var(--flow-export)",
  battery: "var(--flow-battery)",
  charge: "var(--flow-charge)",
};

export interface FlowSegment {
  from: NodeId;
  to: NodeId;
  /** Magnitude in watts (always positive). */
  watts: number;
  kind: FlowKind;
}

export interface PowerFlowView {
  /** No entities configured at all — prompt the user to set them. */
  configured: boolean;
  /** Configured, but no entity payload has arrived yet. */
  waiting: boolean;
  hasSolar: boolean;
  hasBattery: boolean;
  /** Generation, ≥ 0. */
  solarW: number;
  /** Signed: > 0 importing, < 0 exporting. */
  gridW: number;
  /** Signed: > 0 charging, < 0 discharging. */
  batteryW: number;
  socPct: number | null;
  /** Home consumption, ≥ 0 (measured or derived from the balance). */
  loadW: number;
  gridImportW: number;
  gridExportW: number;
  batteryChargeW: number;
  batteryDischargeW: number;
}

/** Flows below this (watts) are treated as noise and not drawn. */
const MIN_FLOW = 1;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Numeric watt value from a sensor payload, scaled from kW/MW if needed. */
function readWatts(p: EntityPayload | undefined): number | null {
  if (!p || p.state === "unavailable" || p.state === "unknown" || p.state === "") return null;
  const n = Number(p.state);
  if (!Number.isFinite(n)) return null;
  const unit =
    typeof p.attributes.unit_of_measurement === "string"
      ? p.attributes.unit_of_measurement.toLowerCase()
      : "";
  if (unit === "kw") return n * 1000;
  if (unit === "mw") return n * 1_000_000;
  return n; // assume watts
}

/** 0–100 state-of-charge from a sensor payload. */
function readPct(p: EntityPayload | undefined): number | null {
  if (!p || p.state === "unavailable" || p.state === "unknown" || p.state === "") return null;
  const n = Number(p.state);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

/** Read the widget's entity props, subscribe, and derive the normalized view. */
export function usePowerFlow(config: WidgetConfig): PowerFlowView {
  const props = config.props;
  const integration = str(props.integration) ?? "ha";

  const solarEntity = str(props.solarEntity);
  const gridEntity = str(props.gridEntity);
  const gridImportEntity = str(props.gridImportEntity);
  const gridExportEntity = str(props.gridExportEntity);
  const batteryEntity = str(props.batteryEntity);
  const batteryChargeEntity = str(props.batteryChargeEntity);
  const batteryDischargeEntity = str(props.batteryDischargeEntity);
  const batterySocEntity = str(props.batterySocEntity);
  const homeEntity = str(props.homeEntity);

  const ids = [
    solarEntity,
    gridEntity,
    gridImportEntity,
    gridExportEntity,
    batteryEntity,
    batteryChargeEntity,
    batteryDischargeEntity,
    batterySocEntity,
    homeEntity,
  ].filter((id): id is string => typeof id === "string");
  const uniqueIds = [...new Set(ids)];

  const map = useEntityMap(integration, uniqueIds);
  const get = (id: string | undefined) => (id ? map[id] : undefined);

  const configured = uniqueIds.length > 0;
  const waiting = configured && uniqueIds.every((id) => map[id] === undefined);

  // Sign conventions vary by inverter. A signed grid/battery sensor whose sign
  // is the reverse of ours (import > 0, charge > 0) is fixed with these flags —
  // e.g. GoodWe's grid meter reads negative while importing, so invertGrid.
  const invertGrid = props.invertGrid === true;
  const invertBattery = props.invertBattery === true;

  const solarW = Math.max(0, readWatts(get(solarEntity)) ?? 0);

  const gridW =
    gridEntity !== undefined
      ? (readWatts(get(gridEntity)) ?? 0) * (invertGrid ? -1 : 1)
      : Math.max(0, readWatts(get(gridImportEntity)) ?? 0) -
        Math.max(0, readWatts(get(gridExportEntity)) ?? 0);

  const batteryW =
    batteryEntity !== undefined
      ? (readWatts(get(batteryEntity)) ?? 0) * (invertBattery ? -1 : 1)
      : Math.max(0, readWatts(get(batteryChargeEntity)) ?? 0) -
        Math.max(0, readWatts(get(batteryDischargeEntity)) ?? 0);

  const gridImportW = Math.max(0, gridW);
  const gridExportW = Math.max(0, -gridW);
  const batteryChargeW = Math.max(0, batteryW);
  const batteryDischargeW = Math.max(0, -batteryW);

  const measuredLoad = homeEntity !== undefined ? readWatts(get(homeEntity)) : null;
  const loadW =
    measuredLoad != null
      ? Math.max(0, measuredLoad)
      : Math.max(0, solarW + gridImportW + batteryDischargeW - gridExportW - batteryChargeW);

  const hasSolar = solarEntity !== undefined;
  const hasBattery =
    batteryEntity !== undefined ||
    batteryChargeEntity !== undefined ||
    batteryDischargeEntity !== undefined ||
    batterySocEntity !== undefined;

  return {
    configured,
    waiting,
    hasSolar,
    hasBattery,
    solarW,
    gridW,
    batteryW,
    socPct: readPct(get(batterySocEntity)),
    loadW,
    gridImportW,
    gridExportW,
    batteryChargeW,
    batteryDischargeW,
  };
}

/**
 * The six directed flows the visuals draw. The allocation itself lives in
 * `@home-dashboard/shared` so the history service splits each past hour by the
 * same priority the live diagram shows; this wrapper just re-labels `amount`
 * as `watts` for the variants.
 */
export function deriveFlows(view: PowerFlowView): FlowSegment[] {
  return allocateFlows(
    {
      solar: view.solarW,
      gridImport: view.gridImportW,
      gridExport: view.gridExportW,
      batteryCharge: view.batteryChargeW,
      batteryDischarge: view.batteryDischargeW,
      load: view.loadW,
    },
    MIN_FLOW,
  ).map((flow) => ({
    from: flow.from as NodeId,
    to: flow.to as NodeId,
    watts: flow.amount,
    kind: flow.kind,
  }));
}

/** Stable signature of a flow set — cheap dependency for animation effects. */
export function flowSignature(flows: FlowSegment[]): string {
  return flows.map((f) => `${f.from}-${f.to}:${f.kind}:${Math.round(f.watts)}`).join("|");
}

export interface LiveCost {
  /** Import band in force right now, e.g. "Peak". */
  bandLabel: string;
  centsPerKwh: number;
  /**
   * What the house is spending this instant, in cents per hour: grid import at
   * the current rate, less any export credit. Negative means earning.
   */
  centsPerHour: number;
}

/**
 * Current spend rate from the retained `core/tariff` topic. The server owns the
 * tariff and flips the band at each window boundary, so the widget only has to
 * multiply. Returns null when no tariff is active or no band matches now.
 */
export function useLiveCost(view: PowerFlowView): LiveCost | null {
  const state = useTopic<TariffState>("core/tariff");
  if (!state?.tariff || !state.band) return null;
  const importCents = (view.gridImportW / 1000) * state.band.centsPerKwh;
  const exportCents = (view.gridExportW / 1000) * (state.exportCentsPerKwh ?? 0);
  return {
    bandLabel: state.band.label,
    centsPerKwh: state.band.centsPerKwh,
    centsPerHour: importCents - exportCents,
  };
}

/** "$1.42/h" or "−$0.18/h" when exporting pays more than the house draws. */
export function formatSpendRate(centsPerHour: number): string {
  const sign = centsPerHour < 0 ? "−" : "";
  return `${sign}$${(Math.abs(centsPerHour) / 100).toFixed(2)}/h`;
}
