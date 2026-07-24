# CLAUDE.md

Wall-mounted touchscreen home dashboard. pnpm + Turborepo monorepo, TypeScript
everywhere, MIT. The wall device is a dumb Chromium kiosk; all logic lives in the
server; the frontend gets everything over ONE WebSocket.

## Commands

- `pnpm dev` — server (tsx, :8090) + web (Vite, :5173, proxies /api and /ws)
- `pnpm typecheck` / `pnpm build` / `pnpm format` — CI runs format:check, typecheck, build
- `pnpm ha:explore [--domain light]` — list every Home Assistant entity (uses .env)
- `pnpm onboard [--dry-run|--yes|--flat|--server <url>]` — generate per-room screens
  from HA areas and PUSH them to the **running server** (`PUT /api/screens/generated`;
  start `pnpm dev` first). The server replaces only screens marked `generated: true`,
  never user screens; any UI edit clears the flag (adoption). Allowlist append into
  local.yaml unchanged. Domain→widget capability map lives in the script — extend it
  when adding a new widget type.
- `DASHBOARD_CONFIG=<path>` overrides config; otherwise `config/local.yaml` (gitignored) then `config/example.yaml`
- Config is read **once at startup** — restart the dev server after YAML changes.
  EXCEPT screens: they live in SQLite (`storage.path`, default `data/dashboard.db`,
  path relative to the config file). The YAML `screens:` block is a first-boot seed,
  imported only when the DB is empty AND the `meta.screens_imported` flag is unset;
  delete the DB file to re-seed. Edit screens at `#/settings` in the browser.
- Manual smoke tests: `node apps/server/scripts/ws-probe.mjs` (server must be running),
  `node apps/server/scripts/screens-probe.mjs` (self-contained: builds nothing, boots
  the built server on :8099 with a scratch config/DB and exercises REST + WS),
  `node apps/server/scripts/energy-probe.mjs` (tariffs + energy history against a
  scratch server whose config enables the `demo` integration; add `--live-aer` to also
  hit the public CDR plan API)

## Architecture (data flow)

```
integration plugin ──publish──► TopicHub (retains last payload per topic)
      ▲ actions                      │ one WS per client (apps/server/src/ws.ts)
      └────────── action ◄── widget ──useTopic(topic)── React
```

- **Topics** are `<integrationId>/<stream>`, e.g. `ha/entity/light.xyz`. Retained:
  subscribers immediately get the latest payload.
- **Actions** are `socket.action(integrationId, name, params)` → integration handler.
- Config schemas are Zod (v4 — note `z.url()`, `z.prettifyError`, two-arg `z.record`).
  `${VAR}` in any config string is expanded from the environment / repo-root `.env`.
- **Screens are DB-backed** (better-sqlite3; `apps/server/src/db/` + `ScreenStore` +
  `ScreenService`). The integration id `core` is reserved: the server itself publishes
  the retained `core/screens` topic (full ordered screens array) after every mutation —
  the kiosk and settings UI update live from it. REST CRUD: GET/POST `/api/screens`,
  PUT/DELETE `/api/screens/:id`, POST `/api/screens/reorder`, POST
  `/api/screens/:id/default`, PUT `/api/screens/generated` (ids `generated`/`reorder`/
  `default` are reserved). Invariant: exactly one default screen whenever screens exist.
- **Entity hints**: after every screens mutation the server calls the `entity-hints`
  action on every integration that registered one, passing all entity ids referenced by
  widgets (props `entity`/`entities`). The HA integration publishes
  allowlist ∪ hinted — so a widget added in the settings UI gets data without a config
  edit or restart. `list-entities` action returns ALL entities for the settings browser.
- `#/settings` (tiny hash router, no lib) is the screen/widget editor, with
  `#/settings/tariff` for the electricity plan; widget editor metadata lives in
  `apps/web/src/widgets/meta.ts` — register new widget types there AND in `registry.tsx`.
- **Tariffs & energy cost** (migration 002, `db/tariff-store.ts` + `TariffService`):
  many named tariffs, exactly one active — the same one-owner invariant screens use for
  `default`. The server publishes retained `core/tariff` = the active plan _plus_ the
  band in force now, re-broadcast by a chained timer at each window boundary, so the
  widget shows "Peak 51.3c · $1.42/h" with no round-trip. REST: GET/POST `/api/tariffs`,
  PUT/DELETE `/api/tariffs/:id`, POST `/api/tariffs/:id/active` (ids `retailers`/`plans`/
  `active` are reserved). Money is in **cents** everywhere. Rate model + pure costing
  math live in `packages/shared/src/tariff.ts`; a rate block with **no windows** is the
  catch-all (`kind` only drives colour/wording).
- **Tariff import** (`apps/server/src/aer.ts`): Australian retailers publish their rates
  under the Consumer Data Right and the AER mirrors them at `cdr.energymadeeasy.gov.au`
  with no auth. Two traps, both encoded: retailers' own `publicBaseUri` endpoints 404,
  and the AER brand slug is not derivable from the brand name (kebab-case resolves 26 of
  84 — dropping a trailing "energy"/"power" recovers the majors), so candidates are
  probed and cached. Lazy + cached; an AER outage can only fail an import.
