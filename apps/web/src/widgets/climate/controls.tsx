import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { ClimateGlyph, SpinningFan, type ClimateIcon } from "./icons.js";
import {
	clamp,
	modeStyle,
	prettyMode,
	splitTemp,
	type Climate,
	type ClimateView,
	type ModeStyle,
	type ZoneView,
} from "./model.js";

/* ── drag value: local while the finger is down, then settle to the topic ──────
 * Mirrors the light dimmer: shows the dragged value immediately, throttles the
 * service calls, and — 1.5s after release — drops back to whatever the entity
 * reports, so the panel always ends up telling the truth. */

export function useDragValue(remote: number, send: (v: number) => void) {
	const [local, setLocal] = useState<number | null>(null);
	const dragging = useRef(false);
	const lastSentAt = useRef(0);
	const settle = useRef<number | undefined>(undefined);

	useEffect(() => {
		if (!dragging.current) setLocal(null);
	}, [remote]);
	useEffect(() => () => window.clearTimeout(settle.current), []);

	const shown = local ?? remote;
	const preview = (v: number) => {
		dragging.current = true;
		setLocal(v);
		if (Date.now() - lastSentAt.current > 250) {
			lastSentAt.current = Date.now();
			send(v);
		}
	};
	const commit = (v: number) => {
		dragging.current = false;
		setLocal(v);
		send(v);
		window.clearTimeout(settle.current);
		settle.current = window.setTimeout(() => setLocal(null), 1500);
	};
	return { shown, preview, commit };
}

const snapTo = (v: number, min: number, max: number, step: number) =>
	clamp(Math.round(Math.round(v / step) * step * 100) / 100, min, max);

const rad = (d: number) => (d * Math.PI) / 180;
const polar = (cx: number, cy: number, r: number, deg: number) => ({
	x: cx + r * Math.cos(rad(deg)),
	y: cy + r * Math.sin(rad(deg)),
});

/* ── little buttons ────────────────────────────────────────────────────────── */

export function RoundBtn({
	icon,
	onClick,
	size = 44,
	disabled,
}: {
	icon: ClimateIcon;
	onClick: () => void;
	size?: number;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			className="cc-round"
			aria-label={icon}
			disabled={disabled}
			onClick={onClick}
			onPointerDown={(e) => e.stopPropagation()}
			style={{ width: size, height: size }}
		>
			<ClimateGlyph icon={icon} size={Math.round(size * 0.42)} />
		</button>
	);
}

export function SqBtn({
	icon,
	onClick,
	disabled,
}: {
	icon: ClimateIcon;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			className="cc-sq"
			aria-label={icon}
			disabled={disabled}
			onClick={onClick}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<ClimateGlyph icon={icon} size={16} />
		</button>
	);
}

export function PowerButton({
	on,
	onClick,
	disabled,
	accent,
}: {
	on: boolean;
	onClick: () => void;
	disabled?: boolean;
	/** When on, tint the button with the current mode's accent. */
	accent?: string;
}) {
	return (
		<button
			type="button"
			className={`cc-power${on ? " is-on" : ""}`}
			aria-label={on ? "Turn off" : "Turn on"}
			aria-pressed={on}
			disabled={disabled}
			onClick={onClick}
			style={
				on && accent
					? { background: accent, borderColor: "transparent", color: "#0d0d0f" }
					: undefined
			}
		>
			<ClimateGlyph icon="power" size={18} />
		</button>
	);
}

/* ── radial dial (Radial variant) ───────────────────────────────────────────── */

