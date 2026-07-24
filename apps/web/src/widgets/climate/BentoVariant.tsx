import { useState } from "react";
import type { CSSProperties } from "react";
import type { WidgetRenderProps } from "../registry.js";
import { clamp, modeStyle, snap, splitTemp, useClimate } from "./model.js";
import {
	FanChips,
	MiniControl,
	ModeGrid,
	RoundBtn,
	ZoneRingTile,
	useDragValue,
} from "./controls.js";
import { ClimateGlyph } from "./icons.js";
import { cardBackground, ControlBar, EmptyState, WaitingState, type ClimateTab } from "./chrome.js";
import "./climate.css";

/**
 * "Bento" — a glassy tile grid: a hero setpoint tile with a progress bar, a mode
 * grid, a fan tile and an indoor-now readout. The zone view swaps in a compact
 * control bar over a grid of progress-ring dampers.
 */
export function BentoVariant({ config }: WidgetRenderProps) {
	const climate = useClimate(config);
	const { view, zones } = climate;
	const style = modeStyle(view.mode);
	const temp = useDragValue(view.target, climate.setTarget);
	const [tab, setTab] = useState<ClimateTab>("controls");

	if (!view.configured) return <EmptyState title={config.title} />;
	if (view.waiting) return <WaitingState title={config.title} name={view.name} />;

	const hasZones = zones.length > 0;
	const showZones = hasZones && tab === "zones";
	const frac = clamp((temp.shown - view.min) / (view.max - view.min || 1), 0, 1);
	const { int, dec } = splitTemp(temp.shown);
	const step = (delta: number) => temp.commit(snap(view, view.target + delta * view.step));

	const cycleMode = () => {
		if (!view.modes.length) return;
		if (!view.on) {
			climate.setMode(view.modes[0]!);
			return;
		}
		const i = view.modes.indexOf(view.mode);
		climate.setMode(view.modes[(i + 1) % view.modes.length]!);
	};

	return (
		<div className="cc-root cc-bento">
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
					<div className="cc-bento-stack">
						<MiniControl
							view={view}
							style={style}
							glassy
							onCycleMode={cycleMode}
							onStep={step}
						/>
						<div className="cc-ztile-grid">
							{zones.map((zone) => (
								<ZoneRingTile
									key={zone.entity}
									climate={climate}
									zone={zone}
									style={style}
								/>
							))}
						</div>
					</div>
				) : (
					<div className="cc-bento-grid">
						<div className="cc-tile cc-tile-wide cc-hero">
							<div className="cc-hero-main">
								<div className="cc-hero-mode" style={{ color: style.accent }}>
									{view.on ? style.label : "Off"}
								</div>
								<div className="cc-hero-temp">
									<span className="cc-hero-int">{int}</span>
									<span className="cc-hero-side">
										<span className="cc-hero-unit">{view.unit}</span>
										<span className="cc-hero-dec">.{dec}</span>
									</span>
								</div>
							</div>
							<div className="cc-hero-btns">
								<RoundBtn
									icon="plus"
									size={42}
									onClick={() => step(1)}
									disabled={view.unavailable}
								/>
								<RoundBtn
									icon="minus"
									size={42}
									onClick={() => step(-1)}
									disabled={view.unavailable}
								/>
							</div>
							<div className="cc-hero-bar">
								<div
									className="cc-hero-fill"
									style={{
										width: `${frac * 100}%`,
										background: `linear-gradient(90deg, ${style.c1}, ${style.c2})`,
										boxShadow: `0 0 12px ${style.glow}`,
									}}
								/>
							</div>
						</div>

						{view.modes.length ? (
							<div className="cc-tile">
								<div className="cc-tile-label">Mode</div>
								<ModeGrid view={view} onSelect={climate.setMode} />
							</div>
						) : null}

						{view.fanModes.length ? (
							<div className="cc-tile">
								<div className="cc-tile-label">Fan</div>
								<FanChips
									view={view}
									accent={style.accent}
									onSelect={climate.setFan}
								/>
							</div>
						) : null}

						{view.current !== null ? (
							<div className="cc-tile cc-tile-wide cc-indoor">
								<span className="cc-indoor-label">
									<ClimateGlyph icon="thermometer" size={15} />
									Indoor now
								</span>
								<span className="cc-indoor-val">
									{view.current}
									{view.unit}
								</span>
							</div>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
}
