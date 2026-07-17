import { useEffect, useState } from "react";
import type { ClientMessage, ServerMessage } from "@home-dashboard/shared";

type TopicListener = (payload: unknown) => void;
type StatusListener = (connected: boolean) => void;

export interface ActionResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * The single WebSocket to the server. Auto-reconnects with backoff,
 * re-subscribes after reconnect, and caches the latest payload per topic so
 * newly-mounted widgets render immediately.
 */
class DashboardSocket {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<TopicListener>>();
  private cache = new Map<string, unknown>();
  private pendingActions = new Map<string, { resolve: (r: ActionResult) => void; timer: number }>();
  private statusListeners = new Set<StatusListener>();
  private reconnectDelay = 1000;
  private started = false;
  connected = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  private connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.setConnected(true);
      const topics = [...this.listeners.keys()];
      if (topics.length) this.send({ type: "subscribe", topics });
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "data") {
        this.cache.set(msg.topic, msg.payload);
        this.listeners.get(msg.topic)?.forEach((fn) => fn(msg.payload));
      } else if (msg.type === "action-result") {
        const pending = this.pendingActions.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingActions.delete(msg.id);
          pending.resolve({ ok: msg.ok, result: msg.result, error: msg.error });
        }
      }
    };

    ws.onclose = () => {
      this.setConnected(false);
      this.ws = null;
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000);
    };

    ws.onerror = () => ws.close();
  }

  private setConnected(connected: boolean): void {
    this.connected = connected;
    this.statusListeners.forEach((fn) => fn(connected));
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  peek(topic: string | undefined): unknown {
    return topic ? this.cache.get(topic) : undefined;
  }

  subscribe(topic: string, listener: TopicListener): () => void {
    let set = this.listeners.get(topic);
    const isFirst = !set;
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
    }
    set.add(listener);
    const cached = this.cache.get(topic);
    if (cached !== undefined) listener(cached);
    if (isFirst) this.send({ type: "subscribe", topics: [topic] });

    return () => {
      const listeners = this.listeners.get(topic);
      listeners?.delete(listener);
      if (listeners && listeners.size === 0) {
        this.listeners.delete(topic);
        this.send({ type: "unsubscribe", topics: [topic] });
      }
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  action(
    integration: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<ActionResult> {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        this.pendingActions.delete(id);
        resolve({ ok: false, error: "action timed out" });
      }, 10_000);
      this.pendingActions.set(id, { resolve, timer });
      this.send({ type: "action", id, integration, action, params });
    });
  }
}

export const socket = new DashboardSocket();

/** Live value of a topic; undefined until the first payload arrives. */
export function useTopic<T>(topic: string | undefined): T | undefined {
  const [value, setValue] = useState<T | undefined>(() => socket.peek(topic) as T | undefined);
  useEffect(() => {
    if (!topic) return;
    return socket.subscribe(topic, (payload) => setValue(payload as T));
  }, [topic]);
  return value;
}

export function useConnected(): boolean {
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => socket.onStatus(setConnected), []);
  return connected;
}
