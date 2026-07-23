import { useState } from "react";
import type { WidgetRenderProps } from "../registry.js";
import { modeStyle, snap, useClimate } from "./model.js";
import {
  FanRow,
  ModePills,
  RadialDial,
  RoundBtn,
  ZoneSliderRow,
  useDragValue,
} from "./controls.js";
import { cardBackground, ControlBar, EmptyState, WaitingState, type ClimateTab } from "./chrome.js";
import "./climate.css";

/**
 * "Radial" — a big drag-to-set temperature dial, mode pills and a fan-speed row.
 * When zones are configured, a Controls / Zones toggle appears and the Zones tab
 * lists each damper as a horizontal slider.
 */
export function RadialVariant({ config }: WidgetRenderProps) {
  const climate = useClimate(config);
  const { view, zones } = climate;
  const style = modeStyle(view.mode);
  const temp = useDragValue(view.target, climate.setTarget);
  const [tab, setTab] = useState<ClimateTab>("controls");

  if (!view.configured) return <EmptyState title={config.title} />;
  if (view.waiting) return <WaitingState title={config.title} name={view.name} />;

  const hasZones = zones.length > 0;
  const showZones = hasZones && tab === "zones";

  return (
    <div className="cc-root cc-radial">
      <div className="cc-card" style={cardBackground(style)}>
        <ControlBar
          view={view}
          style={style}
          tab={tab}
          setTab={setTab}
          hasZones={hasZones}
          onTogglePower={climate.togglePower}
        />

        {showZones ? (
          <div className="cc-zones">
            {zones.map((zone) => (
              <ZoneSliderRow key={zone.entity} climate={climate} zone={zone} style={style} />
            ))}
          </div>
        ) : (
          <>
            <div className="cc-dial-wrap">
              <RadialDial
                view={{ ...view, target: temp.shown }}
                style={style}
                onInput={temp.preview}
                onCommit={temp.commit}
              />
              <div className="cc-dial-btns">
                <RoundBtn
                  icon="minus"
                  onClick={() => temp.commit(snap(view, view.target - view.step))}
                  disabled={view.unavailable}
                />
                <RoundBtn
                  icon="plus"
                  onClick={() => temp.commit(snap(view, view.target + view.step))}
                  disabled={view.unavailable}
                />
              </div>
            </div>
            {view.modes.length ? (
              <div className="cc-section">
                <ModePills view={view} onSelect={climate.setMode} />
              </div>
            ) : null}
            <div className="cc-section">
              <FanRow view={view} accent={style.accent} onSelect={climate.setFan} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
