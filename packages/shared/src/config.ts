import { z } from "zod";

/**
 * User-facing configuration (YAML). This schema is the single source of truth:
 * it validates config at startup and is exported as JSON Schema for editor
 * autocomplete (see docs).
 */

const idPattern = /^[a-z0-9][a-z0-9-]*$/;

export const WidgetSchema = z.object({
  /** Widget type from the frontend registry, e.g. "clock", "weather", "lights". */
  type: z.string(),
  title: z.string().optional(),
  /** Grid spans; widgets flow in declaration order. */
  cols: z.number().int().min(1).default(1),
  rows: z.number().int().min(1).default(1),
  /** Widget-specific props, e.g. { topic: "demo/weather" }. */
  props: z.record(z.string(), z.unknown()).default({}),
});
export type WidgetConfig = z.infer<typeof WidgetSchema>;

export const ScreenSchema = z.object({
  id: z.string().regex(idPattern),
  name: z.string(),
  /** Grid columns for this screen (portrait 43" works well with 4). */
  columns: z.number().int().min(1).max(12).default(4),
  default: z.boolean().default(false),
  widgets: z.array(WidgetSchema).default([]),
});
export type ScreenConfig = z.infer<typeof ScreenSchema>;

export const IntegrationEntrySchema = z.object({
  /** Instance id — also the topic prefix. Unique per entry. */
  id: z.string().regex(idPattern),
  /** Which integration package handles this entry. */
  kind: z.string(),
  enabled: z.boolean().default(true),
  /** Validated by the integration's own configSchema. */
  config: z.record(z.string(), z.unknown()).default({}),
});
export type IntegrationEntry = z.infer<typeof IntegrationEntrySchema>;

export const AmbientConfigSchema = z.object({
  /** Seconds of inactivity before the ambient (lock) screen appears. */
  idleSeconds: z.number().int().min(10).default(120),
  /** On wake, restore the previous view if last interaction was within this window. */
  resumeWindowMinutes: z.number().int().min(0).default(60),
  /** Topic for the ambient weather line, e.g. "demo/weather". Omit to hide. */
  weatherTopic: z.string().optional(),
  /** Topic for the ambient "next up" event line, e.g. "demo/calendar". Omit to hide. */
  calendarTopic: z.string().optional(),
});
export type AmbientConfig = z.infer<typeof AmbientConfigSchema>;

export const DashboardConfigSchema = z.object({
  server: z
    .object({
      host: z.string().default("0.0.0.0"),
      port: z.number().int().default(8090),
    })
    .default({ host: "0.0.0.0", port: 8090 }),
  ambient: AmbientConfigSchema.default({ idleSeconds: 120, resumeWindowMinutes: 60 }),
  integrations: z.array(IntegrationEntrySchema).default([]),
  screens: z.array(ScreenSchema).min(1),
});
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;

/** The shape served to the frontend by GET /api/screens. */
export interface FrontendBootstrap {
  ambient: AmbientConfig;
  screens: ScreenConfig[];
}
