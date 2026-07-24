import { useState } from "react";
import type { WidgetRenderProps } from "../registry.js";
import { modeStyle, snap, useClimate } from "./model.js";
import { LedMeter, ModeList, SqBtn, VFader, ZoneChannelStrip, useDragValue } from "./controls.js";
import { ClimateGlyph } from "./icons.js";
import { cardBackground, ControlBar, EmptyState, WaitingState, type ClimateTab } from "./chrome.js";
import "./climate.css";

/**
 * "Studio" — a mixing-desk take: a channel-strip temperature fader beside a mode
 * list and an LED fan meter. The Zones tab becomes a mixer, one fader per damper
 * with the setpoint as the master channel.
 */
export function StudioVariant({ config }: WidgetRenderProps) {
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
		<div className="cc-root cc-studio">
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
					<div className="cc-mixer cc-scroll">
						<div className="cc-channel">
							<div className="cc-channel-val">{view.target.toFixed(1)}</div>
							<VFader
								value={temp.shown}
								min={view.min}
								max={view.max}
								step={view.step}
								style={style}
								onInput={temp.preview}
								onCommit={temp.commit}
								height={150}
								width={46}
								ticks
								disabled={view.unavailable}
							/>
							<div style={{ height: 26 }} />
							<div className="cc-channel-name">MASTER</div>
						</div>
						<div className="cc-channel-divider" />
						{zones.map((zone) => (
							<ZoneChannelStrip
								key={zone.entity}
								climate={climate}
								zone={zone}
								style={style}
							/>
						))}
					</div>
				) : (
					<div className="cc-studio-body">
						<div className="cc-studio-left">
							<div className="cc-studio-readout">
								{view.target.toFixed(1)}
								<span>{view.unit}</span>
							</div>
							{view.current !== null ? (
								<div className="cc-studio-current">
									<ClimateGlyph icon="thermometer" size={12} />
									{view.current}
									{view.unit}
								</div>
							) : null}
							<div className="cc-lbl">TARGET</div>
							<VFader
								value={temp.shown}
								min={view.min}
								max={view.max}
								step={view.step}
								style={style}
								onInput={temp.preview}
								onCommit={temp.commit}
								height={196}
								width={68}
								disabled={view.unavailable}
							/>
							<div className="cc-studio-steppers">
								<SqBtn
									icon="minus"
									onClick={() => temp.commit(snap(view, view.target - view.step))}
									disabled={view.unavailable}
								/>
								<SqBtn
									icon="plus"
									onClick={() => temp.commit(snap(view, view.target + view.step))}
									disabled={view.unavailable}
								/>
							</div>
						</div>
						<div className="cc-studio-right">
							{view.modes.length ? (
								<div>
									<div className="cc-lbl">MODE</div>
									<ModeList view={view} onSelect={climate.setMode} />
								</div>
							) : null}
							{view.fanModes.length ? (
								<div>
									<div className="cc-lbl">FAN</div>
									<LedMeter
										view={view}
										accent={style.accent}
										onSelect={climate.setFan}
									/>
								</div>
							) : null}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