- **Energy history** (`apps/server/src/energy.ts`, `POST /api/energy/history`): always
  queries HA at `period: "hour"` whatever range was asked for — one code path, and TOU
  pricing stays exact because a day bucket can't tell peak from off-peak. Falls back to
  integrating a power sensor's hourly `mean` when no kWh statistic is configured, and
  flags the answer `estimated`. `allocateFlows` in `packages/shared/src/energy.ts` is
  shared with the live diagram, so history and the widget tell the same story.

## Home Assistant integration (packages/integrations/home-assistant)

- Server-side `home-assistant-js-websocket` over Node's built-in WebSocket; long-lived
  token from config (`token: ${HA_TOKEN}`, `.env` holds `HA_TOKEN`). Token never
  reaches the browser.
- Topics: `ha/status` {connected, haVersion}, `ha/states` (compact map),
  `ha/entity/<entity_id>` {entityId, state, attributes, lastChanged, lastUpdated}.
- Actions: `toggle` {entity_id} (homeassistant.toggle — works for light/switch/fan),
  `call-service` {domain, service, data?, target?} (anything else).
- Read-only recorder passthroughs for history: `statistics`
  (`recorder/statistics_during_period` — `types: ["change"]` + `units: {energy:"kWh"}`
  for meters, `["mean"]` + `{power:"W"}` for power sensors), `list-statistic-ids`, and
  `energy-prefs` (`energy/get_prefs`, so HA's own Energy dashboard config can fill the
  widget's six statistic fields in one click). Hourly statistics are never purged, so a
  year of history is always available. The `demo` integration answers `statistics` and
  `list-statistic-ids` in the same shape with a deterministic fixture — that is what the
  energy probe runs against.
- `entities:` allowlist in config controls what gets published; omit = everything.
- Resilient by design: HA down must never block server startup or kill the dashboard
  (retry loop; invalid auth logs and stops retrying). Keep this property.

## Recipe: new widget bound to live data

1. Create `apps/web/src/widgets/FooWidget.tsx` — copy the shape of
   `EntityToggleWidget.tsx`: read props from `config.props` (untyped YAML — narrow with
   `typeof` checks), `useTopic<T>(topic)` for state, `socket.action(...)` for control,
   wrap in `WidgetCard`. Payload undefined = not arrived yet; render a muted waiting state.
2. Register it in `apps/web/src/widgets/registry.tsx`.
3. Add it to a screen in `config/local.yaml` (`type`, `cols`/`rows`, `props`).
4. Widgets display what the server says is true — no optimistic UI; HA pushes state
   back in ms.

## Recipe: new integration

1. `packages/integrations/<name>/` with package.json (`exports` → `./src/index.ts`,
   deps: shared + zod; tsconfig extends base **+ `"types": ["node"]`** and @types/node
   devDep — integrations are server-side).
2. `defineIntegration({ kind, configSchema, create(ctx, config) })` — publish via
   `ctx.publish(stream, payload)`, timers via `ctx.every(ms, fn)` (auto-cleaned),
   actions via `ctx.registerAction`. Return `{ dispose() }`.
3. Register the kind in `apps/server/src/plugins.ts` and add the workspace dep to
   `apps/server/package.json`.

## UI conventions (dark-first wall panel)

- Design tokens in `apps/web/src/tokens.css` — values/labels wear ink tokens
  (`--text-primary/secondary/muted`), never series colors; status colors
  (`--status-*`) are reserved and always paired with icon + word; categorical series
  colors (`--series-1..4`) are assigned in fixed order per entity, never by position.
- `--flow-*` colours the power-flow **diagram** (well-separated, individually labelled
  nodes); `--chart-*` is the re-stepped set for **stacked bars**, where the same roles
  touch. Same hue families, but the flow steps fail CVD validation when adjacent, so
  never stack with them. Validate any new categorical palette with the `dataviz`
  skill's `validate_palette.js` rather than by eye. Tariff bands are ordered, so they
  use the sequential `--chart-band-1..4` ramp, not categorical hues.
- Headline numbers are stat tiles (see `EnergyWidget`), not charts. Touch targets
  ≥ 48px. The wall panel never scrolls; screens paginate.
- Mantine v8; theme in `apps/web/src/theme.ts`; ESM imports use `.js` suffixes
  (verbatimModuleSyntax).

## Verifying changes

- Probe pattern: start the built server on a **spare port** with a scratch config
  (`DASHBOARD_CONFIG=... node apps/server/dist/index.js`) and drive the WS protocol
  with a small Node script (built-in WebSocket) — see `apps/server/scripts/ws-probe.mjs`.
  Don't bind :8090 — the user's `pnpm dev` is often running there.
- Never actuate real devices (lights, locks, covers) in automated verification;
  read-only checks (`ha/status`, entity topics) prove the pipeline. Leave the first
  real actuation to the user unless they ask.
- pnpm may prompt for build-script approval on new deps → `allowBuilds` in
  `pnpm-workspace.yaml`.
