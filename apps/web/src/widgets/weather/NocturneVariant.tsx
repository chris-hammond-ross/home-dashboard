import { WeatherIcon } from "./icons.js";
import { useCountUp, usePrefersReducedMotion, useWeather } from "./model.js";
import type { WidgetRenderProps } from "../registry.js";
import "./weather.css";

/**
 * "Nocturne" — glassmorphism over a drifting aurora: a frosted hero card and a
 * row of frosted day cards. The most ambient of the three.
 */
export function NocturneVariant({ config }: WidgetRenderProps) {
	const view = useWeather(config);
	const reduced = usePrefersReducedMotion();
	const today = view.days[0];
	const heroTemp = useCountUp(today?.hi ?? 0, reduced);

	if (!view.ready || !today) {
		return (
			<div className="wx-root wx-nocturne">
				<div className="wx-aurora">
					<span className="wx-blob b1" />
					<span className="wx-blob b2" />
					<span className="wx-blob b3" />
				</div>
				<div className="wx-waiting">Waiting for weather…</div>
			</div>
		);
	}

	const dateLabel = new Date().toLocaleDateString(undefined, {
		weekday: "long",
		day: "numeric",
		month: "short",
	});
	const [locMain, locRegion] = splitLocation(view.location);

	return (
		<div className="wx-root wx-nocturne">
			<div className="wx-stage">
				<div className="wx-aurora">
					<span className="wx-blob b1" />
					<span className="wx-blob b2" />
					<span className="wx-blob b3" />
				</div>
				<div className="wx-content">
					<div className="wx-bar">
						<div className="wx-loc">
							{locMain || "Weather"}
							{locRegion ? <small>{locRegion}</small> : null}
						</div>
						<div className="wx-date">{dateLabel}</div>
					</div>

					<div className="wx-hero">
						<div className="wx-hero-row">
							<div className="wx-hero-left">
								<div className="wx-eyebrow">Today · High</div>
								<div className="wx-temp">
									{heroTemp}
									<span className="wx-deg">°</span>
								</div>
								<div className="wx-cond">{today.condLabel}</div>
								<div className="wx-lo">
									Low <b>{today.lo}</b>°
								</div>
							</div>
							<div className="wx-hero-icon">
								<WeatherIcon type={today.icon} />
							</div>
						</div>
					</div>

					<div className="wx-fc-label">7-Day Forecast</div>
					<div className="wx-fc">
						{view.days.map((d, i) => (
							<div
								className="wx-day"
								key={i}
								style={{ animationDelay: reduced ? "0s" : `${i * 0.06}s` }}
							>
								<div className="wx-dname">
									{d.label === "Today" ? "Now" : d.label}
								</div>
								<div className="wx-dicon">
									<WeatherIcon type={d.icon} />
								</div>
								<div className="wx-dhi">{d.hi}°</div>
								<div className="wx-dlo">{d.lo}°</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

/** "Adelaide, SA" → ["Adelaide", "SA"]; "Berlin" → ["Berlin", ""]. */
function splitLocation(location: string): [string, string] {
	const comma = location.indexOf(",");
	if (comma < 0) return [location, ""];
	return [location.slice(0, comma).trim(), location.slice(comma + 1).trim()];
}
