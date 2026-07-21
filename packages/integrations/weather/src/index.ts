import { defineIntegration } from "@home-dashboard/shared";
import { z } from "zod";

/**
 * Weather integration.
 *
 * Pulls live conditions + a 7-day forecast from Open-Meteo (open-meteo.com) —
 * a free, key-less API. The location is, in order of preference:
 *   1. explicit `latitude` + `longitude` in config,
 *   2. a `location` place name (geocoded via Open-Meteo's geocoding API),
 *   3. auto-detected from the server's public IP (this machine's location).
 *
 * Resilient by design (like the HA integration): a network hiccup or an
 * unreachable API must never block server startup or kill the dashboard — the
 * loops retry and the last good payload stays retained on the topic.
 *
 * Streams:
 *   <id>/status    { ok, location?, latitude?, longitude?, updated?, error? }
 *   <id>/weather   WeatherPayload (current conditions + `daily` 7-day outlook)
 */

const WeatherConfigSchema = z.object({
  /** Latitude (-90..90). Set together with `longitude` to pin the location. */
  latitude: z.number().min(-90).max(90).optional(),
  /** Longitude (-180..180). Set together with `latitude` to pin the location. */
  longitude: z.number().min(-180).max(180).optional(),
  /** Place name to geocode, e.g. "Adelaide" or "Berlin, DE". Used if lat/lon are unset. */
  location: z.string().optional(),
  /** Temperature unit. `tempC`/`highC`/… carry values in this unit. */
  temperatureUnit: z.enum(["celsius", "fahrenheit"]).default("celsius"),
  /** Wind speed unit for `windKmh`. */
  windSpeedUnit: z.enum(["kmh", "mph", "ms", "kn"]).default("kmh"),
  /** How often to refetch the forecast (minutes). */
  refreshMinutes: z.number().int().min(5).default(15),
});

type WeatherConfig = z.infer<typeof WeatherConfigSchema>;

interface ResolvedLocation {
  latitude: number;
  longitude: number;
  name: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
/** Like `num`, but also accepts numeric strings (some IP APIs return strings). */
const numLoose = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const round = (v: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
  return res.json();
}

/**
 * Map a WMO weather code (Open-Meteo's `weather_code`) to our condition
 * vocabulary. `isDay` picks the clear/partly night variants for current
 * conditions; daily forecasts always use the day form.
 */
function wmoToCondition(code: number, isDay: boolean): string {
  if (code <= 1) return isDay ? "clear" : "clear-night"; // clear / mainly clear
  if (code === 2) return isDay ? "partly-cloudy" : "partly-cloudy-night";
  if (code === 3) return "cloudy"; // overcast
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 67) return "rain"; // drizzle + rain (incl. freezing)
  if (code >= 71 && code <= 77) return "snow"; // snowfall + grains
  if (code >= 80 && code <= 82) return "rain"; // rain showers
  if (code === 85 || code === 86) return "snow"; // snow showers
  if (code >= 95) return "storm"; // thunderstorm
  return "cloudy";
}

/** Resolve the location once, per the config precedence described above. */
async function resolveLocation(config: WeatherConfig): Promise<ResolvedLocation> {
  if (config.latitude != null && config.longitude != null) {
    return {
      latitude: config.latitude,
      longitude: config.longitude,
      name: config.location ?? "",
    };
  }

  if (config.location) {
    const url =
      `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json` +
      `&name=${encodeURIComponent(config.location)}`;
    const data = fromRecord(await fetchJson(url));
    const hit = Array.isArray(data.results) ? fromRecord(data.results[0]) : {};
    const lat = num(hit.latitude);
    const lon = num(hit.longitude);
    if (lat == null || lon == null) throw new Error(`could not geocode "${config.location}"`);
    const admin1 = typeof hit.admin1 === "string" ? hit.admin1 : undefined;
    const cityName = typeof hit.name === "string" ? hit.name : config.location;
    return { latitude: lat, longitude: lon, name: admin1 ? `${cityName}, ${admin1}` : cityName };
  }

  // No coordinates and no name — locate this machine by its public IP.
  return geolocateByIp();
}

/** Free, key-less IP-geolocation providers, tried in order. */
const IP_PROVIDERS: {
  url: string;
  parse: (d: Record<string, unknown>) => ResolvedLocation | null;
}[] = [
  {
    url: "https://ipapi.co/json/",
    parse: (d) => makeLocation(num(d.latitude), num(d.longitude), d.city, d.region_code),
  },
  {
    url: "https://ipwho.is/",
    parse: (d) =>
      d.success === false
        ? null
        : makeLocation(num(d.latitude), num(d.longitude), d.city, d.region_code ?? d.region),
  },
  {
    url: "https://get.geojs.io/v1/ip/geo.json",
    parse: (d) => makeLocation(numLoose(d.latitude), numLoose(d.longitude), d.city, d.region),
  },
];

