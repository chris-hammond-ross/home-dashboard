/**
 * Editor metadata for the widget registry: what the settings UI needs to offer
 * and configure each widget type. Purely descriptive — rendering still goes
 * through registry.tsx. Keep the two in sync when adding a widget type.
 */

export type PropFieldKind =
  "text" | "number" | "boolean" | "select" | "entity" | "entity-list" | "topic";

export interface PropField {
  key: string;
  label: string;
  kind: PropFieldKind;
  /** Choices for kind "select"; clearing the field removes the prop (= auto). */
  options?: string[];
  /** Pre-filter for the entity picker (kinds "entity" / "entity-list"). */
  domains?: string[];
  placeholder?: string;
  help?: string;
}

/** One selectable visual variant of a widget type (see registry.tsx). */
export interface WidgetVariantMeta {
  id: string;
  label: string;
  description?: string;
}

export interface WidgetMeta {
  type: string;
  label: string;
  description: string;
  defaultSpans: { cols: number; rows: number };
  fields: PropField[];
  /** Present only for widget types that ship more than one visual variant. */
  variants?: WidgetVariantMeta[];
  /** Which variant id applies when config.variant is unset. */
  defaultVariant?: string;
}

export const widgetMeta: WidgetMeta[] = [
  {
    type: "clock",
    label: "Clock",
    description: "Time and date",
    defaultSpans: { cols: 2, rows: 1 },
    fields: [],
  },
  {
    type: "weather",
    label: "Weather",
    description: "Conditions + 7-day forecast",
    defaultSpans: { cols: 2, rows: 3 },
    defaultVariant: "nocturne",
    variants: [
      { id: "nocturne", label: "Nocturne", description: "Glass cards over a drifting aurora" },
      { id: "ember", label: "Ember", description: "Warm serif hero with a 7-day range list" },
      {
        id: "meridian",
        label: "Meridian",
        description: "Monospaced instrument panel + outlook strip",
      },
    ],
    fields: [
      {
        key: "topic",
        label: "Topic",
        kind: "topic",
        placeholder: "demo/weather",
        help: "A weather stream, e.g. demo/weather or weather/weather from the weather integration.",
      },
    ],
  },
  {
    type: "energy",
    label: "Energy",
    description: "Solar / load / battery stat tiles",
    defaultSpans: { cols: 2, rows: 2 },
    fields: [{ key: "topic", label: "Topic", kind: "topic", placeholder: "demo/energy" }],
  },
  {
    type: "calendar",
    label: "Calendar",
    description: "Upcoming events",
    defaultSpans: { cols: 2, rows: 2 },
    fields: [{ key: "topic", label: "Topic", kind: "topic", placeholder: "demo/calendar" }],
  },
  {
    type: "now-playing",
    label: "Now playing",
    description: "Current media playback",
    defaultSpans: { cols: 2, rows: 1 },
    fields: [{ key: "topic", label: "Topic", kind: "topic", placeholder: "demo/now-playing" }],
  },
  {
    type: "light",
    label: "Light",
    description: "One light or outlet — UI matches its capabilities",
    defaultSpans: { cols: 1, rows: 2 },
    fields: [
      { key: "entity", label: "Entity", kind: "entity", domains: ["light", "switch"] },
      { key: "label", label: "Label", kind: "text", placeholder: "HA friendly name" },
      {
        key: "icon",
        label: "Icon",
        kind: "select",
        options: ["bulb", "lamp", "lamp-floor", "bed", "plug"],
      },
      {
        key: "variant",
        label: "Variant",
        kind: "select",
        options: ["switch", "dimmer", "colour"],
        help: "Leave empty to match the entity's capabilities",
      },
    ],
  },
  {
    type: "light-group",
    label: "Light group",
    description: "Master power/brightness with per-light tiles",
    defaultSpans: { cols: 2, rows: 2 },
    fields: [
      { key: "entities", label: "Entities", kind: "entity-list", domains: ["light", "switch"] },
      { key: "expanded", label: "Start expanded", kind: "boolean" },
    ],
  },
  {
    type: "entity-toggle",
    label: "Entity toggle",
    description: "Generic on/off switch for any toggleable entity",
    defaultSpans: { cols: 2, rows: 1 },
    fields: [
      { key: "entity", label: "Entity", kind: "entity" },
      { key: "label", label: "Label", kind: "text", placeholder: "HA friendly name" },
    ],
  },
  {
    type: "home-power-flow",
    label: "Home power flow",
    description: "Live power flow between grid, solar, battery and home",
    defaultSpans: { cols: 2, rows: 2 },
    defaultVariant: "node-map",
    variants: [
      { id: "node-map", label: "Node map", description: "Circular nodes with flowing particles" },
      { id: "switchboard", label: "Switchboard", description: "Source cards feeding a bus rail" },
    ],
    fields: [
      {
        key: "solarEntity",
        label: "Solar power",
        kind: "entity",
        domains: ["sensor"],
        help: "Generation in W (or kW). Omit if you have no solar.",
      },
      {
        key: "gridEntity",
        label: "Grid power",
        kind: "entity",
        domains: ["sensor"],
        help: "Signed: positive = importing, negative = exporting.",
      },
      {
        key: "invertGrid",
        label: "Invert grid sign",
        kind: "boolean",
        help: "Enable if import/export are reversed (e.g. GoodWe meters).",
      },
      {
        key: "gridImportEntity",
        label: "Grid import",
        kind: "entity",
        domains: ["sensor"],
        help: "Only if you have no signed grid sensor — pair with Grid export.",
      },
      {
        key: "gridExportEntity",
        label: "Grid export",
        kind: "entity",
        domains: ["sensor"],
        help: "Only if you have no signed grid sensor — pair with Grid import.",
      },
      {
        key: "batteryEntity",
        label: "Battery power",
        kind: "entity",
        domains: ["sensor"],
        help: "Signed: positive = charging, negative = discharging.",
      },
      {
        key: "invertBattery",
        label: "Invert battery sign",
        kind: "boolean",
        help: "Enable if charging/discharging appear swapped.",
      },
      {
        key: "batteryChargeEntity",
        label: "Battery charge",
        kind: "entity",
        domains: ["sensor"],
        help: "Only if you have no signed battery sensor — pair with Battery discharge.",
      },
      {
        key: "batteryDischargeEntity",
        label: "Battery discharge",
        kind: "entity",
        domains: ["sensor"],
        help: "Only if you have no signed battery sensor — pair with Battery charge.",
      },
      {
        key: "batterySocEntity",
        label: "Battery charge %",
        kind: "entity",
        domains: ["sensor"],
        help: "State of charge, 0–100.",
      },
      {
        key: "homeEntity",
        label: "Home load",
        kind: "entity",
        domains: ["sensor"],
        help: "Optional — computed from the balance when omitted.",
      },
    ],
  },
];

export const widgetMetaByType: Record<string, WidgetMeta> = Object.fromEntries(
  widgetMeta.map((meta) => [meta.type, meta]),
);
