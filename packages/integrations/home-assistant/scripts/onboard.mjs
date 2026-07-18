#!/usr/bin/env node
// pnpm onboard — generate a starter dashboard from your Home Assistant.
//
// Reads every entity, keeps the ones a widget exists for (and that are actually
// available), groups them by HA area (room), and writes one generated screen per
// area into config/local.yaml. Safe to re-run: it only replaces screens marked
// `generated: true` and only APPENDS to the ha entities allowlist — your own
// screens and edits are never touched. A timestamped backup is written first.
//
// Flags:
//   --dry-run            show the plan and the YAML, write nothing
//   --yes                skip the confirmation prompt
//   --flat               skip the area registries; one flat "Devices" screen
//   --exclude <regex>    skip entity ids matching the pattern (repeatable)
//
// Auth: HA_URL (default http://homeassistant.local:8123) and HA_TOKEN from the
// environment or a repo-root .env file.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { parseDocument, stringify } from "yaml";

// The capability map: which widget can represent which HA domain. Grows as
// widget types are built (climate, sensor tiles, cameras, vacuums, ...).
const DOMAIN_WIDGETS = {
  light: "entity-toggle",
  switch: "entity-toggle",
  fan: "entity-toggle",
  input_boolean: "entity-toggle",
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipConfirm = args.includes("--yes");
const flat = args.includes("--flat");
// Entities that must never become a wall-panel tap, even when HA's registry
// lacks the entity_category metadata to filter them (e.g. Z2M pairing mode).
const excludes = [/permit_join/];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--exclude" && args[i + 1]) excludes.push(new RegExp(args[i + 1]));
}

try {
  process.loadEnvFile(".env");
} catch {
  /* no .env — fine */
}
const url = (process.env.HA_URL ?? "http://homeassistant.local:8123").replace(/\/+$/, "");
const token = process.env.HA_TOKEN;
if (!token) {
  console.error("HA_TOKEN is not set. Put HA_TOKEN=<long-lived token> in .env or the environment.");
  process.exit(1);
}

