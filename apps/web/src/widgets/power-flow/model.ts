/**
 * Shared data model for the Home power-flow widget. Both visual variants
 * (node map, switchboard) render the SAME derived `PowerFlowView`, so all the
 * sensor-reading, unit-normalizing and flow-allocation logic lives here once.
 *
 * The widget is read-only: it subscribes to HA sensor entities and computes
 * where power is flowing. The prototypes faked this per-scenario; here it is
 * derived from live watt readings.
 */
import type { WidgetConfig } from "@home-dashboard/shared";
import { useEntityMap, type EntityPayload } from "../lights/shared.js";

export type NodeId = "solar" | "grid" | "home" | "battery";
export type FlowKind = "solar" | "grid" | "export" | "battery" | "charge";

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
 * Greedy power-balance allocation → the six directed flows the visuals draw.
 * Priority: solar serves home, then charges the battery, then exports; any
 * remaining home demand is met by battery discharge, then grid import; leftover
 * grid import can charge the battery (off-peak). Deterministic, and reproduces
 * every prototype scenario from raw sensor values.
 */
export function deriveFlows(view: PowerFlowView): FlowSegment[] {
  let solar = view.solarW;
  let batteryDischarge = view.batteryDischargeW;
  let gridImport = view.gridImportW;
  let home = view.loadW;
  let batteryCharge = view.batteryChargeW;
  let gridExport = view.gridExportW;

  const flows: FlowSegment[] = [];
  const push = (from: NodeId, to: NodeId, watts: number, kind: FlowKind) => {
    if (watts > MIN_FLOW) flows.push({ from, to, watts, kind });
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

/** Stable signature of a flow set — cheap dependency for animation effects. */
export function flowSignature(flows: FlowSegment[]): string {
  return flows.map((f) => `${f.from}-${f.to}:${f.kind}:${Math.round(f.watts)}`).join("|");
}
