/**
 * Payload shapes for the streams the core widgets consume. For now these match
 * the demo integration; Phase 1 formalizes them in @home-dashboard/shared as
 * the contract every integration publishes against.
 */

export interface WeatherPayload {
  tempC: number;
  feelsLikeC: number;
  condition: string;
  highC: number;
  lowC: number;
  humidity: number;
  windKmh: number;
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
  "partly-cloudy": "⛅",
  cloudy: "☁️",
  showers: "🌧️",
  storm: "⛈️",
  "clear-night": "🌙",
};
