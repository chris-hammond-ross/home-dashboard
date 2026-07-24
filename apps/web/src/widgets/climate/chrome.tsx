import type { CSSProperties } from "react";
import { SegmentedControl } from "@mantine/core";
import { PowerButton } from "./controls.js";
import type { ClimateView, ModeStyle } from "./model.js";

/** Shared card background — a soft radial wash of the current mode accent. */
export function cardBackground(style: ModeStyle): CSSProperties {
	return {
		background: `radial-gradient(120% 90% at 50% 0%, ${style.accent}1a, transparent 55%), #121214`,
	};
}

/** Shown when no entity is configured yet. */
export function EmptyState({ title }: { title?: string }) {
	return (
		<div className="cc-root cc-empty">
			<div className="cc-empty-inner">
				{title ? <div className="cc-empty-title">{title}</div> : null}
				<div className="cc-empty-msg">Add a climate entity in settings to control it.</div>
			</div>
		</div>
	);
}

/** Shown while the entity's first payload is still in flight. */
export function WaitingState({ title, name }: { title?: string; name: string }) {
	return (
		<div className="cc-root cc-empty">
			<div className="cc-empty-inner">
				<div className="cc-empty-title">{title ?? name}</div>
				<div className="cc-empty-msg">Waiting for Home Assistant…</div>
			</div>
		</div>
	);
}

export type ClimateTab = "controls" | "zones";

/**
 * Top bar for every variant: the Controls / Zones SegmentedControl (only when
 * zones exist) on the left, the power button on the right. Both are tinted with
 * the current mode's accent.
 */
export function ControlBar({
	view,
	style,
	tab,
	setTab,
	hasZones,
	onTogglePower,
}: {
	view: ClimateView;
	style: ModeStyle;
	tab: ClimateTab;
	setTab: (t: ClimateTab) => void;
	hasZones: boolean;
	onTogglePower: () => void;
}) {
	return (
		<div className="cc-bar">
			{hasZones ? (
				<SegmentedControl
					size="sm"
					radius="md"
					value={tab}
					onChange={(v) => setTab(v as ClimateTab)}
					data={[
						{ label: "Controls", value: "controls" },
						{ label: "Zones", value: "zones" },
					]}
					classNames={{
						root: "cc-seg-root",
						control: "cc-seg-ctrl",
						label: "cc-seg-label",
					}}
					styles={{ indicator: { background: style.accent } }}
				/>
			) : null}
			<div className="cc-bar-spacer" />
			<PowerButton
				on={view.on}
				accent={style.accent}
				onClick={onTogglePower}
				disabled={view.unavailable}
			/>
		</div>
	);
}
