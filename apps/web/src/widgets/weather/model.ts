import { useEffect, useMemo, useRef, useState } from "react";
import type { WidgetConfig } from "@home-dashboard/shared";
import { useTopic } from "../../lib/socket.js";
import type { WeatherPayload } from "../../lib/payloads.js";
import { conditionLabel, conditionToIcon, type IconType } from "./icons.js";

/**
 * Shared data model for the weather widget. All three visual variants (Ember,
 * Meridian, Nocturne) render the SAME derived `WeatherView`, so the topic
 * subscription, unit handling and day-label logic live here once. The variants
 * differ only in markup and CSS.
 */

export interface WeatherDayView {
	/** "Today", or a short weekday like "Wed". */
	label: string;
	condition: string;
	/** Human-readable condition, e.g. "Partly Cloudy". */
	condLabel: string;
	icon: IconType;
	hi: number;
	lo: number;
}

export interface WeatherView {
	/** False until the first payload arrives — variants show a waiting state. */
	ready: boolean;
	location: string;
	/** Unit suffix for a labelled readout, e.g. "°C". */
	unit: string;
	current: {
		condition: string;
		label: string;
		icon: IconType;
		tempC: number;
		feelsLikeC: number;
		humidity: number;
		windKmh: number;
	};
	/** First entry is today; up to 7 days. */
	days: WeatherDayView[];
}

/** Parse a "yyyy-mm-dd" string as a LOCAL date (avoids UTC off-by-one). */
function parseLocalDate(value: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
	if (!m) return null;
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function dayLabel(dateStr: string, index: number): string {
	if (index === 0) return "Today";
	const date = parseLocalDate(dateStr);
	return date ? date.toLocaleDateString(undefined, { weekday: "short" }) : `+${index}`;
}

function buildView(payload: WeatherPayload | undefined): WeatherView {
	const empty: WeatherView = {
		ready: false,
		location: "",
		unit: "°C",
		current: {
			condition: "cloudy",
			label: "",
			icon: "cloudy",
			tempC: 0,
			feelsLikeC: 0,
			humidity: 0,
			windKmh: 0,
		},
		days: [],
	};
	if (!payload) return empty;

	const source =
		payload.daily && payload.daily.length > 0
			? payload.daily
			: [
					{
						date: "",
						condition: payload.condition,
						highC: payload.highC,
						lowC: payload.lowC,
					},
				];

	const days: WeatherDayView[] = source.slice(0, 7).map((day, i) => ({
		label: dayLabel(day.date, i),
		condition: day.condition,
		condLabel: conditionLabel(day.condition),
		icon: conditionToIcon(day.condition),
		hi: Math.round(day.highC),
		lo: Math.round(day.lowC),
	}));

	return {
		ready: true,
		location: payload.location ?? "",
		unit: payload.tempUnit === "F" ? "°F" : "°C",
		current: {
			condition: payload.condition,
			label: conditionLabel(payload.condition),
			icon: conditionToIcon(payload.condition),
			tempC: Math.round(payload.tempC),
			feelsLikeC: Math.round(payload.feelsLikeC),
			humidity: payload.humidity,
			windKmh: payload.windKmh,
		},
		days,
	};
}

/** Read the widget's `topic` prop, subscribe, and derive the normalized view. */
export function useWeather(config: WidgetConfig): WeatherView {
	const topic =
		typeof config.props.topic === "string" && config.props.topic
			? config.props.topic
			: "demo/weather";
	const payload = useTopic<WeatherPayload>(topic);
	return useMemo(() => buildView(payload), [payload]);
}

export function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(
		() =>
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);
	useEffect(() => {
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		const onChange = () => setReduced(mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);
	return reduced;
}

/**
 * Animate a number toward `target`: counts up from 0 on first mount and eases
 * between values on later updates. Honors reduced-motion by snapping.
 */
export function useCountUp(target: number, reduced: boolean): number {
	const [value, setValue] = useState(() => (reduced ? target : 0));
	const displayRef = useRef(reduced ? target : 0);

	useEffect(() => {
		if (reduced) {
			displayRef.current = target;
			setValue(target);
			return;
		}
		const from = displayRef.current;
		if (from === target) return;
		const start = performance.now();
		const duration = 520;
		let raf = 0;
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / duration);
			const eased = 1 - Math.pow(1 - t, 3);
			const next = Math.round(from + (target - from) * eased);
			displayRef.current = next;
			setValue(next);
			if (t < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [target, reduced]);

	return value;
}