export function RadialDial({
	view,
	style,
	onInput,
	onCommit,
	size = 264,
	stroke = 16,
}: {
	view: ClimateView;
	style: ModeStyle;
	onInput: (v: number) => void;
	onCommit: (v: number) => void;
	size?: number;
	stroke?: number;
}) {
	const uid = useId().replace(/[:]/g, "");
	const svgRef = useRef<SVGSVGElement>(null);
	const [dragging, setDragging] = useState(false);
	const disabled = view.unavailable;

	const cx = size / 2;
	const cy = size / 2;
	const r = size / 2 - stroke / 2 - 6;
	const frac = clamp((view.target - view.min) / (view.max - view.min || 1), 0, 1);
	const start = polar(cx, cy, r, 135);
	const end = polar(cx, cy, r, 405);
	const track = `M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${end.x} ${end.y}`;
	const handleBase = polar(cx, cy, r, 135);
	const PATHLEN = 1000;
	const offset = PATHLEN * (1 - frac);
	const { int, dec } = splitTemp(view.target);
	const trans = dragging ? "none" : ".5s cubic-bezier(.2,.8,.2,1)";

	const valueFrom = (clientX: number, clientY: number) => {
		const rect = svgRef.current?.getBoundingClientRect();
		if (!rect) return view.target;
		const px = rect.left + rect.width / 2;
		const py = rect.top + rect.height / 2;
		let ang = (Math.atan2(clientY - py, clientX - px) * 180) / Math.PI;
		if (ang < 0) ang += 360;
		let rel: number;
		if (ang >= 135) rel = ang - 135;
		else if (ang < 45) rel = ang + 225;
		else rel = ang < 90 ? 270 : 0;
		return snapTo(
			view.min + (rel / 270) * (view.max - view.min),
			view.min,
			view.max,
			view.step,
		);
	};

	const down = (e: ReactPointerEvent<SVGSVGElement>) => {
		if (disabled) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		setDragging(true);
		onInput(valueFrom(e.clientX, e.clientY));
	};
	const move = (e: ReactPointerEvent<SVGSVGElement>) => {
		if (dragging) onInput(valueFrom(e.clientX, e.clientY));
	};
	const up = (e: ReactPointerEvent<SVGSVGElement>) => {
		if (!dragging) return;
		setDragging(false);
		onCommit(valueFrom(e.clientX, e.clientY));
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			/* pointer already released */
		}
	};
	const key = (e: ReactKeyboardEvent<SVGSVGElement>) => {
		if (disabled) return;
		if (e.key === "ArrowUp" || e.key === "ArrowRight") {
			onCommit(snapTo(view.target + view.step, view.min, view.max, view.step));
			e.preventDefault();
		} else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
			onCommit(snapTo(view.target - view.step, view.min, view.max, view.step));
			e.preventDefault();
		}
	};

	return (
		<div className="cc-dial" style={{ width: size, height: size }}>
			<svg
				ref={svgRef}
				viewBox={`0 0 ${size} ${size}`}
				width={size}
				height={size}
				tabIndex={disabled ? -1 : 0}
				role="slider"
				aria-valuemin={view.min}
				aria-valuemax={view.max}
				aria-valuenow={view.target}
				aria-label="target temperature"
				aria-disabled={disabled || undefined}
				onPointerDown={down}
				onPointerMove={move}
				onPointerUp={up}
				onPointerCancel={up}
				onKeyDown={key}
			>
				<defs>
					<linearGradient id={`g-${uid}`} x1="0" y1="1" x2="1" y2="0">
						<stop offset="0%" stopColor={style.c1} />
						<stop offset="100%" stopColor={style.c2} />
					</linearGradient>
				</defs>
				<path
					d={track}
					stroke="rgba(255,255,255,0.06)"
					strokeWidth={stroke}
					fill="none"
					strokeLinecap="round"
				/>
				<path
					d={track}
					stroke={`url(#g-${uid})`}
					strokeWidth={stroke}
					fill="none"
					strokeLinecap="round"
					pathLength={PATHLEN}
					strokeDasharray={PATHLEN}
					strokeDashoffset={offset}
					style={{
						transition: `stroke-dashoffset ${trans}, stroke .4s`,
						filter: `drop-shadow(0 0 6px ${style.glow})`,
					}}
				/>
				<g
					style={{
						transformBox: "view-box",
						transformOrigin: `${cx}px ${cy}px`,
						transform: `rotate(${frac * 270}deg)`,
						transition: `transform ${trans}`,
					}}
				>
					<circle cx={handleBase.x} cy={handleBase.y} r={stroke / 2 + 4} fill="#0d0d0f" />
					<circle
						cx={handleBase.x}
						cy={handleBase.y}
						r={stroke / 2 - 1}
						fill="#fff"
						style={{ filter: `drop-shadow(0 0 8px ${style.glow})` }}
					/>
				</g>
			</svg>
			<div className="cc-dial-face">
				<div className="cc-dial-mode" style={{ color: style.accent }}>
					{view.on ? style.label : "Off"}
				</div>
				<div className="cc-dial-temp">
					<span className="cc-dial-int">{int}</span>
					<span className="cc-dial-side">
						<span className="cc-dial-unit">{view.unit}</span>
						<span className="cc-dial-dec">.{dec}</span>
					</span>
				</div>
				{view.current !== null ? (
					<div className="cc-dial-ambient">
						<ClimateGlyph icon="thermometer" size={14} />
						<span>
							{view.current}
							{view.unit}
						</span>
					</div>
				) : null}
			</div>
		</div>
	);
}

