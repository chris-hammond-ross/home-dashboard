import type { ReactNode } from "react";

/**
 * Inline SVG icons for the climate widget (the kiosk is offline, so we ship no
 * icon font — same convention as lights/shared.tsx and power-flow). Each glyph
 * inherits `currentColor`; `Fan` additionally spins via the `.cc-spin` class.
 */

export type ClimateIcon =
	| "flame"
	| "snow"
	| "fan"
	| "thermometer"
	| "minus"
	| "plus"
	| "power"
	| "droplet"
	| "auto"
	| "damper";

function Svg({ size = 20, children }: { size?: number; children: ReactNode }) {
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
			style={{ display: "block" }}
		>
			{children}
		</svg>
	);
}

const GLYPHS: Record<ClimateIcon, ReactNode> = {
	flame: (
		<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
	),
	snow: (
		<>
			<path d="M12 2v20M4.93 5.93l14.14 14.14M19.07 5.93 4.93 20.07M2 12h20" />
			<path d="M12 2l2.5 2.5M12 2 9.5 4.5M12 22l2.5-2.5M12 22l-2.5-2.5M2 12l2.5 2.5M2 12l2.5-2.5M22 12l-2.5 2.5M22 12l-2.5-2.5" />
		</>
	),
	fan: (
		<>
			<path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618z" />
			<path d="M12 12v.01" />
		</>
	),
	thermometer: <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />,
	minus: <path d="M5 12h14" />,
	plus: <path d="M12 5v14M5 12h14" />,
	power: (
		<>
			<path d="M12 2v10" />
			<path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
		</>
	),
	droplet: <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />,
	// Robot head — stands in for HVAC "auto" / "heat_cool" (the unit decides).
	auto: (
		<>
			<path d="M12 3.6V6" />
			<circle cx="12" cy="2.6" r="1" />
			<rect x="4.5" y="6" width="15" height="12" rx="3.5" />
			<path d="M2.5 11v3M21.5 11v3" />
			<circle cx="9.3" cy="12" r="1.15" fill="currentColor" stroke="none" />
			<circle cx="14.7" cy="12" r="1.15" fill="currentColor" stroke="none" />
			<path d="M9.5 15.2h5" />
		</>
	),
	damper: (
		<>
			<rect x="3" y="4" width="18" height="16" rx="2" />
			<path d="M3 9h18M3 14.5h18" />
		</>
	),
};

export function ClimateGlyph({ icon, size = 20 }: { icon: ClimateIcon; size?: number }) {
	return <Svg size={size}>{GLYPHS[icon]}</Svg>;
}

/**
 * Fan glyph that spins. One fixed, slow speed (not tied to the fan setting) —
 * it signals "the fan is running", nothing more.
 */
export function SpinningFan({ size = 20, speed = "2.4s" }: { size?: number; speed?: string }) {
	return (
		<span className="cc-spin" style={{ animationDuration: speed, display: "inline-flex" }}>
			<ClimateGlyph icon="fan" size={size} />
		</span>
	);
}
