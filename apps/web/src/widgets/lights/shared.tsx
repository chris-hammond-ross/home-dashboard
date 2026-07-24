import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { socket } from "../../lib/socket.js";
import "./lights.css";

export interface EntityPayload {
	entityId: string;
	state: string;
	attributes: Record<string, unknown>;
	lastChanged: string;
	lastUpdated: string;
}

export interface Hsl {
	h: number;
	s: number;
	l: number;
}

/** Default accent when a light has no (saturated) colour of its own. */
export const WARM: Hsl = { h: 40, s: 95, l: 62 };

export const hsl = (c: Hsl, a?: number) =>
	a == null ? `hsl(${c.h} ${c.s}% ${c.l}%)` : `hsl(${c.h} ${c.s}% ${c.l}% / ${a})`;

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const LIGHT_ICONS = ["bulb", "lamp", "lamp-floor", "bed", "plug"] as const;
export type LightIcon = (typeof LIGHT_ICONS)[number];

export const isLightIcon = (v: unknown): v is LightIcon =>
	typeof v === "string" && (LIGHT_ICONS as readonly string[]).includes(v);

/**
 * Capability model for one entity wearing the light UI. Any toggleable entity
 * qualifies (light.*, switch.* outlets, input_boolean.*, …): capabilities are
 * detected from ATTRIBUTES, not the domain — an outlet has no brightness or
 * colour attributes, so it naturally presents as a plain switch.
 *
 * `dimmable`/`colourable` additionally require the light.* domain because they
 * gate `light.turn_on` service calls, which must never target other domains.
 * Plain on/off always goes through domain-agnostic homeassistant services.
 */
export interface LightView {
	id: string;
	name: string;
	waiting: boolean;
	unavailable: boolean;
	on: boolean;
	briPct: number;
	dimmable: boolean;
	colourable: boolean;
	colour: Hsl;
	icon: LightIcon;
}

const COLOUR_MODES = new Set(["hs", "xy", "rgb", "rgbw", "rgbww"]);

export function toView(id: string, p: EntityPayload | undefined, icon?: unknown): LightView {
	const domain = id.split(".")[0] ?? "";
	const fallbackName = id.split(".")[1]?.replace(/_/g, " ") ?? id;
	const glyph = isLightIcon(icon) ? icon : domain === "switch" ? "plug" : "bulb";
	if (!p) {
		return {
			id,
			name: fallbackName,
			waiting: true,
			unavailable: true,
			on: false,
			briPct: 0,
			dimmable: false,
			colourable: false,
			colour: WARM,
			icon: glyph,
		};
	}
	const attrs = p.attributes;
	const name = typeof attrs.friendly_name === "string" ? attrs.friendly_name : fallbackName;
	const unavailable = p.state === "unavailable" || p.state === "unknown";
	const on = p.state === "on";
	const modes = Array.isArray(attrs.supported_color_modes)
		? attrs.supported_color_modes.filter((m): m is string => typeof m === "string")
		: [];
	const brightness = typeof attrs.brightness === "number" ? attrs.brightness : null;
	const isLight = domain === "light";
	const dimmable = isLight && (modes.some((m) => m !== "onoff") || brightness != null);
	const colourable = isLight && modes.some((m) => COLOUR_MODES.has(m));
	const briPct =
		brightness != null ? clamp(Math.round((brightness / 255) * 100), 1, 100) : on ? 100 : 0;
	const hs = attrs.hs_color;
	const colour =
		Array.isArray(hs) && typeof hs[0] === "number" && typeof hs[1] === "number" && hs[1] > 12
			? { h: Math.round(hs[0]), s: Math.round(clamp(hs[1], 0, 100)), l: 62 }
			: WARM;
	return {
		id,
		name,
		waiting: false,
		unavailable,
		on,
		briPct,
		dimmable,
		colourable,
		colour,
		icon: glyph,
	};
}

/** Subscribe to one entity topic per light; hooks stay out of render loops. */
export function useEntityMap(
	integration: string,
	entityIds: string[],
): Record<string, EntityPayload | undefined> {
	const [map, setMap] = useState<Record<string, EntityPayload>>({});
	const key = entityIds.join("\n");
	useEffect(() => {
		setMap({});
		if (!key) return;
		const unsubs = key.split("\n").map((id) =>
			socket.subscribe(`${integration}/entity/${id}`, (payload) => {
				setMap((m) => ({ ...m, [id]: payload as EntityPayload }));
			}),
		);
		return () => unsubs.forEach((unsub) => unsub());
	}, [integration, key]);
	return map;
}

/* ── service calls ─────────────────────────────────────────────────────────
 * On/off is domain-agnostic (homeassistant.*) so adopted outlets work;
 * brightness/colour use light.turn_on and may only target light.* entities. */

export const toggleEntity = (integration: string, entityId: string) =>
	void socket.action(integration, "toggle", { entity_id: entityId });

export const powerEntities = (integration: string, entityIds: string[], on: boolean) =>
	void socket.action(integration, "call-service", {
		domain: "homeassistant",
		service: on ? "turn_on" : "turn_off",
		target: { entity_id: entityIds },
	});