/* ── vertical fader (Studio variant + master channel) ──────────────────────── */

export function VFader({
	value,
	min,
	max,
	step,
	style,
	onInput,
	onCommit,
	height = 220,
	width = 64,
	ticks = false,
	disabled,
}: {
	value: number;
	min: number;
	max: number;
	step: number;
	style: ModeStyle;
	onInput: (v: number) => void;
	onCommit: (v: number) => void;
	height?: number;
	width?: number;
	ticks?: boolean;
	disabled?: boolean;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [drag, setDrag] = useState(false);
	const frac = clamp((value - min) / (max - min || 1), 0, 1);

	const valueFrom = (clientY: number) => {
		const rect = ref.current?.getBoundingClientRect();
		if (!rect) return value;
		const f = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
		return snapTo(min + f * (max - min), min, max, step);
	};
	const down = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (disabled) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		setDrag(true);
		onInput(valueFrom(e.clientY));
	};
	const move = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (drag) onInput(valueFrom(e.clientY));
	};
	const up = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!drag) return;
		setDrag(false);
		onCommit(valueFrom(e.clientY));
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			/* already released */
		}
	};
	const t = drag ? "none" : ".3s cubic-bezier(.2,.8,.2,1)";

	return (
		<div
			ref={ref}
			className={`cc-fader${disabled ? " is-disabled" : ""}`}
			role="slider"
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={value}
			aria-disabled={disabled || undefined}
			style={{ width, height }}
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={up}
			onPointerCancel={up}
		>
			{ticks
				? [...Array(9)].map((_, i) => (
						<div
							key={i}
							className="cc-fader-tick"
							style={{ top: `${(i / 8) * 100}%` }}
						/>
					))
				: null}
			<div
				className="cc-fader-fill"
				style={{
					height: `${frac * 100}%`,
					background: `linear-gradient(to top, ${style.c1}, ${style.c2})`,
					transition: `height ${t}`,
					boxShadow: `0 0 26px ${style.glow}`,
				}}
			/>
			<div
				className="cc-fader-knob"
				style={{
					bottom: `calc(${frac * 100}% - 3px)`,
					boxShadow: `0 0 10px ${style.accent}`,
					transition: `bottom ${t}`,
				}}
			/>
		</div>
	);
}

/* ── horizontal 0–100 slider (Radial zone dampers) ─────────────────────────── */

