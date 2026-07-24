/**
 * Shared data model for the Climate control widget. All three visual variants
 * (Radial dial, Studio mixer, Bento grid) render the SAME derived `ClimateView`
 * and drive the SAME service calls, so every bit of Home-Assistant reading and
 * command-building lives here once.
 *
 * The widget binds to ONE `climate.*` entity (thermostat / AC head unit) plus an
 * optional list of zone entities (ducted-zone dampers, à la AirTouch / Advantage
 * Air). Zones are `cover.*` (position = damper open %), `fan.*` (percentage) or
 * `climate.*` (on/off per-room heads). One entity → just the controls; add zones
 * → the variant also offers a zone view.
 *
 * State is always what HA says is true — dragging shows a local value only while
 * the pointer is down (service calls throttled), then settles back to the topic.
 */
import { useEffect, useRef } from "react";
import type { WidgetConfig } from "@home-dashboard/shared";
import { socket } from "../../lib/socket.js";
import { useEntityMap, type EntityPayload } from "../lights/shared.js";
import type { ClimateIcon } from "./icons.js";

/* ── HVAC mode → look ─────────────────────────────────────────────────────────
 * Each HA hvac_mode gets an icon, a two-stop gradient and an accent/glow. These
 * are the widget's own palette (like the weather variants) — vivid mode colours
 * read well on the dark card and never collide with the app's data tokens. */

export interface ModeStyle {
  label: string;
  short: string;
  icon: ClimateIcon;
  c1: string;
  c2: string;
  accent: string;
  glow: string;
}

export const HVAC_MODES: Record<string, ModeStyle> = {
  heat: {
    label: "Heating",
    short: "Heat",
    icon: "flame",
    c1: "#ffb057",
    c2: "#ff3b2f",
    accent: "#ff6a3d",
    glow: "rgba(255,90,45,0.55)",
  },
  cool: {
    label: "Cooling",
    short: "Cool",
    icon: "snow",
    c1: "#5ad7ff",
    c2: "#3f6bff",
    accent: "#3fb0ff",
    glow: "rgba(63,150,255,0.55)",
  },
  heat_cool: {
    label: "Auto",
    short: "Auto",
    icon: "auto",
    c1: "#a78bfa",
    c2: "#2dd4bf",
    accent: "#7dd3c8",
    glow: "rgba(125,211,200,0.5)",
  },
  auto: {
    label: "Auto",
    short: "Auto",
    icon: "auto",
    c1: "#7ff0c0",
    c2: "#0ea59f",
    accent: "#2dd4bf",
    glow: "rgba(45,212,191,0.5)",
  },
  dry: {
    label: "Dry",
    short: "Dry",
    icon: "droplet",
    c1: "#7ff0c0",
    c2: "#0ea59f",
    accent: "#2dd4bf",
    glow: "rgba(45,212,191,0.5)",
  },
  fan_only: {
    label: "Fan",
    short: "Fan",
    icon: "fan",
    c1: "#7ff0c0",
    c2: "#0ea59f",
    accent: "#2dd4bf",
    glow: "rgba(45,212,191,0.5)",
  },
};

/** Palette used when the unit is off, or a mode we have no dedicated look for. */
export const OFF_STYLE: ModeStyle = {
  label: "Off",
  short: "Off",
  icon: "power",
  c1: "#5b5b62",
  c2: "#3a3a40",
  accent: "#8a8a93",
  glow: "rgba(140,140,150,0.3)",
};

export function modeStyle(mode: string | null | undefined): ModeStyle {
  if (!mode || mode === "off") return OFF_STYLE;
  return HVAC_MODES[mode] ?? { ...OFF_STYLE, label: prettyMode(mode), short: prettyMode(mode) };
}

