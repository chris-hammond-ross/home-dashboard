import { WeatherIcon } from "./icons.js";
import { useCountUp, usePrefersReducedMotion, useWeather } from "./model.js";
import type { WidgetRenderProps } from "../registry.js";
import "./weather.css";

/**
 * "Meridian" — a technical, instrument-panel look: monospaced readout, a
 * bordered hero panel with a scan-line sweep, and a 7-cell outlook strip.
 */
export function MeridianVariant({ config }: WidgetRenderProps) {
  const view = useWeather(config);
  const reduced = usePrefersReducedMotion();
  const today = view.days[0];
  const heroTemp = useCountUp(today?.hi ?? 0, reduced);

  if (!view.ready || !today) {
    return (
      <div className="wx-root wx-meridian">
        <div className="wx-waiting wx-mono">Awaiting telemetry…</div>
      </div>
    );
  }

  return (
    <div className="wx-root wx-meridian">
      <div className="wx-stage">
        <div className="wx-bar">
          <div>{view.location ? view.location.toUpperCase() : "FORECAST"}</div>
          <div className="wx-live">
            <span className="wx-dot" />
            LIVE
          </div>
        </div>

        <div className="wx-hero">
          <span className="wx-corner tl" />
          <span className="wx-corner br" />
          <div className="wx-htop">
            <span className="k">TODAY // FORECAST HIGH</span>
            <span>{view.unit}</span>
          </div>
          <div className="wx-hero-row">
            <div className="wx-hcol">
              <div className="wx-temp">
                {heroTemp}
                <span className="wx-deg">°</span>
              </div>
              <div className="wx-cond">{today.condLabel}</div>
              <div className="wx-readout">
                <div className="wx-rd max">
                  MAX <b>{today.hi}</b>°
                </div>
                <div className="wx-rd min">
                  MIN <b>{today.lo}</b>°
                </div>
              </div>
            </div>
            <div className="wx-hero-icon">
              <WeatherIcon type={today.icon} />
            </div>
          </div>
        </div>

        <div className="wx-fc-head">
          <span>7-DAY // OUTLOOK</span>
          <span>H / L</span>
        </div>
        <div className="wx-fc">
          {view.days.map((d, i) => (
            <div
              className="wx-cell"
              key={i}
              style={{ animationDelay: reduced ? "0s" : `${i * 0.05}s` }}
            >
              <div className="wx-cname">{d.label === "Today" ? "NOW" : d.label.toUpperCase()}</div>
              <div className="wx-cicon">
                <WeatherIcon type={d.icon} />
              </div>
              <div className="wx-chi">{d.hi}°</div>
              <div className="wx-clo">{d.lo}°</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
