#!/usr/bin/env node
// Screens REST + WS smoke test. Run against a SCRATCH server (spare port +
// scratch config/DB — see CLAUDE.md "Verifying changes"), not your live :8090:
// it creates, mutates, and deletes probe screens, then restores order/default.
//
//   node apps/server/scripts/screens-probe.mjs [--server http://127.0.0.1:8099]
//
// Read-only towards Home Assistant; never calls toggle/call-service.

const args = process.argv.slice(2);
const serverIdx = args.indexOf("--server");
const BASE = (serverIdx >= 0 && args[serverIdx + 1]) || "http://127.0.0.1:8099";
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const fail = (name, detail) => {
	failures++;
	console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
};
const assert = (cond, name, detail) => (cond ? ok(name) : fail(name, detail));

async function api(method, path, body) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: body ? { "content-type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	let json = null;
	try {
		json = await res.json();
	} catch {
		/* no body */
	}
	return { status: res.status, body: json };
}

// ── WS client collecting core/screens pushes and running actions ──────────────
const pushes = [];
const pendingActions = new Map();
const ws = new WebSocket(WS_URL);
await new Promise((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error("WS open timeout")), 5000);
	ws.onopen = () => {
		clearTimeout(timer);
		ws.send(JSON.stringify({ type: "subscribe", topics: ["core/screens"] }));
		resolve();
	};
	ws.onerror = () => reject(new Error(`cannot connect to ${WS_URL}`));
});
ws.onmessage = (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.type === "data" && msg.topic === "core/screens") pushes.push(msg.payload);
	if (msg.type === "action-result") pendingActions.get(msg.id)?.(msg);
};

const waitForPush = (predicate, name, timeoutMs = 3000) =>
	new Promise((resolve) => {
		const started = Date.now();
		const check = () => {
			const hit = pushes.find(predicate);
			if (hit) {
				ok(name);
				return resolve(hit);
			}
			if (Date.now() - started > timeoutMs) {
				fail(name, "timed out waiting for core/screens push");
				return resolve(null);
			}
			setTimeout(check, 50);
		};
		check();
	});

const action = (integration, name, params) =>
	new Promise((resolve) => {
		const id = `probe-${Math.random().toString(36).slice(2)}`;
		const timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), 5000);
		pendingActions.set(id, (msg) => {
			clearTimeout(timer);
			pendingActions.delete(id);
			resolve(msg);
		});
		ws.send(JSON.stringify({ type: "action", id, integration, action: name, params }));
	});

console.log(`screens-probe → ${BASE}`);

// ── baseline ──────────────────────────────────────────────────────────────────
const health = await api("GET", "/api/health");
assert(health.status === 200 && health.body?.ok, "GET /api/health");

const initial = await api("GET", "/api/screens");
assert(
	initial.status === 200 && Array.isArray(initial.body?.screens) && initial.body?.ambient,
	"GET /api/screens returns { ambient, screens }",
);
const initialScreens = initial.body.screens;
const initialIds = initialScreens.map((s) => s.id);
const initialDefault = initialScreens.find((s) => s.default)?.id;
assert(
	initialScreens.length === 0 || initialScreens.filter((s) => s.default).length === 1,
	"exactly one default screen (or none when empty)",
);

await waitForPush((p) => Array.isArray(p), "core/screens is retained on subscribe");

// ── create (slug + uniquify) ──────────────────────────────────────────────────
const created = await api("POST", "/api/screens", { name: "Probe Screen" });
assert(
	created.status === 201 && created.body?.id === "probe-screen",
	"POST create → 201 probe-screen",
);
await waitForPush((p) => p.some?.((s) => s.id === "probe-screen"), "create pushed on core/screens");
const dup = await api("POST", "/api/screens", { name: "Probe Screen" });
assert(dup.status === 201 && dup.body?.id === "probe-screen-2", "duplicate name → probe-screen-2");

// ── update = adoption, entity hint fan-out must not break the server ──────────
const put = await api("PUT", "/api/screens/probe-screen", {
	name: "Probe Screen",
	columns: 4,
	generated: true, // server must force this back to false
	widgets: [{ type: "entity-toggle", cols: 2, rows: 1, props: { entity: "light.probe_fake" } }],
});
assert(
	put.status === 200 && put.body?.generated === false && put.body?.widgets?.length === 1,
	"PUT stores widgets and forces generated=false (adoption)",
);
assert((await api("GET", "/api/health")).status === 200, "server alive after entity-hints fan-out");

// ── list-entities works even with HA down ─────────────────────────────────────
const list = await action("ha", "list-entities", {});
assert(list.ok === true && Array.isArray(list.result), "ha:list-entities → ok (HA may be down)");

// ── reorder ───────────────────────────────────────────────────────────────────
const allIds = (await api("GET", "/api/screens")).body.screens.map((s) => s.id);
const reversed = [...allIds].reverse();
const reorder = await api("POST", "/api/screens/reorder", { ids: reversed });
assert(reorder.status === 200, "reorder with full permutation");
const afterReorder = (await api("GET", "/api/screens")).body.screens.map((s) => s.id);
assert(JSON.stringify(afterReorder) === JSON.stringify(reversed), "order persisted");
const badReorder = await api("POST", "/api/screens/reorder", { ids: reversed.slice(1) });
assert(badReorder.status === 400, "reorder missing an id → 400");

// ── default handling ──────────────────────────────────────────────────────────
assert((await api("POST", "/api/screens/probe-screen/default")).status === 200, "set default");
let screensNow = (await api("GET", "/api/screens")).body.screens;
assert(screensNow.find((s) => s.default)?.id === "probe-screen", "default moved");
assert((await api("DELETE", "/api/screens/probe-screen")).status === 200, "delete default screen");
screensNow = (await api("GET", "/api/screens")).body.screens;
assert(
	!screensNow.some((s) => s.id === "probe-screen") &&
		(screensNow.length === 0 || screensNow.filter((s) => s.default).length === 1),
	"default promoted after deleting the default",
);

// ── error paths ───────────────────────────────────────────────────────────────
assert(
	(await api("PUT", "/api/screens/nope", { name: "x" })).status === 404,
	"PUT unknown id → 404",
);
assert(
	(await api("POST", "/api/screens", { name: "Bad", columns: 99 })).status === 400,
	"invalid columns → 400 (Zod)",
);

// ── cleanup: restore initial order + default ──────────────────────────────────
await api("DELETE", "/api/screens/probe-screen-2");
const remaining = (await api("GET", "/api/screens")).body.screens.map((s) => s.id);
if (JSON.stringify([...remaining].sort()) === JSON.stringify([...initialIds].sort())) {
	await api("POST", "/api/screens/reorder", { ids: initialIds });
	if (initialDefault) await api("POST", `/api/screens/${initialDefault}/default`);
	const restored = (await api("GET", "/api/screens")).body.screens;
	assert(
		JSON.stringify(restored.map((s) => s.id)) === JSON.stringify(initialIds) &&
			restored.find((s) => s.default)?.id === initialDefault,
		"cleanup restored initial order + default",
	);
} else {
	fail("cleanup", `screen set drifted: ${remaining.join(",")} vs ${initialIds.join(",")}`);
}

ws.close();
if (failures) {
	console.error(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log("\nAll checks passed.");
process.exit(0);
