/**
 * Payload shapes for the streams the core widgets consume. For now these match
 * the demo integration; Phase 1 formalizes them in @home-dashboard/shared as
 * the contract every integration publishes against.
 */

/** One day of the forecast. `highC`/`lowC` are in the payload's configured unit. */
export interface WeatherDay {
	/** ISO date (yyyy-mm-dd) — the widget derives the weekday label from this. */
	date: string;
	condition: string;
	highC: number;
	lowC: number;
}

export interface WeatherPayload {
	tempC: number;
	feelsLikeC: number;
	condition: string;
	highC: number;
	lowC: number;
	humidity: number;
	windKmh: number;
	/** Place name for the widget header, e.g. "Adelaide". Omit to hide. */
	location?: string;
	/** Degree unit the temperatures are expressed in. Defaults to Celsius. */
	tempUnit?: "C" | "F";
	/** Multi-day outlook (first entry = today). Omit if the source has none. */
	daily?: WeatherDay[];
}

export interface EnergyPayload {
	solarW: number;
	loadW: number;
	batteryW: number;
	batteryPct: number;
	gridW: number;
	ts: string;
}

export interface CalendarEvent {
	title: string;
	start: number;
	calendar: string;
	allDay: boolean;
}

export interface CalendarPayload {
	events: CalendarEvent[];
}

export interface NowPlayingPayload {
	source: string;
	title: string;
	show: string;
	state: "playing" | "paused";
	positionSec: number;
	durationSec: number;
}

export const CONDITION_GLYPHS: Record<string, string> = {
	sunny: "☀️",
	clear: "☀️",
	"clear-night": "🌙",
	"partly-cloudy": "⛅",
	"partly-cloudy-night": "☁️",
	cloudy: "☁️",
	fog: "🌫️",
	showers: "🌧️",
	rain: "🌧️",
	snow: "🌨️",
	storm: "⛈️",
	windy: "🌬️",
};