export const lightTurnOn = (
	integration: string,
	entityIds: string[],
	data: Record<string, unknown>,
) =>
	void socket.action(integration, "call-service", {
		domain: "light",
		service: "turn_on",
		data,
		target: { entity_id: entityIds },
	});

/* ── icons ────────────────────────────────────────────────────────────────── */

export function Ic({ size = 20, children }: { size?: number; children: ReactNode }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

const GLYPH_PATHS: Record<LightIcon, ReactNode> = {
	bulb: (
		<>
			<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
			<path d="M9 18h6" />
			<path d="M10 22h4" />
		</>
	),
	lamp: (
		<>
			<path d="M8 2h8l4 10H4L8 2Z" />
			<path d="M12 12v6" />
			<path d="M8 22v-2c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v2H8Z" />
		</>
	),
	"lamp-floor": (
		<>
			<path d="M9 2h6l3 7H6l3-7Z" />
			<path d="M12 9v13" />
			<path d="M9 22h6" />
		</>
	),
	bed: (
		<>
			<path d="M2 4v16" />
			<path d="M2 8h18a2 2 0 0 1 2 2v10" />
			<path d="M2 17h20" />
			<path d="M6 8v9" />
		</>
	),
	plug: (
		<>
			<path d="M12 22v-5" />
			<path d="M9 8V2" />
			<path d="M15 8V2" />
			<path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
		</>
	),
};

export function LightGlyph({ icon, size = 16 }: { icon: LightIcon; size?: number }) {
	return <Ic size={size}>{GLYPH_PATHS[icon]}</Ic>;
}

export const IconPower = () => (
	<Ic>
		<path d="M12 2v10" />
		<path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
	</Ic>
);
export const IconChevron = () => (
	<Ic>
		<path d="m6 9 6 6 6-6" />
	</Ic>
);
export const IconLock = ({ size = 16 }: { size?: number }) => (
	<Ic size={size}>
		<rect width="18" height="11" x="3" y="11" rx="2" />
		<path d="M7 11V7a5 5 0 0 1 10 0v4" />
	</Ic>
);
export const IconX = () => (
	<Ic size={16}>
		<path d="M18 6 6 18" />
		<path d="m6 6 12 12" />
	</Ic>
);

/**
 * Horizontal brightness bar: tap or drag sets 1–100%. Shows the locally
 * dragged value while the pointer is down (service calls are throttled), then
 * settles back to whatever the entity topic says is true.
 */
export function HBar({
	value,
	colour,
	mini,
	disabled,
	label,
	renderLabel,
	onSet,
}: {
	value: number | null;
	colour: Hsl;
	mini?: boolean;
	disabled?: boolean;
	label: string;
	renderLabel: (pct: number) => string;
	onSet: (pct: number) => void;
}) {
	const [local, setLocal] = useState<number | null>(null);
	const pid = useRef<number | null>(null);
	const lastSentAt = useRef(0);
	const lastSentPct = useRef<number | null>(null);
	const settleTimer = useRef<number | undefined>(undefined);

	useEffect(() => {
		if (pid.current == null) setLocal(null);
	}, [value]);
	useEffect(() => () => window.clearTimeout(settleTimer.current), []);

	const pctFrom = (e: ReactPointerEvent<HTMLDivElement>) => {
		const r = e.currentTarget.getBoundingClientRect();
		return clamp(Math.round(((e.clientX - r.left) / r.width) * 100), 1, 100);
	};
	const send = (pct: number) => {
		lastSentAt.current = Date.now();
		lastSentPct.current = pct;
		onSet(pct);
	};

	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (disabled) return;
		pid.current = e.pointerId;
		e.currentTarget.setPointerCapture(e.pointerId);
		window.clearTimeout(settleTimer.current);
		const pct = pctFrom(e);
		setLocal(pct);
		send(pct);
	};
	const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (pid.current !== e.pointerId) return;
		const pct = pctFrom(e);
		setLocal(pct);
		if (Date.now() - lastSentAt.current > 300) send(pct);
	};
	const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (pid.current !== e.pointerId) return;
		pid.current = null;
		const pct = pctFrom(e);
		setLocal(pct);
		if (pct !== lastSentPct.current) send(pct);
		settleTimer.current = window.setTimeout(() => setLocal(null), 1500);
	};

	const shown = local ?? value;
	return (
		<div
			className={`lw-hbar${mini ? " lw-mini" : ""}${disabled ? " is-disabled" : ""}`}
			role="slider"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={shown ?? 0}
			aria-disabled={disabled || undefined}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerEnd}
			onPointerCancel={onPointerEnd}
		>
			<div
				className="lw-hbar-fill"
				style={{
					width: `${shown ?? 0}%`,
					background: `linear-gradient(90deg, ${hsl({ ...colour, l: Math.max(colour.l - 14, 20) })}, ${hsl(colour)})`,
				}}
			/>
			<span className="lw-hbar-label">
				{shown == null ? renderLabel(0) : renderLabel(shown)}
			</span>
		</div>
	);
}
