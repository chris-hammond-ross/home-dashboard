import type {
  ActionHandler,
  IntegrationContext,
  IntegrationDefinition,
  IntegrationEntry,
  IntegrationInstance,
  Logger,
} from "@home-dashboard/shared";
import demoIntegration from "@home-dashboard/integration-demo";
import homeAssistantIntegration from "@home-dashboard/integration-home-assistant";
import type { TopicHub } from "./hub.js";

/**
 * Built-in integration kinds. Next up: kodi, calendar, weather, mqtt-devices.
 * Third-party/dynamic loading is a later concern.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new Map<string, IntegrationDefinition<any>>(
  [demoIntegration, homeAssistantIntegration].map((def) => [def.kind, def]),
);

interface RunningIntegration {
  id: string;
  instance: IntegrationInstance;
  timers: NodeJS.Timeout[];
}

export class PluginHost {
  private actions = new Map<string, ActionHandler>();
  private running: RunningIntegration[] = [];

  constructor(
    private hub: TopicHub,
    private makeLogger: (scope: string) => Logger,
  ) {}

  async start(entries: IntegrationEntry[]): Promise<void> {
    for (const entry of entries) {
      if (!entry.enabled) continue;
      const def = registry.get(entry.kind);
      if (!def) {
        throw new Error(
          `Unknown integration kind "${entry.kind}" (id "${entry.id}"). Known kinds: ${[...registry.keys()].join(", ")}`,
        );
      }
      const config: unknown = def.configSchema.parse(entry.config);
      const logger = this.makeLogger(entry.id);
      const timers: NodeJS.Timeout[] = [];
      const ctx: IntegrationContext = {
        id: entry.id,
        logger,
        publish: (stream, payload) => this.hub.publish(`${entry.id}/${stream}`, payload),
        registerAction: (name, handler) => {
          this.actions.set(`${entry.id}:${name}`, handler);
        },
        every: (ms, fn) => {
          const timer = setInterval(() => {
            void Promise.resolve()
              .then(fn)
              .catch((err: unknown) => logger.error("interval task failed:", err));
          }, ms);
          timers.push(timer);
        },
      };
      const instance = await def.create(ctx, config);
      this.running.push({ id: entry.id, instance, timers });
    }
  }

  async runAction(
    integration: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const handler = this.actions.get(`${integration}:${action}`);
    if (!handler) throw new Error(`Unknown action "${action}" on integration "${integration}"`);
    return await handler(params);
  }

  async dispose(): Promise<void> {
    for (const { instance, timers } of this.running) {
      for (const timer of timers) clearInterval(timer);
      await instance.dispose?.();
    }
    this.running = [];
    this.actions.clear();
  }
}
