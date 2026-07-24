// E2E probe for the dashboard server WS protocol (Node 22 built-in WebSocket).
const TOPICS = ["demo/weather", "demo/energy", "demo/lights", "demo/calendar", "demo/now-playing"];
const ws = new WebSocket("ws://127.0.0.1:8090/ws");

const seen = new Set();
let actionSent = false;
let gotResult = false;
let gotFlip = false;

const fail = (msg) => {
	console.error("PROBE FAIL:", msg, "| topics seen:", [...seen].join(",") || "none");
	process.exit(1);
};
const timer = setTimeout(() => fail("timeout after 15s"), 15_000);

function maybeFinish() {
	if (gotResult && gotFlip) {
		clearTimeout(timer);
		console.log("PROBE OK: hello + 5 retained topics + action round-trip + push update");
		process.exit(0);
	}
}

ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", topics: TOPICS }));
ws.onerror = () => fail("websocket error (server up?)");

ws.onmessage = (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.type === "hello") {
		console.log(`HELLO v${msg.version} | server topics: ${msg.topics.join(", ")}`);
	} else if (msg.type === "data") {
		if (!seen.has(msg.topic)) {
			seen.add(msg.topic);
			console.log(`DATA  ${msg.topic}: ${JSON.stringify(msg.payload).slice(0, 100)}…`);
		}
		if (actionSent && msg.topic === "demo/lights") {
			const dining = msg.payload.lights.find((l) => l.id === "dining");
			if (dining?.on === true) {
				console.log("PUSH  demo/lights updated — dining flipped to ON");
				gotFlip = true;
				maybeFinish();
			}
		}
		if (seen.size === TOPICS.length && !actionSent) {
			actionSent = true;
			console.log("ACTION → demo light.toggle { id: dining }");
			ws.send(
				JSON.stringify({
					type: "action",
					id: "probe-1",
					integration: "demo",
					action: "light.toggle",
					params: { id: "dining" },
				}),
			);
		}
	} else if (msg.type === "action-result") {
		console.log(`RESULT ok=${msg.ok} result=${JSON.stringify(msg.result)}`);
		if (!msg.ok) fail(`action failed: ${msg.error}`);
		gotResult = true;
		maybeFinish();
	}
};
