import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  callService,
  ERR_INVALID_AUTH,
  type Connection,
  type HassEntities,
} from "home-assistant-js-websocket";
import { defineIntegration } from "@home-dashboard/shared";
import { z } from "zod";

/**
 * Home Assistant integration.
 *
 * Connects server-side to HA's WebSocket API with a long-lived access token
 * (the token never reaches the browser). Uses Node's built-in WebSocket.
 *
 * Streams:
 *   <id>/status              { connected, haVersion?, error? }
 *   <id>/states              compact map: { [entityId]: { state, friendlyName } }
 *   <id>/entity/<entityId>   full state: { entityId, state, attributes, lastChanged, lastUpdated }
 *
 * Actions:
 *   toggle        { entity_id }                    → homeassistant.toggle
 *   call-service  { domain, service, data?, target? }
 */

const HaConfigSchema = z.object({
  /** Base URL of your Home Assistant instance. */
  url: z.url().default("http://homeassistant.local:8123"),
  /** Long-lived access token (Profile → Security → Long-lived access tokens). */
  token: z.string().min(1, "home-assistant: token is required"),
  /**
   * Entities to publish (e.g. ["light.study_lamp"]). Omit to publish ALL
   * entities — fine on a LAN, but an allowlist keeps traffic and topics tidy.
   */
  entities: z.array(z.string()).optional(),
});

const CallServiceParams = z.object({
  domain: z.string(),
  service: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  target: z
    .object({
      entity_id: z.union([z.string(), z.array(z.string())]).optional(),
      device_id: z.union([z.string(), z.array(z.string())]).optional(),
      area_id: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .optional(),
});

function describeError(err: unknown): string {
  if (err === ERR_INVALID_AUTH) return "invalid auth — check your long-lived access token";
  if (typeof err === "number") return `connection failed (haws error ${err})`;
  return err instanceof Error ? err.message : String(err);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const homeAssistantIntegration = defineIntegration({
  kind: "home-assistant",
  configSchema: HaConfigSchema,
  create(ctx, config) {
    let conn: Connection | null = null;
    let unsubscribeEntities: (() => void) | null = null;
    let disposed = false;
    let lastEntities: HassEntities = {};
    let warnedMissing = false;

    const publishStatus = (connected: boolean, extra?: { haVersion?: string; error?: string }) =>
      ctx.publish("status", { connected, url: config.url, ...extra });

    const onEntities = (entities: HassEntities) => {
      const wanted: HassEntities = config.entities?.length
        ? Object.fromEntries(
            config.entities.filter((id) => entities[id]).map((id) => [id, entities[id]!]),
          )
        : entities;

      if (config.entities?.length && !warnedMissing) {
        const missing = config.entities.filter((id) => !(id in entities));
        if (missing.length) {
          warnedMissing = true;
          ctx.logger.warn(
            `configured entities not found in Home Assistant: ${missing.join(", ")} ` +
              `(check the ids with \`pnpm ha:explore\`)`,
          );
        }
      }

      const summary: Record<string, { state: string; friendlyName?: string }> = {};
      for (const [id, entity] of Object.entries(wanted)) {
        const friendlyName = entity.attributes.friendly_name as string | undefined;
        summary[id] = { state: entity.state, friendlyName };
        // haws reuses unchanged entity objects, so a reference change = a real update
        if (lastEntities[id] !== entity) {
          ctx.publish(`entity/${id}`, {
            entityId: id,
            state: entity.state,
            attributes: entity.attributes,
            lastChanged: entity.last_changed,
            lastUpdated: entity.last_updated,
          });
        }
      }
      ctx.publish("states", summary);
      lastEntities = entities;
    };

    const connect = async (): Promise<void> => {
      while (!disposed) {
        try {
          const auth = createLongLivedTokenAuth(config.url, config.token);
          conn = await createConnection({ auth });
          ctx.logger.info(`connected to Home Assistant ${conn.haVersion} at ${config.url}`);
          publishStatus(true, { haVersion: conn.haVersion });
          // haws auto-reconnects established connections; reflect it in status
          conn.addEventListener("disconnected", () => publishStatus(false));
          conn.addEventListener("ready", () => publishStatus(true, { haVersion: conn?.haVersion }));
          unsubscribeEntities = subscribeEntities(conn, onEntities);
          return;
        } catch (err) {
          if (err === ERR_INVALID_AUTH) {
            publishStatus(false, { error: "invalid-auth" });
            ctx.logger.error(
              `Home Assistant rejected the token (${config.url}). ` +
                `Fix the token in your config and restart — not retrying.`,
            );
            return;
          }
          publishStatus(false);
          ctx.logger.warn(
            `Home Assistant unreachable at ${config.url} (${describeError(err)}); retrying in 10s`,
          );
          await sleep(10_000);
        }
      }
    };

    const requireConnection = (): Connection => {
      if (!conn || !conn.connected) throw new Error("Home Assistant is not connected");
      return conn;
    };

    ctx.registerAction("toggle", async (params) => {
      const entityId = params.entity_id;
      if (typeof entityId !== "string" || !entityId) throw new Error("entity_id is required");
      await callService(requireConnection(), "homeassistant", "toggle", undefined, {
        entity_id: entityId,
      });
      return { toggled: entityId };
    });

    ctx.registerAction("call-service", async (params) => {
      const { domain, service, data, target } = CallServiceParams.parse(params);
      await callService(requireConnection(), domain, service, data, target);
      return { called: `${domain}.${service}` };
    });

    publishStatus(false); // topic exists immediately; flips to true on connect
    void connect();

    return {
      dispose() {
        disposed = true;
        unsubscribeEntities?.();
        conn?.close();
      },
    };
  },
});

export default homeAssistantIntegration;
