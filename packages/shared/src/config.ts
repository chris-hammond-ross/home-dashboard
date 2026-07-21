import { z } from "zod";

/**
 * User-facing configuration (YAML). This schema is the single source of truth:
 * it validates config at startup and is exported as JSON Schema for editor
 * autocomplete (see docs).
 */

const idPattern = /^[a-z0-9][a-z0-9-]*$/;

export const WidgetSchema = z.object({
  /** Widget type from the frontend registry, e.g. "clock", "weather", "light". */
  type: z.string(),
  title: z.string().optional(),
  /**
   * Which visual variant of the widget to render, for types that register more
   * than one (see the frontend registry). Omit to use the type's default variant.
   */
  variant: z.string().optional(),
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
  /** True on screens owned by `pnpm onboard` — re-running onboarding replaces them. */
  generated: z.boolean().default(false),
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

export const StorageConfigSchema = z.object({
  /**
   * SQLite database file. Relative paths resolve against the config file's
   * directory, so the default lands at <repo>/data/dashboard.db.
   */
  path: z.string().default("../data/dashboard.db"),
});
export type StorageConfig = z.infer<typeof StorageConfigSchema>;

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
  storage: StorageConfigSchema.default({ path: "../data/dashboard.db" }),
  integrations: z.array(IntegrationEntrySchema).default([]),
  /**
   * First-boot seed only: imported into SQLite when the database is empty;
   * thereafter the database owns screens (edit them at #/settings).
   */
  screens: z.array(ScreenSchema).default([]),
});
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;

/** Body of POST /api/screens — id optional (server slugifies name when absent). */
export const CreateScreenSchema = ScreenSchema.partial({ id: true });
export type CreateScreenInput = z.infer<typeof CreateScreenSchema>;

/** Body of PUT /api/screens/:id — id comes from the URL, never the body. */
export const UpdateScreenSchema = ScreenSchema.omit({ id: true });
export type UpdateScreenInput = z.infer<typeof UpdateScreenSchema>;

/** Body of POST /api/screens/reorder — must list every screen id exactly once. */
export const ReorderScreensSchema = z.object({ ids: z.array(z.string()) });

/** Body of PUT /api/screens/generated — bulk replace of onboarding-owned screens. */
export const ReplaceGeneratedSchema = z.object({ screens: z.array(ScreenSchema) });

/** The shape served to the frontend by GET /api/screens. */
export interface FrontendBootstrap {
  ambient: AmbientConfig;
  screens: ScreenConfig[];
}
