#!/usr/bin/env node
// Tariff + energy-history smoke test. Run against a SCRATCH server (spare port +
// scratch config/DB — see CLAUDE.md "Verifying changes"), not your live :8090:
// it creates and deletes probe tariffs.
//
//   node apps/server/scripts/energy-probe.mjs [--server http://127.0.0.1:8099]
//
// The scratch config must enable the `demo` integration: its `statistics` action
// answers in the same shape as Home Assistant's, deterministically, so the whole
// pipeline (statistics → flow allocation → time-of-use pricing → bucketing) is
// exercised with no HA and no recorder.
//
// Read-only towards Home Assistant; never calls toggle/call-service.

const args = process.argv.slice(2);
const serverIdx = args.indexOf("--server");
const BASE = (serverIdx >= 0 && args[serverIdx + 1]) || "http://127.0.0.1:8099";
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";
const LIVE = args.includes("--live-aer");

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const fail = (name, detail) => {
	failures++;
	console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
};
const assert = (cond, name, detail) => (cond ? ok(name) : fail(name, detail));
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

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

// ── WS client collecting core/tariff pushes ──────────────────────────────────
const pushes = [];
const ws = new WebSocket(WS_URL);
await new Promise((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error("WS open timeout")), 5000);
	ws.onopen = () => {
		clearTimeout(timer);
		ws.send(JSON.stringify({ type: "subscribe", topics: ["core/tariff"] }));
		resolve();
	};
	ws.onerror = () => reject(new Error(`cannot connect to ${WS_URL}`));
});
ws.onmessage = (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.type === "data" && msg.topic === "core/tariff") pushes.push(msg.payload);
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
				fail(name, "timed out waiting for a core/tariff push");
				return resolve(null);
			}
			setTimeout(check, 50);
		};
		check();
	});

console.log(`energy-probe → ${BASE}`);

const health = await api("GET", "/api/health");
assert(health.status === 200 && health.body?.ok, "GET /api/health");

const initialTariffs = (await api("GET", "/api/tariffs")).body?.tariffs ?? [];
const initialActive = initialTariffs.find((t) => t.active)?.id ?? null;
await waitForPush((p) => p && "tariff" in p, "core/tariff is retained on subscribe");

// ── a plain flat tariff, so hand-checking totals is trivial ──────────────────
// UTC keeps the probe's expected values independent of the host's zone.
const flat = {
	id: "probe-flat",
	name: "Probe flat",
	timezone: "UTC",
	dailySupplyCents: 100,
	importBlocks: [{ id: "flat", label: "Usage", kind: "flat", centsPerKwh: 30, windows: [] }],
	exportBlocks: [{ id: "fit", label: "Feed-in", kind: "flat", centsPerKwh: 5, windows: [] }],
};
const createdFlat = await api("POST", "/api/tariffs", flat);
assert(createdFlat.status === 201, "POST /api/tariffs creates a tariff", createdFlat.body?.error);

await api("POST", "/api/tariffs/probe-flat/active");
const flatState = await waitForPush(
	(p) => p?.tariff?.id === "probe-flat",
	"core/tariff re-broadcasts on activation",
);
assert(flatState?.band?.centsPerKwh === 30, "active band resolves to the flat rate");
assert(flatState?.exportCentsPerKwh === 5, "feed-in rate resolves");

// ── history over a fixed past week, priced flat ─────────────────────────────
const end = new Date("2026-07-08T00:00:00.000Z").toISOString();
const start = new Date("2026-07-01T00:00:00.000Z").toISOString();
const roles = {
	solar: { statisticId: "sensor.demo_solar_energy", kind: "energy" },
	gridImport: { statisticId: "sensor.demo_grid_import", kind: "energy" },
	gridExport: { statisticId: "sensor.demo_grid_export", kind: "energy" },
	batteryCharge: { statisticId: "sensor.demo_battery_charge", kind: "energy" },
	batteryDischarge: { statisticId: "sensor.demo_battery_discharge", kind: "energy" },
	home: { statisticId: "sensor.demo_home_energy", kind: "energy" },
};

const hourly = await api("POST", "/api/energy/history", {
	integration: "demo",
	roles,
	start,
	end,
	bucket: "hour",
});
assert(hourly.status === 200, "POST /api/energy/history", hourly.body?.error);
const hourBuckets = hourly.body?.buckets ?? [];
assert(hourBuckets.length === 24 * 7, `hour bucket count is 168 (got ${hourBuckets.length})`);
assert(hourly.body?.estimated === false, "energy statistics are not flagged as estimated");
assert((hourly.body?.missing ?? []).length === 0, "no roles missing");

const daily = await api("POST", "/api/energy/history", {
	integration: "demo",
	roles,
	start,
	end,
	bucket: "day",
});
const dayBuckets = daily.body?.buckets ?? [];
assert(dayBuckets.length === 7, `day bucket count is 7 (got ${dayBuckets.length})`);

