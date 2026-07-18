# Home Dashboard

An open-source, config-driven dashboard for a wall-mounted touchscreen — one place for
everything in your home: Home Assistant devices, solar/battery/energy, calendars, media,
podcast players, cameras, network status.

> **Status: early development (Phase 0).** The scaffold runs end-to-end on a built-in
> demo integration (fake data) so you can try the UI with zero setup. Real integrations
> (Home Assistant, Kodi, calendars, MQTT devices, …) land next.

## How it works

```
Wall kiosk (any browser, e.g. Chromium --kiosk)
        │  one WebSocket + REST
Server (your home server, Docker)
  ├─ integration plugins → publish retained data to topics, expose actions
  └─ serves the built frontend
        │  LAN
Home Assistant · Kodi · calendars · MQTT devices · …
```

- **Integrations** are backend plugins: each declares a Zod config schema, publishes
  data to topics (`ha/lights`, `kodi/now-playing`), and registers actions.
- **Widgets** are frontend components bound to topics/actions.
- **Screens** are YAML-defined grids of widgets — compose your dashboard in config,
  no code. An ambient (lock) screen with a big clock idles in after inactivity and
  wakes on touch.

## Quickstart (demo mode)

Requires Node ≥ 22 and pnpm (`npm i -g pnpm`).

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173 — the dashboard runs against live fake data (energy drifts,
lights toggle, a podcast "plays"). The server listens on :8090; the Vite dev server
proxies `/api` and `/ws` to it.

Docker: `cd deploy && docker compose up -d --build`, then open http://localhost:8090.

## Configuration

Copy [config/example.yaml](config/example.yaml) to `config/local.yaml` and edit —
screens, widgets, integrations, ambient behavior. The server validates config at
startup and tells you exactly what's wrong.

To connect a real **Home Assistant** (long-lived token, live two-way entity toggles,
`pnpm ha:explore` to list everything HA exposes), follow
[docs/home-assistant.md](docs/home-assistant.md).

Or skip straight to a populated dashboard: **`pnpm onboard`** reads your HA, groups
your lights/switches/fans by room (HA areas), and generates a screen per room in
`config/local.yaml` — backing up first, never touching screens you've customized.

## Repository layout

| Path                      | What                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| `apps/server`             | Fastify backend: config loader, plugin host, WebSocket hub        |
| `apps/web`                | React + Mantine frontend: widget registry, screens, ambient layer |
| `packages/shared`         | WS protocol types, integration plugin SDK, config schemas         |
| `packages/integrations/*` | Integration plugins (`demo` today; `home-assistant` next)         |
| `config/`                 | Example YAML config                                               |
| `deploy/`                 | Dockerfile usage, docker-compose                                  |

## Roadmap

- [x] Phase 0 — scaffold, plugin SDK, demo mode, ambient screen
- [ ] Phase 1 — Home Assistant (lights, climate, energy), desk-monitor daily use
- [ ] Phase 2 — weather (Open-Meteo), ICS calendars, bin day, time-of-day ambient scenes
- [ ] Phase 3 — Kodi, podcast-Pi MQTT agents, doorbell/camera popups (go2rtc)
- [ ] Phase 4 — camera grid, vacuums, network status (Omada/OPNsense)
- [ ] Phase 5 — kiosk hardware guide (43" touchscreen + fanless mini PC)
- [ ] Phase 6 — docs site, theming, plugin authoring guide

## License

[MIT](LICENSE)
