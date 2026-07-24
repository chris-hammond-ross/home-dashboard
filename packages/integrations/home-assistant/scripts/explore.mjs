#!/usr/bin/env node
// Interrogate your Home Assistant: list entities grouped by domain (REST API).
//
// Usage (from the repo root):
//   pnpm ha:explore                 # everything, grouped by domain
//   pnpm ha:explore --domain light  # one domain only
//
// Reads HA_URL (default http://homeassistant.local:8123) and HA_TOKEN from the
// environment; a .env file in the repo root is loaded automatically.

try {
	process.loadEnvFile(".env");
} catch {
	/* no .env — fine */
}

const url = (process.env.HA_URL ?? "http://homeassistant.local:8123").replace(/\/+$/, "");
const token = process.env.HA_TOKEN;

if (!token) {
	console.error(
		"HA_TOKEN is not set. Put HA_TOKEN=<long-lived token> in .env or the environment.",
	);
	process.exit(1);
}

const domainFilter = process.argv.includes("--domain")
	? process.argv[process.argv.indexOf("--domain") + 1]
	: null;

async function get(path) {
	const res = await fetch(`${url}${path}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status} ${res.statusText}`);
	return res.json();
}

try {
	const cfg = await get("/api/config");
	console.log(`Home Assistant ${cfg.version} — “${cfg.location_name}” — ${url}`);

	const states = await get("/api/states");
	const byDomain = new Map();
	for (const s of states) {
		const domain = s.entity_id.split(".")[0];
		if (!byDomain.has(domain)) byDomain.set(domain, []);
		byDomain.get(domain).push(s);
	}

	const domains = [...byDomain.keys()].sort();
	console.log(
		`${states.length} entities across ${domains.length} domains: ` +
			domains.map((d) => `${d} (${byDomain.get(d).length})`).join(", "),
	);

	for (const domain of domains) {
		if (domainFilter && domain !== domainFilter) continue;
		console.log(`\n── ${domain} ${"─".repeat(Math.max(1, 60 - domain.length))}`);
		for (const s of byDomain
			.get(domain)
			.sort((a, b) => a.entity_id.localeCompare(b.entity_id))) {
			const name = s.attributes.friendly_name ?? "";
			console.log(`  ${s.entity_id.padEnd(45)} ${String(name).padEnd(30)} ${s.state}`);
		}
	}
} catch (err) {
	console.error(`\nFailed: ${err.message ?? err}`);
	if (String(err).includes("401")) {
		console.error("→ 401 means the token is wrong or was revoked.");
	} else {
		console.error(
			"→ Check HA_URL. If “homeassistant.local” does not resolve (common in Docker),\n" +
				"  use the IP address, e.g. HA_URL=http://192.168.1.50:8123",
		);
	}
	process.exit(1);
}