export function HSlider({
	value,
	style,
	onInput,
	onCommit,
	disabled,
}: {
	value: number;
	style: ModeStyle;
	onInput: (v: number) => void;
	onCommit: (v: number) => void;
	disabled?: boolean;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [drag, setDrag] = useState(false);
	const valueFrom = (clientX: number) => {
		const rect = ref.current?.getBoundingClientRect();
		if (!rect) return value;
		const f = clamp((clientX - rect.left) / rect.width, 0, 1);
		return Math.round((f * 100) / 5) * 5;
	};
	const down = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (disabled) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		setDrag(true);
		onInput(valueFrom(e.clientX));
	};
	const move = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (drag) onInput(valueFrom(e.clientX));
	};
	const up = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!drag) return;
		setDrag(false);
		onCommit(valueFrom(e.clientX));
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			/* already released */
		}
	};
	const t = drag ? "none" : ".25s";

	return (
		<div
			ref={ref}
			className={`cc-hslider${disabled ? " is-disabled" : ""}`}
			role="slider"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={value}
			aria-disabled={disabled || undefined}
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={up}
			onPointerCancel={up}
		>
			<div className="cc-hslider-track" />
			<div
				className="cc-hslider-fill"
				style={{
					width: `${value}%`,
					background: `linear-gradient(90deg, ${style.c1}, ${style.c2})`,
					transition: `width ${t}`,
					boxShadow: `0 0 10px ${style.glow}`,
				}}
			/>
			<div
				className="cc-hslider-knob"
				style={{
					left: `calc(${value}% - 9px)`,
					boxShadow: `0 0 8px ${style.glow}`,
					transition: `left ${t}`,
				}}
			/>
		</div>
	);
}

/* ── progress ring (Bento zone dampers) ─────────────────────────────────────── */

export function Ring({
	value,
	style,
	onInput,
	onCommit,
	size = 104,
	stroke = 10,
	disabled,
}: {
	value: number;
	style: ModeStyle;
	onInput: (v: number) => void;
	onCommit: (v: number) => void;
	size?: number;
	stroke?: number;
	disabled?: boolean;
}) {
	const uid = useId().replace(/[:]/g, "");
	const start = useRef<{ y: number; v: number } | null>(null);
	const [drag, setDrag] = useState(false);
	const r = (size - stroke) / 2;
	const C = 2 * Math.PI * r;
	const off = C * (1 - value / 100);

	const down = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (disabled) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		start.current = { y: e.clientY, v: value };
		setDrag(true);
	};
	const move = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!drag || !start.current) return;
		const dy = start.current.y - e.clientY;
		onInput(Math.round(clamp(start.current.v + dy * 0.6, 0, 100) / 5) * 5);
	};
	const up = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!drag || !start.current) return;
		const dy = start.current.y - e.clientY;
		onCommit(Math.round(clamp(start.current.v + dy * 0.6, 0, 100) / 5) * 5);
		setDrag(false);
		start.current = null;
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			/* already released */
		}
	};

	return (
		<div
			className={`cc-ring${disabled ? " is-disabled" : ""}`}
			role="slider"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={value}
			aria-disabled={disabled || undefined}
			style={{ width: size, height: size }}
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={up}
			onPointerCancel={up}
		>
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
				<defs>
					<linearGradient id={`r-${uid}`} x1="0" y1="0" x2="1" y2="1">
						<stop offset="0%" stopColor={style.c1} />
						<stop offset="100%" stopColor={style.c2} />
					</linearGradient>
				</defs>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					stroke="rgba(255,255,255,0.08)"
					strokeWidth={stroke}
					fill="none"
				/>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					stroke={`url(#r-${uid})`}
					strokeWidth={stroke}
					fill="none"
					strokeLinecap="round"
					strokeDasharray={C}
					strokeDashoffset={off}
					transform={`rotate(-90 ${size / 2} ${size / 2})`}
					style={{
						transition: drag
							? "none"
							: "stroke-dashoffset .3s cubic-bezier(.2,.8,.2,1)",
						filter: `drop-shadow(0 0 6px ${style.glow})`,
					}}
				/>
			</svg>
			<div
				className="cc-ring-label"
				style={{ color: value === 0 ? "rgba(255,255,255,0.4)" : "#fff" }}
			>
				{value}
				<span>%</span>
			</div>
		</div>
	);
}

/* ── mode selectors ─────────────────────────────────────────────────────────── */

export function ModePills({
	view,
	onSelect,
}: {
	view: ClimateView;
	onSelect: (mode: string) => void;
}) {
	return (
		<div className="cc-pills">
			{view.modes.map((m) => {
				const s = modeStyle(m);
				const active = view.on && m === view.mode;
				return (
					<button
						key={m}
						type="button"
						className={`cc-pill${active ? " is-active" : ""}`}
						onClick={() => onSelect(m)}
						style={
							active
								? {
										background: `linear-gradient(135deg, ${s.c1}, ${s.c2})`,
										boxShadow: `0 6px 18px ${s.glow}`,
									}
								: undefined
						}
					>
						<ClimateGlyph icon={s.icon} size={18} />
						{s.short}
					</button>
				);
			})}
		</div>
	);
}