function makeLocation(
  lat: number | undefined,
  lon: number | undefined,
  city: unknown,
  region: unknown,
): ResolvedLocation | null {
  if (lat == null || lon == null) return null;
  const cityStr = str(city);
  const regionStr = str(region);
  const name = regionStr ? (cityStr ? `${cityStr}, ${regionStr}` : regionStr) : cityStr;
  return { latitude: lat, longitude: lon, name };
}

/** Try each IP provider until one yields coordinates; throw if all fail. */
async function geolocateByIp(): Promise<ResolvedLocation> {
  const errors: string[] = [];
  for (const provider of IP_PROVIDERS) {
    try {
      const loc = provider.parse(fromRecord(await fetchJson(provider.url)));
      if (loc) return loc;
      errors.push(`${new URL(provider.url).host}: no coordinates`);
    } catch (err) {
      errors.push(`${new URL(provider.url).host}: ${describeError(err)}`);
    }
  }
  throw new Error(`IP geolocation failed (${errors.join("; ")})`);
}

/** Narrow an unknown JSON value to an indexable record (empty object otherwise). */
function fromRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function numArray(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => (typeof x === "number" ? x : NaN)) : [];
}

export const weatherIntegration = defineIntegration({
  kind: "weather",
  configSchema: WeatherConfigSchema,
  create(ctx, config) {
    let disposed = false;
    let location: ResolvedLocation | null = null;

    const publishStatus = (extra: Record<string, unknown>) =>
      ctx.publish("status", {
        location: location?.name,
        latitude: location?.latitude,
        longitude: location?.longitude,
        ...extra,
      });

    const forecastUrl = (loc: ResolvedLocation): string =>
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&timezone=auto&forecast_days=7` +
      `&temperature_unit=${config.temperatureUnit}&wind_speed_unit=${config.windSpeedUnit}`;

    const tick = async (): Promise<void> => {
      if (!location) return;
      try {
        const data = fromRecord(await fetchJson(forecastUrl(location)));
        const cur = fromRecord(data.current);
        const daily = fromRecord(data.daily);

        const dates = Array.isArray(daily.time) ? daily.time : [];
        const codes = numArray(daily.weather_code);
        const highs = numArray(daily.temperature_2m_max);
        const lows = numArray(daily.temperature_2m_min);
        const days = dates.map((date, i) => ({
          date: typeof date === "string" ? date : "",
          condition: wmoToCondition(codes[i] ?? 0, true),
          highC: round(highs[i] ?? 0),
          lowC: round(lows[i] ?? 0),
        }));

        const today = days[0];
        const temp = num(cur.temperature_2m) ?? 0;
        ctx.publish("weather", {
          tempC: round(temp, 1),
          feelsLikeC: round(num(cur.apparent_temperature) ?? temp, 1),
          condition: wmoToCondition(num(cur.weather_code) ?? 0, cur.is_day !== 0),
          highC: today?.highC ?? round(temp),
          lowC: today?.lowC ?? round(temp),
          humidity: Math.round(num(cur.relative_humidity_2m) ?? 0),
          windKmh: Math.round(num(cur.wind_speed_10m) ?? 0),
          location: location.name,
          tempUnit: config.temperatureUnit === "fahrenheit" ? "F" : "C",
          daily: days,
        });
        publishStatus({ ok: true, updated: new Date().toISOString() });
      } catch (err) {
        ctx.logger.warn(`forecast fetch failed (${describeError(err)}); keeping last value`);
        publishStatus({ ok: false, error: describeError(err) });
      }
    };

    publishStatus({ ok: false }); // topic exists immediately

    // Resolve the location (retrying), then do the first fetch. Kept off the
    // startup path so a slow/absent network never blocks the server.
    void (async () => {
      while (!disposed && !location) {
        try {
          location = await resolveLocation(config);
          ctx.logger.info(
            `weather location: ${location.name || "(unnamed)"} ` +
              `(${location.latitude.toFixed(3)}, ${location.longitude.toFixed(3)})`,
          );
        } catch (err) {
          ctx.logger.warn(`could not resolve location (${describeError(err)}); retrying in 30s`);
          publishStatus({ ok: false, error: describeError(err) });
          await sleep(30_000);
        }
      }
      if (!disposed) await tick();
    })();

    ctx.every(config.refreshMinutes * 60_000, () => void tick());

    return {
      dispose() {
        disposed = true;
      },
    };
  },
});

export default weatherIntegration;
