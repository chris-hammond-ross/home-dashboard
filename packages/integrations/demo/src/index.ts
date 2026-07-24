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

    // --- energy history (long-term statistics) --------------------------------
    // Answers the SAME `statistics` / `list-statistic-ids` actions as the Home
    // Assistant integration, so the power-flow drill-down and its cost figures
    // can be developed and probed against `integration: demo` with no HA and no
    // recorder. Deterministic: the value for a given hour never changes, so a
    // probe can assert exact totals.
    const DEMO_STATS: Record<string, { name: string; unit: string; unitClass: string }> = {
      "sensor.demo_solar_energy": { name: "Demo solar energy", unit: "kWh", unitClass: "energy" },
      "sensor.demo_grid_import": { name: "Demo grid import", unit: "kWh", unitClass: "energy" },
      "sensor.demo_grid_export": { name: "Demo grid export", unit: "kWh", unitClass: "energy" },
      "sensor.demo_battery_charge": {
        name: "Demo battery charge",
        unit: "kWh",
        unitClass: "energy",
      },
      "sensor.demo_battery_discharge": {
        name: "Demo battery discharge",
        unit: "kWh",
        unitClass: "energy",
      },
      "sensor.demo_home_energy": {
        name: "Demo home consumption",
        unit: "kWh",
        unitClass: "energy",
      },
    };

    /** Stable 0..1 hash of an hour — same input, same output, forever. */
    const hourNoise = (hourMs: number, salt: number): number => {
      const x = Math.sin(hourMs / 3_600_000 + salt * 97.13) * 43758.5453;
      return x - Math.floor(x);
    };

    /** One hour of a plausible solar household, in kWh. */
    const demoHour = (hourMs: number) => {
      const date = new Date(hourMs);
      const hour = date.getUTCHours();
      const seasonal = 0.75 + 0.25 * Math.cos(((date.getUTCMonth() - 6) / 12) * 2 * Math.PI);
      const x = (hour + 0.5 - 12.5) / 5.5;
      const solar = Math.max(
        0,
        6.2 * Math.exp(-x * x * 3) * seasonal * (0.85 + 0.3 * hourNoise(hourMs, 1)),
      );
      // Morning and evening peaks over a ~0.35 kWh baseline.
      const shape =
        0.35 +
        0.9 * Math.exp(-(((hour - 7.5) / 1.8) ** 2)) +
        1.3 * Math.exp(-(((hour - 19) / 2.2) ** 2));
      const home = shape * (0.85 + 0.3 * hourNoise(hourMs, 2));

      const surplus = solar - home;
      // Charge from surplus, discharge to cover the evening — capped like a
      // real 5 kW inverter so the numbers stay believable.
      const batteryCharge = surplus > 0 ? Math.min(surplus * 0.8, 2.5) : 0;
      const batteryDischarge =
        surplus < 0 && (hour >= 17 || hour < 1) ? Math.min(-surplus, 2.0) : 0;
      const net = home + batteryCharge - solar - batteryDischarge;
      return {
        "sensor.demo_solar_energy": solar,
        "sensor.demo_home_energy": home,
        "sensor.demo_battery_charge": batteryCharge,
        "sensor.demo_battery_discharge": batteryDischarge,
        "sensor.demo_grid_import": Math.max(0, net),
        "sensor.demo_grid_export": Math.max(0, -net),
      } as Record<string, number>;
    };

    const HOUR_MS = 3_600_000;

    ctx.registerAction("statistics", (params) => {
      const statisticIds = Array.isArray(params.statisticIds)
        ? params.statisticIds.filter((id): id is string => typeof id === "string")
        : [];
      const start = Date.parse(String(params.startTime ?? ""));
      const end = params.endTime ? Date.parse(String(params.endTime)) : Date.now();
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        throw new Error("startTime and endTime must be ISO timestamps");
      }
      const wantsMean = Array.isArray(params.types) && params.types.includes("mean");

      const out: Record<string, { start: number; change?: number; mean?: number }[]> = {};
      for (const id of statisticIds) {
        if (!(id in DEMO_STATS)) continue;
        const points: { start: number; change?: number; mean?: number }[] = [];
        for (let ms = Math.floor(start / HOUR_MS) * HOUR_MS; ms < end; ms += HOUR_MS) {
          const kwh = demoHour(ms)[id] ?? 0;
          // A kWh-per-hour figure is numerically watts/1000, so `mean` in W is
          // just the same number scaled — exactly the relationship the server
          // relies on when integrating a power sensor.
          points.push(wantsMean ? { start: ms, mean: kwh * 1000 } : { start: ms, change: kwh });
        }
        out[id] = points;
      }
      return out;
    });

    ctx.registerAction("list-statistic-ids", () =>
      Object.entries(DEMO_STATS).map(([id, meta]) => ({
        id,
        name: meta.name,
        unit: meta.unit,
        unitClass: meta.unitClass,
        hasSum: true,
        hasMean: false,
      })),
    );

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

    // --- climate (thermostat + ducted zone dampers) ------------------------
    // Published in the SAME shape as the Home Assistant integration
    // (entity/<id> → { entityId, state, attributes, … }) so the climate-control
    // widget works against `integration: demo` with zero HA. `call-service` /
    // `toggle` mutate this in-memory state and re-publish, exercising the full
    // control round-trip.
    const climate = { mode: "cool", target: 23, fan: "auto" };
    const zones = [
      { id: "cover.living_zone", name: "Living Zone", position: 85 },
      { id: "cover.bedroom_zone", name: "Bedroom Zone", position: 45 },
    ];
    let indoor = 22.4;

    const publishEntity = (id: string, state: string, attributes: Record<string, unknown>) => {
      const now = new Date().toISOString();
      ctx.publish(`entity/${id}`, {
        entityId: id,
        state,
        attributes,
        lastChanged: now,
        lastUpdated: now,
      });
    };
    const hvacAction = (): string => {
      if (climate.mode === "off") return "off";
      if (climate.mode === "fan_only") return "fan";
      if (climate.mode === "dry") return "drying";
      const heating = climate.mode === "heat" || climate.mode === "heat_cool";
      const cooling = climate.mode === "cool" || climate.mode === "heat_cool";
      if (cooling && indoor > climate.target + 0.3) return "cooling";
      if (heating && indoor < climate.target - 0.3) return "heating";
      return "idle";
    };
    const publishClimate = () =>
      publishEntity("climate.living_room", climate.mode, {
        friendly_name: "Living Room AC",
        hvac_modes: ["off", "cool", "heat", "heat_cool", "dry", "fan_only"],
        hvac_action: hvacAction(),
        current_temperature: Math.round(indoor * 10) / 10,
        temperature: climate.target,
        min_temp: 16,
        max_temp: 30,
        target_temp_step: 0.5,
        fan_mode: climate.fan,
        fan_modes: ["auto", "low", "medium", "high"],
        temperature_unit: "°C",
      });
    const publishZone = (z: { id: string; name: string; position: number }) =>
      publishEntity(z.id, z.position > 0 ? "open" : "closed", {
        friendly_name: z.name,
        current_position: z.position,
        device_class: "damper",
      });
    publishClimate();
    zones.forEach(publishZone);

    // Nudge the room temperature toward the setpoint while conditioning.
    ctx.every(config.tickMs, () => {
      const action = hvacAction();
      if (action === "cooling") indoor = clamp(indoor - 0.05, 16, 32);
      else if (action === "heating") indoor = clamp(indoor + 0.05, 10, 30);
      else indoor = clamp(jitter(indoor, 0.04), 10, 32);
      publishClimate();
    });

    ctx.registerAction("call-service", (params) => {
      const domain = String(params.domain ?? "");
      const service = String(params.service ?? "");
      const data = (params.data ?? {}) as Record<string, unknown>;
      const target = (params.target ?? {}) as { entity_id?: string | string[] };
      const targetId = Array.isArray(target.entity_id) ? target.entity_id[0] : target.entity_id;

      if (domain === "climate") {
        if (service === "set_temperature" && typeof data.temperature === "number")
          climate.target = clamp(data.temperature, 16, 30);
        else if (service === "set_hvac_mode" && typeof data.hvac_mode === "string")
          climate.mode = data.hvac_mode;
        else if (service === "set_fan_mode" && typeof data.fan_mode === "string")
          climate.fan = data.fan_mode;
        publishClimate();
      } else if (domain === "cover") {
        const z = zones.find((x) => x.id === targetId);
        if (z) {
          if (service === "set_cover_position" && typeof data.position === "number")
            z.position = clamp(Math.round(data.position), 0, 100);
          else if (service === "open_cover") z.position = 100;
          else if (service === "close_cover") z.position = 0;
          publishZone(z);
        }
      }
      return { called: `${domain}.${service}` };
    });

    ctx.registerAction("toggle", (params) => {
      const id = String(params.entity_id ?? "");
      if (id === "climate.living_room") {
        climate.mode = climate.mode === "off" ? "cool" : "off";
        publishClimate();
      }
      const z = zones.find((x) => x.id === id);
      if (z) {
        z.position = z.position > 0 ? 0 : 100;
        publishZone(z);
      }
      return { toggled: id };
    });

    ctx.logger.info(
      "demo integration ready (streams: weather, energy, lights, calendar, now-playing, climate)",
    );
    return {};
  },
});

export default demoIntegration;
