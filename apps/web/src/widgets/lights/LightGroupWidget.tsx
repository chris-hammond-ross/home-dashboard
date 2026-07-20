import { useMemo, useState } from "react";
import { Text } from "@mantine/core";
import { socket } from "../../lib/socket.js";
import { WidgetCard, type WidgetRenderProps } from "../registry.js";
import {
  HBar,
  IconChevron,
  IconLock,
  IconPower,
  LightGlyph,
  WARM,
  hsl,
  lightTurnOn,
  powerEntities,
  toView,
  useEntityMap,
  type LightView,
} from "./shared.js";

/**
 * Group light panel (variant 04 of temp/lightswitch-v2-lumen.html): master
 * power + master brightness up top, one glowing dot per light, and a chevron
 * that expands per-light tiles (tap to toggle, tap/drag the bar to dim).
 *
 * Members can mix domains — real lights next to adopted switch.* outlets.
 * Master power uses domain-agnostic homeassistant.turn_on/turn_off; the master
 * brightness bar only ever targets the dimmable light.* members.
 *
 * State is whatever Home Assistant says is true — the only local state is the
 * value under an active drag. Accent colour per light comes from `hs_color`.
 *
 * props: {
 *   entities: ["light.kitchen_bench", "switch.lamp_outlet", ...],
 *   integration?: "ha",
 *   expanded?: true,   // start with per-light tiles open
 * }
 */
export function LightGroupWidget({ config }: WidgetRenderProps) {
  const integration =
    typeof config.props.integration === "string" ? config.props.integration : "ha";
  const propEntities = config.props.entities;
  const entityIds = useMemo(
    () =>
      Array.isArray(propEntities)
        ? propEntities.filter((e): e is string => typeof e === "string")
        : [],
    [propEntities],
  );
  const [open, setOpen] = useState(config.props.expanded === true);
  const entityMap = useEntityMap(integration, entityIds);

  if (!entityIds.length) {
    return (
      <WidgetCard title={config.title ?? "Lights"}>
        <Text c="var(--text-muted)">light-group needs an “entities” prop (entity ids)</Text>
      </WidgetCard>
    );
  }

  const lights = entityIds.map((id) => toView(id, entityMap[id]));
  const available = lights.filter((l) => !l.unavailable);
  const availableIds = available.map((l) => l.id);
  const dimmableIds = available.filter((l) => l.dimmable).map((l) => l.id);
  const onLights = available.filter((l) => l.on);
  const unavailableCount = lights.filter((l) => !l.waiting && l.unavailable).length;
  const waiting = lights.every((l) => l.waiting);
  const avgPct = onLights.length
    ? Math.round(onLights.reduce((sum, l) => sum + l.briPct, 0) / onLights.length)
    : null;

  return (
    <WidgetCard title={config.title ?? "Lights"}>
      <div className="lw-root">
        <div className="lw-head">
          <div className="lw-meta">
            <div className="lw-count">
              {waiting ? "—" : `${onLights.length} of ${available.length} on`}
            </div>
            <div className="lw-sub">
              {waiting
                ? "waiting for Home Assistant…"
                : unavailableCount
                  ? `${unavailableCount} unavailable`
                  : " "}
            </div>
          </div>
          <button
            type="button"
            className={`lw-roundbtn lw-power${
              onLights.length === 0 ? "" : onLights.length === available.length ? " on" : " mixed"
            }`}
            aria-label="Toggle all lights"
            disabled={available.length === 0}
            onClick={() => powerEntities(integration, availableIds, onLights.length === 0)}
          >
            <IconPower />
          </button>
          <button
            type="button"
            className="lw-roundbtn lw-chevron"
            aria-expanded={open}
            aria-label={open ? "Hide individual lights" : "Show individual lights"}
            onClick={() => setOpen((o) => !o)}
          >
            <IconChevron />
          </button>
        </div>

        {dimmableIds.length ? (
          <HBar
            value={avgPct}
            colour={WARM}
            label="All lights brightness"
            renderLabel={(pct) => (pct === 0 ? "All off" : `All · ${pct}%`)}
            onSet={(pct) => lightTurnOn(integration, dimmableIds, { brightness_pct: pct })}
          />
        ) : null}

        <div className="lw-dots" aria-hidden="true">
          {lights.map((l) => (
            <span
              key={l.id}
              className="lw-dot"
              style={
                l.on && !l.unavailable
                  ? { background: hsl(l.colour), boxShadow: `0 0 8px ${hsl(l.colour, 0.8)}` }
                  : undefined
              }
            />
          ))}
        </div>

        <div className={`lw-body${open ? " open" : ""}`}>
          <div>
            <div className="lw-grid">
              {lights.map((light) => (
                <LightTile
                  key={light.id}
                  light={light}
                  onToggle={() =>
                    void socket.action(integration, "toggle", { entity_id: light.id })
                  }
                  onSetBrightness={(pct) =>
                    lightTurnOn(integration, [light.id], { brightness_pct: pct })
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </WidgetCard>
  );
}

function LightTile({
  light,
  onToggle,
  onSetBrightness,
}: {
  light: LightView;
  onToggle: () => void;
  onSetBrightness: (pct: number) => void;
}) {
  const on = light.on && !light.unavailable;
  const c = light.colour;
  return (
    <div
      className={`lw-tile${light.unavailable ? " is-unavailable" : ""}`}
      style={on ? { borderColor: hsl(c, 0.4) } : undefined}
    >
      <button
        type="button"
        className="lw-tile-top"
        role="switch"
        aria-checked={light.on}
        aria-label={light.name}
        disabled={light.unavailable}
        onClick={onToggle}
      >
        <span
          className="lw-tile-dot"
          style={on ? { background: hsl(c, 0.2), color: hsl(c) } : undefined}
        >
          {light.unavailable && !light.waiting ? <IconLock /> : <LightGlyph icon={light.icon} />}
        </span>
        <span className="lw-tile-name">{light.name}</span>
        <span className="lw-tile-stat">{light.unavailable ? "" : on ? "On" : "Off"}</span>
      </button>
      {light.dimmable && !light.unavailable ? (
        <HBar
          mini
          value={on ? light.briPct : null}
          colour={c}
          label={`${light.name} brightness`}
          renderLabel={(pct) => (pct === 0 ? "Off" : `${pct}%`)}
          onSet={onSetBrightness}
        />
      ) : null}
    </div>
  );
}
