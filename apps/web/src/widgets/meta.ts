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

export interface WidgetMeta {
  type: string;
  label: string;
  description: string;
  defaultSpans: { cols: number; rows: number };
  fields: PropField[];
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
    description: "Current conditions from a weather topic",
    defaultSpans: { cols: 2, rows: 1 },
    fields: [{ key: "topic", label: "Topic", kind: "topic", placeholder: "demo/weather" }],
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
];

export const widgetMetaByType: Record<string, WidgetMeta> = Object.fromEntries(
  widgetMeta.map((meta) => [meta.type, meta]),
);
