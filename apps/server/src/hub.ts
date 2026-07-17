import type { WebSocket } from "ws";
import type { ServerMessage } from "@home-dashboard/shared";

/**
 * In-memory topic hub. Every published payload is retained, so a subscriber
 * immediately receives the latest value for each topic it subscribes to.
 */
export class TopicHub {
  private retained = new Map<string, { payload: unknown; ts: number }>();
  private subscribers = new Map<string, Set<WebSocket>>();

  topics(): string[] {
    return [...this.retained.keys()].sort();
  }

  publish(topic: string, payload: unknown): void {
    const ts = Date.now();
    this.retained.set(topic, { payload, ts });
    const subs = this.subscribers.get(topic);
    if (!subs?.size) return;
    const msg = JSON.stringify({ type: "data", topic, payload, ts } satisfies ServerMessage);
    for (const socket of subs) {
      if (socket.readyState === socket.OPEN) socket.send(msg);
    }
  }

  subscribe(socket: WebSocket, topics: string[]): void {
    for (const topic of topics) {
      let set = this.subscribers.get(topic);
      if (!set) {
        set = new Set();
        this.subscribers.set(topic, set);
      }
      set.add(socket);
      const retained = this.retained.get(topic);
      if (retained && socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "data",
            topic,
            payload: retained.payload,
            ts: retained.ts,
          } satisfies ServerMessage),
        );
      }
    }
  }

  unsubscribe(socket: WebSocket, topics: string[]): void {
    for (const topic of topics) this.subscribers.get(topic)?.delete(socket);
  }

  /** Remove a socket from every topic (on disconnect). */
  drop(socket: WebSocket): void {
    for (const set of this.subscribers.values()) set.delete(socket);
  }
}
