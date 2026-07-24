import { useEffect, useState } from "react";
import { WeatherIcon } from "./icons.js";
import { useCountUp, usePrefersReducedMotion, useWeather } from "./model.js";
import type { WidgetRenderProps } from "../registry.js";
import "./weather.css";

/**
 * "Ember" — warm serif hero over a thermal glow, with a 7-day list whose
 * range bars are scaled across the week's min/max. Faithful to the prototype;
 * the hero shows today's forecast high.
 */
export function EmberVariant({ config }: WidgetRenderProps) {
	const view = useWeather(config);
	const reduced = usePrefersReducedMotion();
	const today = view.days[0];
	const heroTemp = useCountUp(today?.hi ?? 0, reduced);

	// Grow the range bars from zero on mount (CSS transitions the width).
	const [grown, setGrown] = useState(reduced);
	useEffect(() => {
		const raf = requestAnimationFrame(() => setGrown(true));
		return () => cancelAnimationFrame(raf);
	}, []);

	if (!view.ready || !today) {
		return (
			<div className="wx-root wx-ember">
				<div className="wx-waiting">Waiting for weather…</div>
			</div>
		);
	}

	const dateLabel = new Date().toLocaleDateString(undefined, {
		weekday: "long",
		day: "numeric",
		month: "long",
	});
	const wkMin = Math.min(...view.days.map((d) => d.lo));
	const wkMax = Math.max(...view.days.map((d) => d.hi));
	const span = Math.max(1, wkMax - wkMin);

	return (
		<div className="wx-root wx-ember">
			<div className="wx-stage">
				<div className="wx-bar">
					<div className="wx-loc">
						{view.location || "Weather"}
						<span>.</span>
					</div>
					<div className="wx-date">{dateLabel}</div>
				</div>

				<div className="wx-hero">
					<div className="wx-eyebrow">Today — High</div>
					<div className="wx-hero-row">
						<div className="wx-temp">
							{heroTemp}
							<span className="wx-deg">°</span>
						</div>
						<div className="wx-hero-icon">
							<WeatherIcon type={today.icon} />
						</div>
					</div>
					<div className="wx-meta">
						<div className="wx-cond">{today.condLabel}</div>
						<div className="wx-lo">
							Low <b>{today.lo}</b>°
						</div>
					</div>
				</div>

				<div className="wx-fc-label">Next 7 Days</div>
				<div className="wx-fc">
					{view.days.map((d, i) => {
						const left = ((d.lo - wkMin) / span) * 100;
						const width = ((d.hi - d.lo) / span) * 100;
						return (
							<div
								className="wx-row"
								key={i}
								style={{ animationDelay: reduced ? "0s" : `${i * 0.06}s` }}
							>
								<div className="wx-rname">{d.label}</div>
								<div className="wx-ricon">
									<WeatherIcon type={d.icon} />
								</div>
								<div className="wx-range">
									<div className="wx-rlo">{d.lo}°</div>
									<div className="wx-track">
										<div
											className="wx-fill"
											style={{
												left: `${left}%`,
												width: grown ? `${width}%` : 0,
											}}
										/>
									</div>
									<div className="wx-rhi">{d.hi}°</div>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
