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
import weatherIntegration from "@home-dashboard/integration-weather";
import type { TopicHub } from "./hub.js";

/**
 * Built-in integration kinds. Next up: kodi, calendar, mqtt-devices.
 * Third-party/dynamic loading is a later concern.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new Map<string, IntegrationDefinition<any>>(
	[demoIntegration, homeAssistantIntegration, weatherIntegration].map((def) => [def.kind, def]),
);

interface RunningIntegration {
	id: string;
	instance: IntegrationInstance;
	timers: NodeJS.Timeout[];
}

export class PluginHost {
	private actions = new Map<string, ActionHandler>();
	private running: RunningIntegration[] = [];
	private log: Logger;

	constructor(
		private hub: TopicHub,
		private makeLogger: (scope: string) => Logger,
	) {
		this.log = makeLogger("plugins");
	}

	async start(entries: IntegrationEntry[]): Promise<void> {
		for (const entry of entries) {
			if (!entry.enabled) continue;
			if (entry.id === "core") {
				throw new Error('integration id "core" is reserved for server-published topics');
			}
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

	/** Invoke an action on every integration that registered it; log-and-continue on error. */
	async runActionEverywhere(action: string, params: Record<string, unknown>): Promise<void> {
		for (const [key, handler] of this.actions) {
			if (!key.endsWith(`:${action}`)) continue;
			try {
				await handler(params);
			} catch (err) {
				this.log.warn(`action "${key}" failed:`, err);
			}
		}
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