// Bucketing must be lossless: the same hours, grouped differently.
const sumKwh = (buckets, role) => buckets.reduce((s, b) => s + b.kwh[role], 0);
assert(
	near(sumKwh(hourBuckets, "gridImport"), sumKwh(dayBuckets, "gridImport"), 0.001),
	"day buckets total the same grid import as hour buckets",
);
assert(
	near(sumKwh(hourBuckets, "gridImport"), hourly.body.totals.kwh.gridImport, 0.001),
	"totals match the sum of buckets",
);

// The house is fed by solar + battery + grid and nothing else.
const totals = hourly.body.totals;
assert(
	near(totals.mix.solar + totals.mix.battery + totals.mix.grid, totals.kwh.home, 0.05),
	"consumption mix adds up to home consumption",
);

// Flat pricing is checkable by hand: kWh × 30c, credit × 5c, $1/day × 7 days.
const cost = hourly.body.cost;
assert(cost !== null, "cost is present when a tariff is active");
assert(
	near(cost.importCents, totals.kwh.gridImport * 30, 0.5),
	`import cost = kWh × 30c (${cost?.importCents?.toFixed(1)} vs ${(totals.kwh.gridImport * 30).toFixed(1)})`,
);
assert(
	near(cost.exportCents, totals.kwh.gridExport * 5, 0.5),
	"feed-in credit = exported kWh × 5c",
);
assert(near(cost.supplyCents, 700, 0.001), "supply charge = 100c × 7 days");
assert(
	near(cost.netCents, cost.importCents + cost.supplyCents - cost.exportCents, 0.001),
	"net = import + supply − feed-in",
);
assert(typeof cost.previousNetCents === "number", "previous period is costed for comparison");

// ── time-of-use: same energy, split across bands ────────────────────────────
// Peak 06:00–21:59 UTC at 60c, off-peak the rest at 10c. Every hour must land
// in exactly one band, and the two must re-total the flat-rate consumption.
const tou = {
	id: "probe-tou",
	name: "Probe TOU",
	timezone: "UTC",
	dailySupplyCents: 0,
	importBlocks: [
		{
			id: "peak",
			label: "Peak",
			kind: "peak",
			centsPerKwh: 60,
			windows: [
				{
					days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
					startMin: 360,
					endMin: 1320,
				},
			],
		},
		{ id: "offpeak", label: "Off peak", kind: "offpeak", centsPerKwh: 10, windows: [] },
	],
	exportBlocks: [],
};
const createdTou = await api("POST", "/api/tariffs", tou);
assert(
	createdTou.status === 201,
	"POST /api/tariffs creates the TOU tariff",
	createdTou.body?.error,
);
await api("POST", "/api/tariffs/probe-tou/active");
await waitForPush((p) => p?.tariff?.id === "probe-tou", "core/tariff switches to the TOU plan");

const touHistory = await api("POST", "/api/energy/history", {
	integration: "demo",
	roles,
	start,
	end,
	bucket: "hour",
});
const touCost = touHistory.body?.cost;
const bands = Object.fromEntries((touCost?.byBand ?? []).map((b) => [b.blockId, b]));
assert(bands.peak && bands.offpeak, "both bands received consumption");
assert(
	near((bands.peak?.kwh ?? 0) + (bands.offpeak?.kwh ?? 0), totals.kwh.gridImport, 0.01),
	"peak + off-peak kWh re-total the grid import",
);
assert(
	near(bands.peak?.cents ?? 0, (bands.peak?.kwh ?? 0) * 60, 0.5) &&
		near(bands.offpeak?.cents ?? 0, (bands.offpeak?.kwh ?? 0) * 10, 0.5),
	"each band is priced at its own rate",
);
assert(
	(touCost?.importCents ?? 0) > (cost?.importCents ?? 0),
	"the 60c/10c plan costs more than the flat 30c plan on this profile",
);

// Per-hour band attribution: an hour at 03:00 UTC is off-peak, 12:00 is peak.
const at = (iso) => hourBuckets.length && touHistory.body.buckets.find((b) => b.start === iso);
const offpeakHour = at("2026-07-01T03:00:00.000Z");
const peakHour = at("2026-07-01T12:00:00.000Z");
const bandsOf = (bucket) => Object.keys(bucket?.centsByBand ?? {});
assert(
	offpeakHour && JSON.stringify(bandsOf(offpeakHour)) === '["offpeak"]',
	"03:00 UTC is billed off-peak",
	`bands: ${JSON.stringify(bandsOf(offpeakHour))}`,
);
// Midday exports rather than imports on this profile, so the assertion is that
// nothing is billed at peak *except* peak — an empty hour is a legitimate pass.
assert(
	peakHour && bandsOf(peakHour).every((k) => k === "peak"),
	"12:00 UTC is billed peak (or not at all — solar covers it)",
	`bands: ${JSON.stringify(bandsOf(peakHour))}`,
);

