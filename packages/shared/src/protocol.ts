/**
 * The WebSocket protocol between the dashboard frontend and the server.
 *
 * The frontend opens ONE socket. Integrations publish retained payloads to
 * topics named `<integrationId>/<stream>` (e.g. `demo/weather`); subscribing
 * to a topic immediately delivers the retained value, then live updates.
 */

/** Messages sent by the frontend. */
export type ClientMessage =
  | { type: "subscribe"; topics: string[] }
  | { type: "unsubscribe"; topics: string[] }
  | {
      type: "action";
      /** Correlation id echoed back in the action-result. */
      id: string;
      /** Integration instance id from config, e.g. "demo". */
      integration: string;
      /** Action name registered by the integration, e.g. "light.toggle". */
      action: string;
      params?: Record<string, unknown>;
    }
  | { type: "ping" };

/** Messages sent by the server. */
export type ServerMessage =
  | { type: "hello"; version: string; topics: string[] }
  | { type: "data"; topic: string; payload: unknown; ts: number }
  | { type: "action-result"; id: string; ok: boolean; result?: unknown; error?: string }
  | { type: "pong" };

export function parseClientMessage(raw: string): ClientMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof msg !== "object" ||
    msg === null ||
    typeof (msg as { type?: unknown }).type !== "string"
  ) {
    return null;
  }
  return msg as ClientMessage;
}
