import { useEffect, useRef, useState } from "react";
import type {
	CSSProperties,
	KeyboardEvent as ReactKeyboardEvent,
	PointerEvent as ReactPointerEvent,
} from "react";
import { Modal, Text } from "@mantine/core";
import { useTopic } from "../../lib/socket.js";
import { WidgetCard, type WidgetRenderProps } from "../registry.js";
import {
	clamp,
	hsl,
	toView,
	toggleEntity,
	lightTurnOn,
	IconLock,
	IconX,
	LightGlyph,
	type EntityPayload,
	type Hsl,
	type LightView,
} from "./shared.js";

type Variant = "switch" | "dimmer" | "colour";

/**
 * One entity, one switch — the wall-panel light switch family from
 * temp/lightswitch-v2-lumen.html. The variant is picked from the entity's
 * capabilities (attributes, not domain):
 *
 *   on/off only            → simple tile   (tap anywhere to toggle)
 *   brightness             → dimmer pill   (tap toggles, vertical drag dims)
 *   colour modes           → dimmer pill + colour-wheel button (modal)
 *
 * Any toggleable entity is welcome: a switch.* outlet feeding a lamp gets the
 * simple tile automatically because it has no brightness/colour attributes.
 *
 * props: {
 *   entity: "light.study_lamp",        // any toggleable entity id
 *   integration?: "ha",
 *   label?: "Study lamp",              // override the HA friendly name
 *   icon?: "lamp",                     // bulb | lamp | lamp-floor | bed | plug
 *   variant?: "dimmer",                // force switch | dimmer | colour
 * }
 */
export function LightWidget({ config }: WidgetRenderProps) {
	const integration =
		typeof config.props.integration === "string" ? config.props.integration : "ha";
	const entity = typeof config.props.entity === "string" ? config.props.entity : undefined;
	const payload = useTopic<EntityPayload>(entity ? `${integration}/entity/${entity}` : undefined);

	if (!entity) {
		return (
			<WidgetCard title={config.title}>
				<Text c="var(--text-muted)">light needs an “entity” prop</Text>
			</WidgetCard>
		);
	}

	const view = toView(entity, payload, config.props.icon);
	const name = (typeof config.props.label === "string" && config.props.label) || view.name;

	if (view.waiting) {
		return (
			<WidgetCard title={config.title}>
				<Text c="var(--text-primary)" truncate>
					{name}
				</Text>
				<Text size="xs" c="var(--text-muted)">
					waiting for Home Assistant…
				</Text>
			</WidgetCard>
		);
	}

	const variantProp = config.props.variant;
	const variant: Variant =
		variantProp === "switch" || variantProp === "dimmer" || variantProp === "colour"
			? variantProp
			: view.colourable
				? "colour"
				: view.dimmable
					? "dimmer"
					: "switch";
	// A forced variant changes the UI, never the service-call rules: brightness
	// and colour still only ever go to light.* entities.
	const canDim = entity.startsWith("light.");

	const onToggle = () => toggleEntity(integration, entity);
	const onSetBrightness = (pct: number) => {
		if (canDim) lightTurnOn(integration, [entity], { brightness_pct: pct });
	};

	return (
		<WidgetCard title={config.title}>
			{variant === "switch" ? (
				<SimpleTile view={view} name={name} onToggle={onToggle} />
			) : (
				<PillTile
					view={view}
					name={name}
					colourable={variant === "colour" && canDim}
					canDim={canDim && view.dimmable}
					onToggle={onToggle}
					onSetBrightness={onSetBrightness}
					onSetColour={(h, s) => {
						if (canDim) lightTurnOn(integration, [entity], { hs_color: [h, s] });
					}}
				/>
			)}
		</WidgetCard>
	);
}

/* ── 01 · simple tile — tap the whole thing to toggle ─────────────────────── */

function SimpleTile({
	view,
	name,
	onToggle,
}: {
	view: LightView;
	name: string;
	onToggle: () => void;
}) {
	const on = view.on && !view.unavailable;
	const c = view.colour;
	return (
		<button
			type="button"
			className={`lw-simple${view.unavailable ? " is-unavailable" : ""}`}
			role="switch"
			aria-checked={view.on}
			aria-label={name}
			disabled={view.unavailable}
			onClick={onToggle}
			style={
				on
					? {
							borderColor: hsl(c, 0.45),
							boxShadow: `0 8px 26px ${hsl(c, 0.18)}`,
							background: `radial-gradient(130% 130% at 18% 0%, ${hsl(c, 0.14)}, transparent 55%) rgba(0, 0, 0, 0.3)`,
						}
					: undefined
			}
		>
			{view.unavailable ? (
				<span className="lw-simple-lock">
					<IconLock />
				</span>
			) : null}
			<span
				className="lw-simple-dot"
				style={on ? { background: hsl(c, 0.2), color: hsl(c) } : undefined}
			>
				<LightGlyph icon={view.icon} size={20} />
			</span>
			<span className="lw-simple-meta">
				<span className="lw-simple-name">{name}</span>
				<span className="lw-simple-stat">
					{view.unavailable ? "Unavailable" : on ? "On" : "Off"}
				</span>
			</span>
		</button>
	);
}