async function rest(path) {
  const res = await fetch(`${url}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

/** Run HA WebSocket commands (registry lists need this; REST doesn't expose them). */
function wsCommands(commands) {
  const wsUrl = url.replace(/^http/, "ws") + "/api/websocket";
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(wsUrl);
    const results = {};
    const pending = new Map();
    let nextId = 1;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket timeout"));
    }, 10_000);
    const fail = (err) => {
      clearTimeout(timer);
      ws.close();
      reject(err);
    };
    ws.onerror = () => fail(new Error("WebSocket error"));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: token }));
      } else if (msg.type === "auth_invalid") {
        fail(new Error("auth invalid"));
      } else if (msg.type === "auth_ok") {
        for (const [name, type] of Object.entries(commands)) {
          const id = nextId++;
          pending.set(id, name);
          ws.send(JSON.stringify({ id, type }));
        }
      } else if (msg.type === "result") {
        const name = pending.get(msg.id);
        if (!name) return;
        if (!msg.success) return fail(new Error(`${name}: ${msg.error?.message ?? "failed"}`));
        results[name] = msg.result;
        pending.delete(msg.id);
        if (pending.size === 0) {
          clearTimeout(timer);
          ws.close();
          resolvePromise(results);
        }
      }
    };
  });
}

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "area";

// ── 1. collect ────────────────────────────────────────────────────────────────
const states = await rest("/api/states");

let registries = null;
if (!flat) {
  try {
    registries = await wsCommands({
      areas: "config/area_registry/list",
      devices: "config/device_registry/list",
      entities: "config/entity_registry/list",
    });
  } catch (err) {
    console.warn(`⚠ Could not read HA registries (${err.message}) — falling back to a flat`);
    console.warn("  “Devices” screen. (Registry access needs an admin user's token.)");
  }
}
const entReg = new Map((registries?.entities ?? []).map((e) => [e.entity_id, e]));
const devArea = new Map((registries?.devices ?? []).map((d) => [d.id, d.area_id]));
const areaNames = new Map((registries?.areas ?? []).map((a) => [a.area_id, a.name]));

// ── 2. curate ─────────────────────────────────────────────────────────────────
const skipped = { unavailable: 0, category: 0, hidden: 0, excluded: 0 };
const candidates = [];
for (const s of states) {
  const domain = s.entity_id.split(".")[0];
  const widget = DOMAIN_WIDGETS[domain];
  if (!widget) continue;
  if (excludes.some((re) => re.test(s.entity_id))) {
    skipped.excluded++;
    continue;
  }
  if (s.state === "unavailable" || s.state === "unknown") {
    skipped.unavailable++;
    continue;
  }
  const reg = entReg.get(s.entity_id);
  if (reg?.entity_category) {
    skipped.category++; // config/diagnostic entities (indicator LEDs, device settings)
    continue;
  }
  if (reg?.hidden_by || reg?.disabled_by) {
    skipped.hidden++;
    continue;
  }
  const areaId = reg?.area_id ?? (reg?.device_id ? devArea.get(reg.device_id) : undefined);
  candidates.push({
    id: s.entity_id,
    name: s.attributes.friendly_name ?? s.entity_id,
    widget,
    area: (areaId && areaNames.get(areaId)) || (registries ? "Other" : "Devices"),
  });
}

if (!candidates.length) {
  console.log("Nothing to add — no available entities in supported domains.");
  process.exit(0);
}

// ── 3. plan screens ───────────────────────────────────────────────────────────
const byArea = new Map();
for (const c of candidates) {
  if (!byArea.has(c.area)) byArea.set(c.area, []);
  byArea.get(c.area).push(c);
}
const areas = [...byArea.keys()].sort((a, b) =>
  a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b),
);
const generatedScreens = areas.map((area) => ({
  id: `ha-${slug(area)}`,
  name: area,
  columns: 4,
  generated: true,
  widgets: byArea
    .get(area)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ type: e.widget, cols: 2, props: { entity: e.id } })),
}));
const allIds = candidates.map((c) => c.id).sort();

console.log(`Home Assistant at ${url}`);
console.log(`Plan: ${candidates.length} entities → ${generatedScreens.length} generated screen(s)`);
for (const s of generatedScreens) console.log(`  ${s.name.padEnd(24)} ${s.widgets.length} widgets`);
console.log(
  `Skipped: ${skipped.unavailable} unavailable/unknown, ${skipped.category} config/diagnostic, ` +
    `${skipped.hidden} hidden/disabled, ${skipped.excluded} excluded by pattern`,
);

// ── 4. merge into config/local.yaml (or create it) ───────────────────────────
const cfgPath = resolve("config/local.yaml");
let output;
const notes = [];

if (existsSync(cfgPath)) {
  const doc = parseDocument(readFileSync(cfgPath, "utf8"));

  // integrations: ensure a home-assistant entry; append missing entity ids
  let integrations = doc.get("integrations");
  if (!integrations) {
    doc.set("integrations", doc.createNode([]));
    integrations = doc.get("integrations");
  }
  let ha = integrations.items.find((item) => item.get?.("kind") === "home-assistant");
  if (!ha) {
    integrations.add(
      doc.createNode({
        id: "ha",
        kind: "home-assistant",
        config: { token: "${HA_TOKEN}", entities: allIds },
      }),
    );
    notes.push("added the home-assistant integration entry (token from ${HA_TOKEN})");
  } else {
    const haCfg = ha.get("config");
    const entities = haCfg?.get("entities");
    if (entities) {
      const existing = new Set(entities.items.map((n) => String(n.value ?? n)));
      let added = 0;
      for (const id of allIds) {
        if (!existing.has(id)) {
          entities.add(doc.createNode(id));
          added++;
        }
      }
      notes.push(`appended ${added} entity id(s) to the allowlist (${existing.size} kept)`);
    } else {
      notes.push("no `entities` allowlist on your ha entry — it already publishes everything");
    }
  }

  // screens: replace only generated ones; never touch user screens
  let screens = doc.get("screens");
  if (!screens) {
    doc.set("screens", doc.createNode([]));
    screens = doc.get("screens");
  }
  const before = screens.items.length;
  screens.items = screens.items.filter((s) => s.get?.("generated") !== true);
  const replaced = before - screens.items.length;
  const userIds = new Set(screens.items.map((s) => s.get?.("id")));
  let added = 0;
  for (const screen of generatedScreens) {
    if (userIds.has(screen.id)) {
      console.warn(`⚠ skipping "${screen.id}" — you already have a screen with that id`);
      continue;
    }
    const node = doc.createNode(screen);
    node.commentBefore =
      " generated by `pnpm onboard` — re-running onboarding replaces this screen";
    screens.items.push(node);
    added++;
  }
  notes.push(
    `screens: kept ${screens.items.length - added} of yours, replaced ${replaced} generated, added ${added}`,
  );
  output = doc.toString();
} else {
  output = [
    "# Generated by `pnpm onboard` — copy of this file is yours to customize.",
    "# HA_TOKEN comes from .env in the repo root.",
    "",
    stringify({
      server: { host: "0.0.0.0", port: 8090 },
      ambient: { idleSeconds: 120, resumeWindowMinutes: 60 },
      integrations: [
        { id: "demo", kind: "demo" },
        { id: "ha", kind: "home-assistant", config: { token: "${HA_TOKEN}", entities: allIds } },
      ],
      screens: [
        {
          id: "home",
          name: "Home",
          default: true,
          columns: 4,
          widgets: [
            { type: "clock", cols: 2 },
            { type: "weather", cols: 2 },
            { type: "calendar", cols: 4, title: "Up next" },
          ],
        },
        ...generatedScreens,
      ],
    }),
  ].join("\n");
  notes.push("created config/local.yaml (demo + home-assistant, home screen + generated screens)");
}

for (const n of notes) console.log(`→ ${n}`);

if (dryRun) {
  console.log("\n--dry-run: nothing written. Resulting YAML below:\n");
  console.log(output);
  process.exit(0);
}

if (!skipConfirm) {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`Write ${cfgPath}? [y/N] `);
  rl.close();
  if (!/^y/i.test(answer.trim())) {
    console.log("Aborted — nothing written.");
    process.exit(0);
  }
}

if (existsSync(cfgPath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = `${cfgPath}.bak-${stamp}`;
  copyFileSync(cfgPath, backup);
  console.log(`Backup: ${backup}`);
}
writeFileSync(cfgPath, output, "utf8");
console.log(`Wrote ${cfgPath}`);
console.log("Restart the dev server (config is read at startup) and enjoy your rooms.");
