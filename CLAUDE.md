# CLAUDE.md

Wall-mounted touchscreen home dashboard. pnpm + Turborepo monorepo, TypeScript
everywhere, MIT. The wall device is a dumb Chromium kiosk; all logic lives in the
server; the frontend gets everything over ONE WebSocket.

## Commands

- `pnpm dev` — server (tsx, :8090) + web (Vite, :5173, proxies /api and /ws)
- `pnpm typecheck` / `pnpm build` / `pnpm format` — CI runs format:check, typecheck, build
- `pnpm ha:explore [--domain light]` — list every Home Assistant entity (uses .env)
- `pnpm onboard [--dry-run|--yes|--flat]` — generate per-room screens from HA areas.
  Owns only screens marked `generated: true` and appends to the entities allowlist;
  never touches user screens. Domain→widget capability map lives in the script —
  extend it when adding a new widget type.
- `DASHBOARD_CONFIG=<path>` overrides config; otherwise `config/local.yaml` (gitignored) then `config/example.yaml`
- Config is read **once at startup** — restart the dev server after YAML changes
- Manual WS smoke test: `node apps/server/scripts/ws-probe.mjs` (server must be running)

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

## Home Assistant integration (packages/integrations/home-assistant)

- Server-side `home-assistant-js-websocket` over Node's built-in WebSocket; long-lived
  token from config (`token: ${HA_TOKEN}`, `.env` holds `HA_TOKEN`). Token never
  reaches the browser.
- Topics: `ha/status` {connected, haVersion}, `ha/states` (compact map),
  `ha/entity/<entity_id>` {entityId, state, attributes, lastChanged, lastUpdated}.
- Actions: `toggle` {entity_id} (homeassistant.toggle — works for light/switch/fan),
  `call-service` {domain, service, data?, target?} (anything else).
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