/* ── 02/03 · dimmer pill (+ optional colour button) ───────────────────────── */

function PillTile({
	view,
	name,
	colourable,
	canDim,
	onToggle,
	onSetBrightness,
	onSetColour,
}: {
	view: LightView;
	name: string;
	colourable: boolean;
	canDim: boolean;
	onToggle: () => void;
	onSetBrightness: (pct: number) => void;
	onSetColour: (h: number, s: number) => void;
}) {
	const [modalOpen, setModalOpen] = useState(false);
	const on = view.on && !view.unavailable;
	const c = view.colour;
	return (
		<div className="lw-ptile">
			<DimmerPill
				view={view}
				name={name}
				canDim={canDim}
				onToggle={onToggle}
				onSetBrightness={onSetBrightness}
			/>
			<div className="lw-pmeta">
				<div className="lw-pname">{name}</div>
				<div className="lw-pstat">
					{view.unavailable ? "Unavailable" : on ? `On · ${view.briPct}%` : "Off"}
				</div>
			</div>
			{colourable ? (
				<>
					<button
						type="button"
						className="lw-cbtn"
						aria-label={`${name} colour`}
						disabled={view.unavailable}
						onClick={() => setModalOpen(true)}
						style={{ "--cur": hsl(c) } as CSSProperties}
					/>
					<ColourModal
						opened={modalOpen}
						onClose={() => setModalOpen(false)}
						name={name}
						colour={c}
						onSetColour={onSetColour}
					/>
				</>
			) : null}
		</div>
	);
}

/**
 * Vertical brightness pill: tap toggles, a vertical drag dims (1–100%).
 * The dragged value renders locally while the pointer is down — service calls
 * are throttled — then the pill settles back to what the entity topic says.
 */
function DimmerPill({
	view,
	name,
	canDim,
	onToggle,
	onSetBrightness,
}: {
	view: LightView;
	name: string;
	canDim: boolean;
	onToggle: () => void;
	onSetBrightness: (pct: number) => void;
}) {
	const [local, setLocal] = useState<number | null>(null);
	const pid = useRef<number | null>(null);
	const startY = useRef(0);
	const startBri = useRef(0);
	const moved = useRef(false);
	const lastSentAt = useRef(0);
	const lastSentPct = useRef<number | null>(null);
	const settleTimer = useRef<number | undefined>(undefined);

	useEffect(() => {
		if (pid.current == null) setLocal(null);
	}, [view.briPct, view.on]);
	useEffect(() => () => window.clearTimeout(settleTimer.current), []);

	const send = (pct: number) => {
		lastSentAt.current = Date.now();
		lastSentPct.current = pct;
		onSetBrightness(pct);
	};
	const settleSoon = () => {
		window.clearTimeout(settleTimer.current);
		settleTimer.current = window.setTimeout(() => setLocal(null), 1500);
	};
	const pctFrom = (e: ReactPointerEvent<HTMLDivElement>) => {
		const height = e.currentTarget.clientHeight || 1;
		return clamp(
			Math.round(startBri.current + ((startY.current - e.clientY) / height) * 100),
			1,
			100,
		);
	};

	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (view.unavailable) return;
		pid.current = e.pointerId;
		e.currentTarget.setPointerCapture(e.pointerId);
		window.clearTimeout(settleTimer.current);
		startY.current = e.clientY;
		startBri.current = view.on ? (local ?? view.briPct) : 0;
		moved.current = false;
	};
	const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (pid.current !== e.pointerId) return;
		if (Math.abs(startY.current - e.clientY) > 6) moved.current = true;
		if (!moved.current || !canDim) return;
		const pct = pctFrom(e);
		setLocal(pct);
		if (Date.now() - lastSentAt.current > 300) send(pct);
	};
	const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (pid.current !== e.pointerId) return;
		pid.current = null;
		if (!moved.current) {
			onToggle();
			return;
		}
		if (!canDim) return;
		const pct = pctFrom(e);
		setLocal(pct);
		if (pct !== lastSentPct.current) send(pct);
		settleSoon();
	};
	const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
		if (view.unavailable) return;
		if ((e.key === "ArrowUp" || e.key === "ArrowDown") && canDim) {
			const base = local ?? (view.on ? view.briPct : 0);
			const pct = clamp(base + (e.key === "ArrowUp" ? 5 : -5), 1, 100);
			setLocal(pct);
			send(pct);
			settleSoon();
			e.preventDefault();
		} else if (e.key === "Enter" || e.key === " ") {
			onToggle();
			e.preventDefault();
		}
	};

	const on = view.on && !view.unavailable;
	const active = on || local != null;
	const shown = local ?? (on ? view.briPct : 0);
	const c = view.colour;
	return (
		<div
			className={`lw-pill${view.unavailable ? " is-disabled" : ""}${local != null ? " is-dragging" : ""}`}
			role="slider"
			tabIndex={view.unavailable ? -1 : 0}
			aria-label={`${name} brightness`}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={active ? shown : 0}
			aria-disabled={view.unavailable || undefined}
			style={
				on
					? { borderColor: hsl(c, 0.5), boxShadow: `0 10px 30px ${hsl(c, 0.25)}` }
					: undefined
			}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerEnd}
			onPointerCancel={onPointerEnd}
			onKeyDown={onKeyDown}
		>
			<div
				className="lw-pill-fill"
				style={{
					height: active ? `${shown}%` : "0%",
					background: `linear-gradient(180deg, ${hsl(c)}, ${hsl({ ...c, l: Math.max(c.l - 14, 20) })})`,
				}}
			/>
			<div className="lw-pill-pct">
				{view.unavailable ? "" : active ? `${shown}%` : "Off"}
			</div>
			<div
				className="lw-pill-icon"
				style={
					active && shown > 16
						? { color: "var(--page-plane)" }
						: active
							? { color: hsl(c) }
							: undefined
				}
			>
				{view.unavailable ? <IconLock /> : <LightGlyph icon={view.icon} />}
			</div>
		</div>
	);
}