/** Icon-only mode squares — the compact Bento look. */
export function ModeGrid({
	view,
	onSelect,
}: {
	view: ClimateView;
	onSelect: (mode: string) => void;
}) {
	return (
		<div className="cc-modegrid">
			{view.modes.map((m) => {
				const s = modeStyle(m);
				const active = view.on && m === view.mode;
				return (
					<button
						key={m}
						type="button"
						className={`cc-modegrid-btn${active ? " is-active" : ""}`}
						aria-label={s.label}
						title={s.label}
						onClick={() => onSelect(m)}
						style={
							active
								? {
										background: `linear-gradient(135deg, ${s.c1}, ${s.c2})`,
										boxShadow: `0 6px 16px ${s.glow}`,
									}
								: undefined
						}
					>
						<ClimateGlyph icon={s.icon} size={18} />
					</button>
				);
			})}
		</div>
	);
}

/** Vertical mode list — the Studio look. */
export function ModeList({
	view,
	onSelect,
}: {
	view: ClimateView;
	onSelect: (mode: string) => void;
}) {
	return (
		<div className="cc-modelist">
			{view.modes.map((m) => {
				const s = modeStyle(m);
				const active = view.on && m === view.mode;
				return (
					<button
						key={m}
						type="button"
						className={`cc-modelist-item${active ? " is-active" : ""}`}
						onClick={() => onSelect(m)}
						style={
							active
								? {
										background: `linear-gradient(135deg, ${s.c1}, ${s.c2})`,
										boxShadow: `0 4px 14px ${s.glow}`,
									}
								: undefined
						}
					>
						<ClimateGlyph icon={s.icon} size={15} />
						{s.label.toUpperCase()}
					</button>
				);
			})}
		</div>
	);
}

/* ── fan selectors ──────────────────────────────────────────────────────────── */

export function FanRow({
	view,
	accent,
	onSelect,
}: {
	view: ClimateView;
	accent: string;
	onSelect: (m: string) => void;
}) {
	if (!view.fanModes.length) return null;
	// A slow spinning fan sits beside the running speed. Powered off (or no fan
	// set) → a still fan parks beside the "Auto" button instead.
	const running = view.on && !!view.fanMode && view.fanMode.toLowerCase() !== "off";
	const autoMode = view.fanModes.find((f) => f.toLowerCase() === "auto") ?? view.fanModes[0];
	const iconMode = running ? view.fanMode : autoMode;
	return (
		<div className="cc-fan-row">
			{view.fanModes.map((f) => {
				const active = view.on && f === view.fanMode;
				const showIcon = f === iconMode;
				return (
					<button
						key={f}
						type="button"
						className={`cc-fan-btn${active ? " is-active" : ""}`}
						onClick={() => onSelect(f)}
						style={
							active
								? { background: accent, boxShadow: `0 6px 16px ${accent}59` }
								: undefined
						}
					>
						{showIcon ? (
							running ? (
								<SpinningFan size={20} />
							) : (
								<ClimateGlyph icon="fan" size={20} />
							)
						) : null}
						{fanLabel(f)}
					</button>
				);
			})}
		</div>
	);
}

