# Connecting Home Assistant

This walks you from a long-lived access token to a working two-way light toggle on the
dashboard.

## How the integration works

The **server** connects to Home Assistant's WebSocket API (the same API HA's own
frontend uses) with your long-lived token. The browser/kiosk never talks to HA and
never sees the token — it only talks to the dashboard server. That means no CORS, no
iframe workarounds, and one place to keep the secret.

```
Browser/kiosk ── one WS ──► dashboard server ── HA WebSocket API ──► Home Assistant
                                   ▲ token lives here only
```

The integration subscribes to entity state changes, so anything that changes an
entity — a wall switch, the HA app, an automation, a Zigbee remote — is pushed to the
dashboard within milliseconds. Widgets don't poll.

## 1. Create a long-lived access token

In Home Assistant: click your user (bottom-left) → **Security** tab → **Long-lived
access tokens** → **Create token**. Copy it immediately — HA only shows it once.

### What does the token give you?

A long-lived token authenticates you as **the user who created it**, with exactly that
user's permissions — it is not scoped down. With it you (and this dashboard) can:

- **Read every entity state**: `GET /api/states` (REST) or `get_states` (WebSocket) —
  all entities, their states and attributes.
- **Call any service**: turn things on/off, run scripts, trigger automations.
- **Subscribe to events** (state changes, automations firing, …) over the WebSocket.
- **Query registries** (entities/devices/areas/integrations) via WebSocket commands
  like `config/entity_registry/list` — these require the user to be an **admin**.
- Fetch **history and statistics** (used later for energy charts).

So yes — you can absolutely interrogate it to see everything available. Three ways:

1. **In HA**: Developer Tools → States (the fastest way to find an `entity_id`).
2. **From this repo**: `pnpm ha:explore` — lists every entity grouped by domain, with
   friendly names and current states (`pnpm ha:explore --domain light` to filter).
3. **Raw REST**, if you're curious:
   ```sh
   curl -H "Authorization: Bearer $HA_TOKEN" http://homeassistant.local:8123/api/states
   ```

Tokens last 10 years and can be revoked any time from the same Security tab. Treat it
like a password: it's full control of your home. For least privilege you can create a
dedicated non-admin HA user (e.g. `dashboard`) and use _its_ token — everything here
works except admin-only registry queries.

## 2. Configure the dashboard

Config lives in `config/local.yaml` (gitignored — copy `config/example.yaml`). The
token itself belongs in a `.env` file in the repo root (also gitignored), referenced
from the YAML with `${HA_TOKEN}`:

```sh
# .env  (repo root — never committed)
HA_TOKEN=eyJhbGciOiJIUzI1NiIs...
```

```yaml
# config/local.yaml
integrations:
  - id: ha
    kind: home-assistant
    config:
      # This IS the default — omit it if homeassistant.local works for you.
      # Use the IP (e.g. http://192.168.1.50:8123) for Docker or flaky mDNS.
      url: http://homeassistant.local:8123
      token: ${HA_TOKEN}
      # Only these entities are published to the dashboard. Omit `entities`
      # entirely to publish everything (fine on a LAN, just chattier).
      entities:
        - light.study_lamp
```

Notes:

- **URL**: defaults to `http://homeassistant.local:8123`; set `url` to anything —
  IP, hostname, HTTPS. If you run the dashboard server in **Docker**, mDNS `.local`
  names usually don't resolve inside containers — use the IP or a real DNS name.
- **`id: ha`** is the topic prefix: this instance publishes `ha/status`, `ha/states`,
  and `ha/entity/<entity_id>`. You could run two instances (e.g. two HA homes) with
  different ids.
- Direct `token: eyJ...` in the YAML also works — the `${VAR}` indirection just keeps
  secrets out of the config file.

## 3. Add a toggle widget for one light

Still in `config/local.yaml`, put an `entity-toggle` widget on a screen:

```yaml
screens:
  - id: home
    name: Home
    default: true
    columns: 4
    widgets:
      - type: entity-toggle
        title: Study
        cols: 2
        props:
          entity: light.study_lamp
          # integration: ha        # only needed if your integration id isn't "ha"
          # label: Desk lamp       # overrides HA's friendly_name
```

## 4. Run it and prove two-way state

```sh
pnpm dev        # then open http://localhost:5173
```

- Tap the toggle → the integration calls the `homeassistant.toggle` service → the
  light changes → HA pushes the new state back → the switch reflects reality.
- Now flip the light **somewhere else** (wall switch, HA app, voice) — the widget
  updates by itself within a moment. That round trip is the whole architecture
  working: the widget never assumes; it only displays what HA says is true.

The server log will show `connected to Home Assistant <version> at <url>` on startup.

## Generate a starter dashboard: `pnpm onboard`

Instead of hand-writing widgets, let onboarding build the first version:

```sh
pnpm onboard --dry-run   # show the plan + resulting YAML, write nothing
pnpm onboard             # confirm, back up, write config/local.yaml
```

What it does:

- Reads all entities, keeps the ones a widget exists for today (lights, switches,
  fans, input booleans → `entity-toggle`) and that are actually available — stale
  `unavailable` entities, hidden/disabled entities, and config/diagnostic entities
  (indicator LEDs, device settings) are skipped. Anything matching `permit_join` is
  always skipped (never put Zigbee pairing on a wall panel); add your own filters
  with `--exclude <regex>` (repeatable), e.g. `--exclude do_not_disturb`.
- Reads HA's **area registries** (admin token required; `--flat` to skip) and
  generates **one screen per room**, plus an "Other" screen for unassigned devices.
- **Safe to re-run**: it only replaces screens marked `generated: true`, only
  _appends_ to the `entities:` allowlist, never touches your own screens or edits,
  and writes a timestamped backup of `config/local.yaml` first.
- As new widget types land (climate, sensors, cameras, vacuums…), the domain→widget
  map inside the script grows — re-running onboarding upgrades the generated screens.

Take ownership of a generated screen by deleting its `generated: true` line — from
then on onboarding leaves it alone.

## Troubleshooting

| Symptom                                       | Cause / fix                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| log: `rejected the token` / explore: HTTP 401 | Token wrong, truncated, or revoked. Create a new one.                                                                 |
| log: `unreachable … retrying in 10s`          | URL wrong, HA down, or `.local` not resolving (use the IP). The dashboard keeps running and reconnects automatically. |
| Widget says `waiting for Home Assistant…`     | Integration not connected yet (see above), or the entity id isn't in your `entities` allowlist.                       |
| Widget says `unavailable`                     | HA knows the entity but its device is offline — fix in HA land.                                                       |
| Works in dev, not in Docker                   | Almost always mDNS — set `url` to the IP.                                                                             |
| HTTPS HA with self-signed cert                | Prefer plain HTTP on the LAN for the server↔HA hop, or use a properly trusted cert.                                   |

## Security notes

- `config/local.yaml` and `.env` are gitignored — keep tokens out of `example.yaml`
  and out of commits.
- The dashboard server re-exposes only what you configure (the `entities` allowlist)
  to anything on your LAN that can reach its port. That's the same trust model as HA
  itself on a LAN; don't port-forward the dashboard to the internet.
- Revoke the token in HA (profile → Security) if you ever suspect it leaked.
