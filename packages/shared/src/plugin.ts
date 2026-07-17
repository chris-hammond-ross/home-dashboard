import type { ZodType } from "zod";

/**
 * Integration plugin SDK.
 *
 * An integration is a backend plugin that talks to one source (Home Assistant,
 * Kodi, a calendar, ...), publishes retained data to topics on the WS hub, and
 * optionally registers actions that widgets can call.
 */

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export type ActionHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

export interface IntegrationContext {
  /** Instance id from config; also the topic prefix (`<id>/<stream>`). */
  id: string;
  logger: Logger;
  /**
   * Publish a payload to `<id>/<stream>`. Payloads are retained: new
   * subscribers immediately receive the latest value.
   */
  publish(stream: string, payload: unknown): void;
  /** Register an action reachable from widgets as `integration=<id>, action=<name>`. */
  registerAction(name: string, handler: ActionHandler): void;
  /** `setInterval` that is automatically cleared when the integration is disposed. */
  every(ms: number, fn: () => void | Promise<void>): void;
}

export interface IntegrationInstance {
  /** Called on shutdown / config reload. Timers from `ctx.every` are cleared for you. */
  dispose?(): void | Promise<void>;
}

export interface IntegrationDefinition<TConfig = unknown> {
  /** Unique kind, referenced from config `integrations[].kind`, e.g. "home-assistant". */
  kind: string;
  /** Zod schema for this integration's `config` block; doubles as documentation. */
  configSchema: ZodType<TConfig>;
  create(
    ctx: IntegrationContext,
    config: TConfig,
  ): IntegrationInstance | Promise<IntegrationInstance>;
}

/** Identity helper for type inference when authoring integrations. */
export function defineIntegration<TConfig>(
  def: IntegrationDefinition<TConfig>,
): IntegrationDefinition<TConfig> {
  return def;
}