// ── power-sensor fallback ───────────────────────────────────────────────────
// A watt sensor's hourly mean ÷ 1000 is that hour's kWh, so the same profile
// read as power must total the same energy — just flagged as estimated.
const viaPower = await api("POST", "/api/energy/history", {
	integration: "demo",
	roles: {
		gridImport: { statisticId: "sensor.demo_grid_import", kind: "power" },
		home: { statisticId: "sensor.demo_home_energy", kind: "power" },
	},
	start,
	end,
	bucket: "day",
});
assert(viaPower.status === 200, "history works from power sensors", viaPower.body?.error);
assert(viaPower.body?.estimated === true, "power-derived history is flagged estimated");
assert(
	near(viaPower.body?.totals.kwh.gridImport ?? 0, totals.kwh.gridImport, 0.01),
	"integrated power matches the energy statistic",
);

// ── validation ──────────────────────────────────────────────────────────────
const badRange = await api("POST", "/api/energy/history", {
	integration: "demo",
	roles,
	start: end,
	end: start,
	bucket: "day",
});
assert(badRange.status === 400, "reversed range is rejected with 400");

const noRoles = await api("POST", "/api/energy/history", {
	integration: "demo",
	roles: {},
	start,
	end,
	bucket: "day",
});
assert(noRoles.status === 400, "empty role set is rejected with 400");

// ── AER lookup (opt-in: hits the live public CDR mirror) ────────────────────
if (LIVE) {
	const retailers = await api("GET", "/api/tariffs/retailers");
	const list = retailers.body?.retailers ?? [];
	assert(
		retailers.status === 200 && list.length > 20,
		"GET /api/tariffs/retailers lists the CDR brands",
		retailers.body?.error,
	);
	// EVERY row must be selectable. Only ~40% of register entries carry a
	// dataHolderBrandId, so keying on it left most retailers with no id and the
	// picker threw on them — spot-checking one big retailer hid that entirely.
	const idless = list.filter((r) => !r.id || !r.name);
	assert(
		idless.length === 0,
		`every retailer has an id and a name (${list.length} listed)`,
		idless
			.slice(0, 5)
			.map((r) => r.name ?? "?")
			.join(", "),
	);
	assert(new Set(list.map((r) => r.id)).size === list.length, "retailer ids are unique");
	// A retailer that has no dataHolderBrandId in the register must work too.
	const mirrorOnly = list.find((r) => r.name === "Ampol Energy") ?? list[0];
	if (mirrorOnly) {
		const res = await api("GET", `/api/tariffs/plans?retailer=${mirrorOnly.id}&postcode=5000`);
		assert(
			res.status === 200 || res.status === 502,
			`mirror-only retailer resolves or fails cleanly (${mirrorOnly.name})`,
			`HTTP ${res.status}`,
		);
	}

	const agl = list.find((r) => r.name === "AGL");
	if (agl) {
		const plans = await api("GET", `/api/tariffs/plans?retailer=${agl.id}&postcode=5000`);
		assert(
			plans.status === 200 && (plans.body?.plans?.length ?? 0) > 0,
			"GET /api/tariffs/plans returns AGL plans for postcode 5000",
			plans.body?.error,
		);
		const first = plans.body?.plans?.[0];
		if (first) {
			const draft = await api(
				"GET",
				`/api/tariffs/plans/${agl.id}/${encodeURIComponent(first.planId)}`,
			);
			const imported = draft.body?.tariff;
			assert(
				draft.status === 200 && imported?.importBlocks?.length > 0,
				"plan detail maps to import blocks",
				draft.body?.error,
			);
			assert(
				typeof imported?.dailySupplyCents === "number" && imported.dailySupplyCents > 0,
				"plan detail maps a daily supply charge",
			);
			console.log(
				`    ↳ ${first.displayName}: ` +
					`${imported?.importBlocks?.map((b) => `${b.label} ${b.centsPerKwh}c`).join(", ")}` +
					` · supply ${imported?.dailySupplyCents}c/day`,
			);
		}
	}
} else {
	console.log("  – AER lookup skipped (pass --live-aer to hit the public CDR API)");
}

// ── cleanup: remove probe tariffs, restore the original active one ──────────
await api("DELETE", "/api/tariffs/probe-flat");
await api("DELETE", "/api/tariffs/probe-tou");
if (initialActive) await api("POST", `/api/tariffs/${initialActive}/active`);
const remaining = (await api("GET", "/api/tariffs")).body?.tariffs ?? [];
assert(
	!remaining.some((t) => t.id.startsWith("probe-")),
	"cleanup removed the probe tariffs",
	remaining.map((t) => t.id).join(","),
);
assert(
	remaining.length === 0 || remaining.filter((t) => t.active).length === 1,
	"exactly one active tariff (or none when empty)",
);

ws.close();
if (failures) {
	console.error(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log("\nAll checks passed.");
process.exit(0);