/** LED-ladder fan meter — the Studio look. Non-auto modes light bottom→top. */
export function LedMeter({
	view,
	accent,
	onSelect,
}: {
	view: ClimateView;
	accent: string;
	onSelect: (m: string) => void;
}) {
	const ordered = view.fanModes.filter((f) => f.toLowerCase() !== "auto");
	const hasAuto = view.fanModes.some((f) => f.toLowerCase() === "auto");
	const isAuto = view.fanMode?.toLowerCase() === "auto";
	const curIdx = isAuto || !view.fanMode ? -1 : ordered.indexOf(view.fanMode);
	if (!view.fanModes.length) return null;
	return (
		<div className="cc-led">
			<div className="cc-led-stack">
				{[...ordered].reverse().map((f) => {
					const idx = ordered.indexOf(f);
					const on = !isAuto && curIdx >= idx;
					return (
						<button
							key={f}
							type="button"
							aria-label={f}
							className="cc-led-cell"
							onClick={() => onSelect(f)}
							style={
								on
									? {
											background: accent,
											boxShadow: `inset 0 0 12px ${accent}80, 0 0 10px ${accent}4d`,
										}
									: undefined
							}
						/>
					);
				})}
			</div>
			{hasAuto ? (
				<button
					type="button"
					className={`cc-led-auto${isAuto ? " is-active" : ""}`}
					onClick={() => onSelect("auto")}
				>
					AUTO
				</button>
			) : null}
		</div>
	);
}

/** Compact fan chips — the Bento look (first letter of each mode). */
export function FanChips({
	view,
	accent,
	onSelect,
}: {
	view: ClimateView;
	accent: string;
	onSelect: (m: string) => void;
}) {
	if (!view.fanModes.length) return null;
	return (
		<div className="cc-fanchips">
			{view.fanModes.map((f) => {
				const active = view.on && f === view.fanMode;
				return (
					<button
						key={f}
						type="button"
						className={`cc-fanchip${active ? " is-active" : ""}`}
						onClick={() => onSelect(f)}
						title={fanLabel(f)}
						style={active ? { background: accent, color: "#0d0d0f" } : undefined}
					>
						{fanLabel(f).charAt(0)}
					</button>
				);
			})}
		</div>
	);
}

export function fanLabel(f: string): string {
	const map: Record<string, string> = {
		auto: "Auto",
		low: "Low",
		medium: "Med",
		med: "Med",
		high: "High",
		quiet: "Quiet",
	};
	return map[f.toLowerCase()] ?? prettyMode(f);
}

/* ── mini control (compact mode+temp bar, used above the zone view) ─────────── */

export function MiniControl({
	view,
	style,
	glassy,
	onCycleMode,
	onStep,
}: {
	view: ClimateView;
	style: ModeStyle;
	glassy?: boolean;
	onCycleMode: () => void;
	onStep: (delta: number) => void;
}) {
	return (
		<div className={`cc-mini${glassy ? " is-glassy" : ""}`}>
			<button
				type="button"
				className="cc-mini-mode"
				onClick={onCycleMode}
				style={{ color: style.accent }}
			>
				<span
					className="cc-mini-badge"
					style={{ background: `linear-gradient(135deg, ${style.c1}, ${style.c2})` }}
				>
					<ClimateGlyph icon={style.icon} size={18} />
				</span>
				<span className="cc-mini-label">{view.on ? style.label : "Off"}</span>
			</button>
			<div className="cc-mini-right">
				<span className="cc-mini-temp">
					{view.target.toFixed(1)}
					<span className="cc-mini-unit">{view.unit}</span>
				</span>
				<RoundBtn
					icon="minus"
					size={36}
					onClick={() => onStep(-1)}
					disabled={view.unavailable}
				/>
				<RoundBtn
					icon="plus"
					size={36}
					onClick={() => onStep(1)}
					disabled={view.unavailable}
				/>
			</div>
		</div>
	);
}

/* ── zone channel (Studio zone mixer) ───────────────────────────────────────── */

export function ZoneChannel({
	zone,
	style,
	onInput,
	onCommit,
	onToggle,
}: {
	zone: ZoneView;
	style: ModeStyle;
	onInput: (v: number) => void;
	onCommit: (v: number) => void;
	onToggle: () => void;
}) {
	const muted = !zone.on;
	return (
		<div className="cc-channel">
			<div className={`cc-channel-val${muted ? " is-muted" : ""}`}>
				{zone.hasLevel ? zone.level : muted ? "—" : "On"}
			</div>
			{zone.hasLevel ? (
				<VFader
					value={zone.level}
					min={0}
					max={100}
					step={5}
					style={style}
					onInput={onInput}
					onCommit={onCommit}
					height={150}
					width={46}
					ticks
					disabled={zone.unavailable}
				/>
			) : (
				<div className="cc-channel-nolevel" style={{ height: 150 }}>
					<ClimateGlyph icon="power" size={18} />
				</div>
			)}
			<button
				type="button"
				className={`cc-channel-btn${muted ? "" : " is-on"}`}
				onClick={onToggle}
				disabled={zone.unavailable}
				style={muted ? undefined : { color: style.accent, background: `${style.accent}26` }}
			>
				{muted ? "OFF" : "ON"}
			</button>
			<div className="cc-channel-name" title={zone.name}>
				{zone.name.toUpperCase()}
			</div>
		</div>
	);
}

