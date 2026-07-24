import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { parseClientMessage, type ServerMessage } from "@home-dashboard/shared";
import type { TopicHub } from "./hub.js";
import type { PluginHost } from "./plugins.js";

function send(socket: WebSocket, msg: ServerMessage): void {
	if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

export function registerWs(
	app: FastifyInstance,
	hub: TopicHub,
	host: PluginHost,
	version: string,
): void {
	app.get("/ws", { websocket: true }, (socket: WebSocket) => {
		send(socket, { type: "hello", version, topics: hub.topics() });

		socket.on("message", (raw: Buffer) => {
			const msg = parseClientMessage(raw.toString());
			if (!msg) return;
			switch (msg.type) {
				case "subscribe":
					hub.subscribe(socket, msg.topics);
					break;
				case "unsubscribe":
					hub.unsubscribe(socket, msg.topics);
					break;
				case "ping":
					send(socket, { type: "pong" });
					break;
				case "action":
					void host
						.runAction(msg.integration, msg.action, msg.params ?? {})
						.then((result) =>
							send(socket, { type: "action-result", id: msg.id, ok: true, result }),
						)
						.catch((err: unknown) =>
							send(socket, {
								type: "action-result",
								id: msg.id,
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							}),
						);
					break;
			}
		});

		socket.on("close", () => hub.drop(socket));
	});
}