/** "fan_only" → "Fan only", "heat_cool" → "Heat cool". */
export function prettyMode(mode: string): string {
  const s = mode.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ── derived view ────────────────────────────────────────────────────────────── */

export interface ClimateView {
  /** No `entity` prop set yet. */
  configured: boolean;
  /** Configured, but the entity payload has not arrived. */
  waiting: boolean;
  unavailable: boolean;
  entity: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** hvac_mode (the entity state): off | heat | cool | heat_cool | auto | dry | fan_only. */
  mode: string;
  /** hvac_modes offered by the device, minus "off" (off is the power button). */
  modes: string[];
  /** hvac_action if reported (heating | cooling | idle | drying | fan | off). */
  action: string | null;
  on: boolean;
  /** The value the dial/fader edits (single setpoint, or the range midpoint). */
  target: number;
  /** True when the device uses a low/high band rather than a single setpoint. */
  isRange: boolean;
  targetLow: number | null;
  targetHigh: number | null;
  current: number | null;
  fanMode: string | null;
  fanModes: string[];
}

export type ZoneKind = "cover" | "fan" | "climate" | "other";

export interface ZoneView {
  entity: string;
  name: string;
  waiting: boolean;
  unavailable: boolean;
  on: boolean;
  /** Whether a 0–100 damper/position/percentage can be set. */
  hasLevel: boolean;
  /** Damper open %, 0–100. */
  level: number;
  kind: ZoneKind;
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Snap to the device's step and clamp to [min, max]. */
export function snap(view: ClimateView, t: number): number {
  const stepped = Math.round(t / view.step) * view.step;
  // Kill binary dust from the division (e.g. 22.500000000000004).
  const clean = Math.round(stepped * 100) / 100;
  return clamp(clean, view.min, view.max);
}

/** Split 22.5 → { int: 22, dec: 5 } for the two-tier temperature display. */
export function splitTemp(t: number): { int: number; dec: number } {
  const int = Math.floor(t + 1e-6);
  return { int, dec: Math.round((t - int) * 10) };
}

function readView(entity: string | undefined, p: EntityPayload | undefined): ClimateView {
  const base = {
    unit: "°C",
    min: 7,
    max: 35,
    step: 0.5,
    mode: "off",
    modes: [] as string[],
    action: null,
    fanMode: null,
    fanModes: [] as string[],
  };
  if (!entity) {
    return {
      configured: false,
      waiting: false,
      unavailable: true,
      entity: "",
      name: "Climate",
      ...base,
      on: false,
      target: 21,
      isRange: false,
      targetLow: null,
      targetHigh: null,
      current: null,
    };
  }
  const fallbackName = entity.split(".")[1]?.replace(/_/g, " ") ?? entity;
  if (!p) {
    return {
      configured: true,
      waiting: true,
      unavailable: true,
      entity,
      name: fallbackName,
      ...base,
      on: false,
      target: 21,
      isRange: false,
      targetLow: null,
      targetHigh: null,
      current: null,
    };
  }

  const a = p.attributes;
  const unavailable = p.state === "unavailable" || p.state === "unknown";
  const mode = unavailable ? "off" : p.state || "off";
  const modes = (Array.isArray(a.hvac_modes) ? a.hvac_modes : [])
    .filter((m): m is string => typeof m === "string")
    .filter((m) => m !== "off");
  const min = num(a.min_temp) ?? base.min;
  const max = num(a.max_temp) ?? base.max;
  const stepAttr = num(a.target_temp_step);
  const step = stepAttr && stepAttr > 0 ? stepAttr : base.step;

  const single = num(a.temperature);
  const low = num(a.target_temp_low) ?? null;
  const high = num(a.target_temp_high) ?? null;
  const isRange = single === undefined && (low !== null || high !== null);
  const target =
    single ??
    (low !== null && high !== null
      ? (low + high) / 2
      : (high ?? low ?? num(a.current_temperature) ?? (min + max) / 2));

  const fanModes = (Array.isArray(a.fan_modes) ? a.fan_modes : []).filter(
    (m): m is string => typeof m === "string",
  );

  return {
    configured: true,
    waiting: false,
    unavailable,
    entity,
    name: str(a.friendly_name) ?? fallbackName,
    unit: str(a.temperature_unit) ?? base.unit,
    min,
    max,
    step,
    mode,
    modes,
    action: str(a.hvac_action) ?? null,
    on: !unavailable && mode !== "off",
    target,
    isRange,
    targetLow: low,
    targetHigh: high,
    current: num(a.current_temperature) ?? null,
    fanMode: str(a.fan_mode) ?? null,
    fanModes,
  };
}

function readZone(entity: string, p: EntityPayload | undefined): ZoneView {
  const domain = entity.split(".")[0] ?? "";
  const fallbackName = entity.split(".")[1]?.replace(/_/g, " ") ?? entity;
  if (!p) {
    return {
      entity,
      name: fallbackName,
      waiting: true,
      unavailable: true,
      on: false,
      hasLevel: false,
      level: 0,
      kind: domain === "cover" ? "cover" : domain === "fan" ? "fan" : "other",
    };
  }
  const a = p.attributes;
  const name = str(a.friendly_name) ?? fallbackName;
  const unavailable = p.state === "unavailable" || p.state === "unknown";

  if (domain === "cover") {
    const pos = num(a.current_position);
    return {
      entity,
      name,
      waiting: false,
      unavailable,
      hasLevel: pos !== undefined,
      level: pos ?? (p.state === "open" ? 100 : 0),
      on: !unavailable && (p.state === "open" || (pos ?? 0) > 0),
      kind: "cover",
    };
  }
  if (domain === "fan") {
    const pct = num(a.percentage);
    return {
      entity,
      name,
      waiting: false,
      unavailable,
      hasLevel: pct !== undefined,
      level: pct ?? (p.state === "on" ? 100 : 0),
      on: !unavailable && p.state === "on",
      kind: "fan",
    };
  }
  if (domain === "climate") {
    return {
      entity,
      name,
      waiting: false,
      unavailable,
      hasLevel: false,
      level: 0,
      on: !unavailable && p.state !== "off",
      kind: "climate",
    };
  }
  return {
    entity,
    name,
    waiting: false,
    unavailable,
    hasLevel: false,
    level: 0,
    on: !unavailable && p.state === "on",
    kind: "other",
  };
}

/* ── last-active-mode persistence ─────────────────────────────────────────────
 * Powering a unit off collapses its HA state to "off", losing the mode. We keep
 * the last active mode per entity so power-on restores it. localStorage lets it
 * survive a kiosk reload; a throw (private mode / storage disabled) degrades to
 * memory-only for the session. */

const MODE_STORAGE_PREFIX = "hd.climate.lastMode.";

function readStoredMode(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredMode(key: string, mode: string): void {
  try {
    window.localStorage.setItem(key, mode);
  } catch {
    /* storage unavailable — the in-memory ref still works for this session */
  }
}

/* ── the hook ────────────────────────────────────────────────────────────────── */

export interface Climate {
  view: ClimateView;
  zones: ZoneView[];
  /** Set the single setpoint, or (range mode) shift the band around this midpoint. */
  setTarget(t: number): void;
  setMode(mode: string): void;
  setFan(mode: string): void;
  /** Off → turn on to a sensible mode; on → off. */
  togglePower(): void;
  setZoneLevel(zone: ZoneView, pct: number): void;
  toggleZone(zone: ZoneView): void;
}

export function useClimate(config: WidgetConfig): Climate {
  const props = config.props;
  const integration = str(props.integration) ?? "ha";
  const entity = str(props.entity);
  const label = str(props.label);

  const zoneIds = (Array.isArray(props.zoneEntities) ? props.zoneEntities : []).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  const ids = [...new Set([entity, ...zoneIds].filter((id): id is string => !!id))];
  const map = useEntityMap(integration, ids);

  const view = readView(entity, entity ? map[entity] : undefined);
  if (label) view.name = label;
  const zones = zoneIds.map((id) => readZone(id, map[id]));

  // Remember the last active hvac_mode so powering back on restores it rather
  // than snapping to modes[0] (usually "auto"). HA reports plain "off" when the
  // unit is down — the previous mode is gone from the payload — so we snapshot
  // it, mirrored to localStorage so it also survives a kiosk reload. The record
  // effect fires for ANY source of a mode change (this UI, HA, the maker's own
  // app), because view.mode just tracks the HA topic.
  const storageKey = entity ? `${MODE_STORAGE_PREFIX}${entity}` : null;
  const lastActiveMode = useRef<string | null>(null);
  useEffect(() => {
    lastActiveMode.current = storageKey ? readStoredMode(storageKey) : null;
  }, [storageKey]);
  useEffect(() => {
    if (!view.on) return;
    lastActiveMode.current = view.mode;
    if (storageKey) writeStoredMode(storageKey, view.mode);
  }, [view.on, view.mode, storageKey]);

  const call = (domain: string, service: string, data?: Record<string, unknown>, target?: string) =>
    void socket.action(integration, "call-service", {
      domain,
      service,
      ...(data ? { data } : {}),
      ...(target ? { target: { entity_id: target } } : {}),
    });

  const setTarget = (t: number) => {
    if (!entity) return;
    const value = snap(view, t);
    if (view.isRange && view.targetLow !== null && view.targetHigh !== null) {
      // Keep the band width, slide it so its centre lands on `value`.
      const half = Math.max(view.step, (view.targetHigh - view.targetLow) / 2);
      call(
        "climate",
        "set_temperature",
        {
          target_temp_low: snap(view, value - half),
          target_temp_high: snap(view, value + half),
        },
        entity,
      );
    } else {
      call("climate", "set_temperature", { temperature: value }, entity);
    }
  };

  const setMode = (mode: string) => {
    if (entity) call("climate", "set_hvac_mode", { hvac_mode: mode }, entity);
  };

  const setFan = (mode: string) => {
    if (entity) call("climate", "set_fan_mode", { fan_mode: mode }, entity);
  };

  const togglePower = () => {
    if (!entity) return;
    if (view.on) {
      setMode("off");
    } else {
      const remembered = lastActiveMode.current;
      const restore =
        remembered && view.modes.includes(remembered) ? remembered : (view.modes[0] ?? "heat");
      setMode(restore);
    }
  };

  const setZoneLevel = (zone: ZoneView, pct: number) => {
    const value = clamp(Math.round(pct), 0, 100);
    if (zone.kind === "cover")
      call("cover", "set_cover_position", { position: value }, zone.entity);
    else if (zone.kind === "fan") call("fan", "set_percentage", { percentage: value }, zone.entity);
  };

  const toggleZone = (zone: ZoneView) => {
    if (zone.kind === "cover") {
      call("cover", zone.on ? "close_cover" : "open_cover", undefined, zone.entity);
    } else {
      void socket.action(integration, "toggle", { entity_id: zone.entity });
    }
  };

  return { view, zones, setTarget, setMode, setFan, togglePower, setZoneLevel, toggleZone };
}