/* ── 03 · colour modal — preset swatches + hue slider ─────────────────────── */

const PRESETS: { name: string; h: number; s: number; l: number }[] = [
	{ name: "Warm white", h: 40, s: 95, l: 62 },
	{ name: "Soft white", h: 32, s: 40, l: 80 },
	{ name: "Red", h: 2, s: 80, l: 58 },
	{ name: "Orange", h: 26, s: 90, l: 56 },
	{ name: "Gold", h: 48, s: 92, l: 55 },
	{ name: "Green", h: 132, s: 55, l: 50 },
	{ name: "Teal", h: 172, s: 60, l: 46 },
	{ name: "Sky", h: 200, s: 82, l: 58 },
	{ name: "Blue", h: 224, s: 80, l: 62 },
	{ name: "Violet", h: 262, s: 72, l: 64 },
	{ name: "Magenta", h: 308, s: 70, l: 56 },
	{ name: "Pink", h: 334, s: 82, l: 70 },
];

function ColourModal({
	opened,
	onClose,
	name,
	colour,
	onSetColour,
}: {
	opened: boolean;
	onClose: () => void;
	name: string;
	colour: Hsl;
	onSetColour: (h: number, s: number) => void;
}) {
	const [localHue, setLocalHue] = useState<number | null>(null);
	const lastSentAt = useRef(0);
	const lastSentHue = useRef<number | null>(null);
	const settleTimer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(settleTimer.current), []);

	const sendHue = (h: number) => {
		lastSentAt.current = Date.now();
		lastSentHue.current = h;
		onSetColour(h, 85);
	};
	const onHueInput = (h: number) => {
		setLocalHue(h);
		if (Date.now() - lastSentAt.current > 300) sendHue(h);
	};
	const onHueCommit = () => {
		if (localHue != null && localHue !== lastSentHue.current) sendHue(localHue);
		window.clearTimeout(settleTimer.current);
		settleTimer.current = window.setTimeout(() => setLocalHue(null), 1500);
	};

	const hue = localHue ?? colour.h;
	return (
		<Modal
			opened={opened}
			onClose={onClose}
			centered
			withCloseButton={false}
			size={360}
			radius={26}
			overlayProps={{ backgroundOpacity: 0.66, blur: 4 }}
			classNames={{ content: "lw-sheet", body: "lw-sheet-body" }}
		>
			<div className="lw-sheet-head">
				<div>
					<div className="lw-sheet-title">Colour</div>
					<div className="lw-sheet-sub">{name}</div>
				</div>
				<button type="button" className="lw-sheet-x" aria-label="Close" onClick={onClose}>
					<IconX />
				</button>
			</div>
			<div className="lw-swgrid" role="group" aria-label="Colour presets">
				{PRESETS.map((p) => (
					<button
						key={p.name}
						type="button"
						className="lw-sw"
						title={p.name}
						aria-label={p.name}
						aria-pressed={p.h === colour.h && p.s === colour.s}
						style={{ background: hsl(p) }}
						onClick={() => onSetColour(p.h, p.s)}
					/>
				))}
			</div>
			<div className="lw-huelabel">Hue</div>
			<input
				type="range"
				className="lw-hue"
				min={0}
				max={360}
				step={1}
				aria-label="Hue"
				value={hue}
				onChange={(e) => onHueInput(Number(e.currentTarget.value))}
				onPointerUp={onHueCommit}
				onKeyUp={onHueCommit}
			/>
			<button type="button" className="lw-done" onClick={onClose}>
				Done
			</button>
		</Modal>
	);
}
