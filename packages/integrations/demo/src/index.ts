import { defineIntegration } from "@home-dashboard/shared";
import { z } from "zod";

/**
 * Demo integration — publishes plausible fake data for every core widget so
 * the dashboard can be developed, screenshotted, and demoed with zero setup.
 *
 * Streams: weather, energy, lights, calendar, now-playing
 * Actions:  light.toggle { id }, light.all-off
 */

const DemoConfigSchema = z.object({
  /** Base update interval for fast-moving streams (ms). */
  tickMs: z.number().int().min(250).default(2000),
});

interface DemoLight {
  id: string;
  name: string;
  room: string;
  on: boolean;
}

const CONDITIONS = ["sunny", "partly-cloudy", "cloudy", "showers", "storm", "clear-night"] as const;

function jitter(value: number, amount: number): number {
  return value + (Math.random() * 2 - 1) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rough bell curve of solar output across the day, peaking ~12:30. */
function solarCurve(date: Date, peakWatts: number): number {
  const hour = date.getHours() + date.getMinutes() / 60;
  const x = (hour - 12.5) / 5.5; // non-zero between ~7:00 and ~18:00
  const output = peakWatts * Math.exp(-x * x * 3);
  return output < 25 ? 0 : output;
}

export const demoIntegration = defineIntegration({
  kind: "demo",
  configSchema: DemoConfigSchema,
  create(ctx, config) {
    // --- lights -------------------------------------------------------------
    const lights: DemoLight[] = [
      { id: "living", name: "Living Room", room: "Living", on: true },
      { id: "kitchen", name: "Kitchen Bench", room: "Kitchen", on: true },
      { id: "dining", name: "Dining", room: "Kitchen", on: false },
      { id: "bed-main", name: "Bedroom", room: "Bedroom", on: false },
      { id: "bed-kids", name: "Kids Room", room: "Bedroom", on: false },
      { id: "outdoor", name: "Patio", room: "Outdoor", on: false },
    ];
    const publishLights = () => ctx.publish("lights", { lights });
    publishLights();

    ctx.registerAction("light.toggle", (params) => {
      const light = lights.find((l) => l.id === params.id);
      if (!light) throw new Error(`unknown light: ${String(params.id)}`);
      light.on = !light.on;
      publishLights();
      return { id: light.id, on: light.on };
    });
    ctx.registerAction("light.all-off", () => {
      for (const light of lights) light.on = false;
      publishLights();
      return { off: lights.length };
    });

    // --- weather ------------------------------------------------------------
    // A believable, stable 7-day outlook (first entry = today) so the weather
    // widget variants render fully without a real weather integration.
    const forecast: { condition: string; highC: number; lowC: number }[] = [
      { condition: "partly-cloudy", highC: 17, lowC: 6 },
      { condition: "cloudy", highC: 16, lowC: 7 },
      { condition: "showers", highC: 14, lowC: 5 },
      { condition: "showers", highC: 13, lowC: 4 },
      { condition: "storm", highC: 15, lowC: 5 },
      { condition: "partly-cloudy", highC: 16, lowC: 7 },
      { condition: "sunny", highC: 18, lowC: 8 },
    ];
    const dailyForecast = () =>
      forecast.map((day, i) => {
        const date = new Date();
        date.setDate(date.getDate() + i);
        return { date: date.toISOString().slice(0, 10), ...day };
      });

    let temp = 14; // wintry Australian morning
    let conditionIdx = 1;
    const publishWeather = () => {
      temp = clamp(jitter(temp, 0.3), 4, 24);
      if (Math.random() < 0.1) conditionIdx = (conditionIdx + 1) % (CONDITIONS.length - 1);
      const hour = new Date().getHours();
      const condition = hour >= 18 || hour < 6 ? "clear-night" : CONDITIONS[conditionIdx];
      ctx.publish("weather", {
        tempC: Math.round(temp * 10) / 10,
        feelsLikeC: Math.round((temp - 1.5) * 10) / 10,
        condition,
        highC: forecast[0]!.highC,
        lowC: forecast[0]!.lowC,
        humidity: Math.round(clamp(jitter(65, 5), 30, 95)),
        windKmh: Math.round(clamp(jitter(12, 4), 0, 60)),
        location: "Adelaide",
        tempUnit: "C",
        daily: dailyForecast(),
      });
    };
    publishWeather();
    ctx.every(15_000, publishWeather);

    // --- energy (solar / battery / grid) -------------------------------------
    let batteryPct = 62;
    let load = 800;
    const publishEnergy = () => {
      const now = new Date();
      const solar = Math.round(jitter(solarCurve(now, 6200), 150));
      load = clamp(jitter(load, 120), 250, 4200);
      const surplus = solar - load;
      // battery absorbs surplus / covers deficit within its power limits
      const batteryW = clamp(surplus, -5000, 5000) * (batteryPct > 5 && batteryPct < 98 ? 0.9 : 0);
      const gridW = Math.round(load + batteryW - solar); // + import, - export
      batteryPct = clamp(batteryPct + batteryW / 10_000 / 36, 0, 100); // drift slowly
      ctx.publish("energy", {
        solarW: Math.max(0, solar),
        loadW: Math.round(load),
        batteryW: Math.round(batteryW),
        batteryPct: Math.round(batteryPct * 10) / 10,
        gridW,
        ts: now.toISOString(),
      });
    };
    publishEnergy();
    ctx.every(config.tickMs, publishEnergy);

    // --- calendar -----------------------------------------------------------
    const publishCalendar = () => {
      const now = Date.now();
      const hours = 3_600_000;
      ctx.publish("calendar", {
        events: [
          { title: "School pickup", start: now + 2 * hours, calendar: "family", allDay: false },
          { title: "Sprint review", start: now + 4.5 * hours, calendar: "work", allDay: false },
          {
            title: "Bin night (recycling)",
            start: now + 26 * hours,
            calendar: "family",
            allDay: true,
          },
          { title: "Soccer practice", start: now + 30 * hours, calendar: "family", allDay: false },
        ],
      });
    };
    publishCalendar();
    ctx.every(60_000, publishCalendar);

    // --- now playing ----------------------------------------------------------
    let positionSec = 754;
    const publishNowPlaying = () => {
      positionSec = (positionSec + 5) % 3120;
      ctx.publish("now-playing", {
        source: "Bedroom Podcast Pi",
        title: "The Signal and the Noise — Ep. 142",
        show: "Weekly Tech Roundup",
        state: "playing",
        positionSec,
        durationSec: 3120,
      });
    };
    publishNowPlaying();
    ctx.every(5_000, publishNowPlaying);

    ctx.logger.info(
      "demo integration ready (streams: weather, energy, lights, calendar, now-playing)",
    );
    return {};
  },
});

export default demoIntegration;