/* ── zone rows (each owns a drag hook, so they must be components) ───────────── */

/** Radial variant: a power dot + name/% + horizontal damper slider. */
export function ZoneSliderRow({
	climate,
	zone,
	style,
}: {
	climate: Climate;
	zone: ZoneView;
	style: ModeStyle;
}) {
	const d = useDragValue(zone.level, (v) => climate.setZoneLevel(zone, v));
	const closed = !zone.on;
	return (
		<div className="cc-zone-row">
			<button
				type="button"
				className={`cc-zone-toggle${closed ? "" : " is-on"}`}
				aria-label={`toggle ${zone.name}`}
				onClick={() => climate.toggleZone(zone)}
				disabled={zone.unavailable}
				style={closed ? undefined : { color: style.accent }}
			>
				<ClimateGlyph icon="power" size={16} />
			</button>
			<div className="cc-zone-main">
				<div className="cc-zone-head">
					<span className="cc-zone-name" style={{ opacity: closed ? 0.5 : 1 }}>
						{zone.name}
					</span>
					<span
						className="cc-zone-val"
						style={closed ? undefined : { color: style.accent }}
					>
						{zone.hasLevel
							? closed
								? "Closed"
								: `${d.shown}%`
							: closed
								? "Off"
								: "On"}
					</span>
				</div>
				{zone.hasLevel ? (
					<HSlider
						value={d.shown}
						style={style}
						onInput={d.preview}
						onCommit={d.commit}
						disabled={zone.unavailable}
					/>
				) : null}
			</div>
		</div>
	);
}

/** Bento variant: a progress-ring damper tile. */
export function ZoneRingTile({
	climate,
	zone,
	style,
}: {
	climate: Climate;
	zone: ZoneView;
	style: ModeStyle;
}) {
	const d = useDragValue(zone.level, (v) => climate.setZoneLevel(zone, v));
	const closed = !zone.on;
	return (
		<div className="cc-ztile">
			{zone.hasLevel ? (
				<Ring
					value={d.shown}
					style={style}
					onInput={d.preview}
					onCommit={d.commit}
					disabled={zone.unavailable}
				/>
			) : (
				<div
					className="cc-ztile-onoff"
					style={closed ? undefined : { color: style.accent }}
				>
					<ClimateGlyph icon="power" size={26} />
				</div>
			)}
			<div className="cc-ztile-foot">
				<span
					className="cc-ztile-name"
					style={{ color: closed ? "rgba(255,255,255,0.4)" : "#fff" }}
				>
					{zone.name}
				</span>
				<button
					type="button"
					className="cc-ztile-btn"
					aria-label={`toggle ${zone.name}`}
					onClick={() => climate.toggleZone(zone)}
					disabled={zone.unavailable}
					style={closed ? undefined : { color: style.accent }}
				>
					<ClimateGlyph icon="power" size={13} />
				</button>
			</div>
		</div>
	);
}

/** Studio variant: a mixer channel strip. */
export function ZoneChannelStrip({
	climate,
	zone,
	style,
}: {
	climate: Climate;
	zone: ZoneView;
	style: ModeStyle;
}) {
	const d = useDragValue(zone.level, (v) => climate.setZoneLevel(zone, v));
	return (
		<ZoneChannel
			zone={{ ...zone, level: d.shown }}
			style={style}
			onInput={d.preview}
			onCommit={d.commit}
			onToggle={() => climate.toggleZone(zone)}
		/>
	);
}
