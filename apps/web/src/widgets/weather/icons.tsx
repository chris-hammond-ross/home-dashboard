import type { ReactElement } from "react";

/**
 * Animated weather glyphs, ported from the three weather prototypes and shared
 * by all variants. Colors come from `--wx-*` CSS custom properties that each
 * variant scope defines (see weather.css), so one icon set reads correctly on
 * every palette. Motion classes (`rays`, `core`, `cloud`, `drop`, …) are driven
 * by keyframes in weather.css and respect prefers-reduced-motion.
 *
 * The six prototype types (sunny/partly/cloudy/rainy/storm/windy) are drawn
 * exactly as designed; night/snow/fog are added in the same style so live data
 * (which the prototypes never exercised) always has a real glyph.
 */

export type IconType =
  | "sunny"
  | "partly"
  | "cloudy"
  | "rainy"
  | "storm"
  | "windy"
  | "snow"
  | "fog"
  | "clear-night"
  | "partly-night";

/** Canonical condition string → glyph. Covers both the demo and Open-Meteo vocabularies. */
export function conditionToIcon(condition: string): IconType {
  switch (condition) {
    case "sunny":
    case "clear":
      return "sunny";
    case "clear-night":
      return "clear-night";
    case "partly-cloudy":
    case "partly":
      return "partly";
    case "partly-cloudy-night":
    case "partly-night":
      return "partly-night";
    case "cloudy":
    case "overcast":
      return "cloudy";
    case "fog":
    case "mist":
    case "haze":
      return "fog";
    case "rain":
    case "rainy":
    case "showers":
    case "drizzle":
      return "rainy";
    case "snow":
    case "sleet":
      return "snow";
    case "storm":
    case "thunderstorm":
      return "storm";
    case "windy":
      return "windy";
    default:
      return "cloudy";
  }
}

/** Human-readable label for a condition string. */
export function conditionLabel(condition: string): string {
  switch (condition) {
    case "sunny":
    case "clear":
      return "Sunny";
    case "clear-night":
      return "Clear";
    case "partly-cloudy":
    case "partly":
    case "partly-cloudy-night":
    case "partly-night":
      return "Partly Cloudy";
    case "cloudy":
    case "overcast":
      return "Cloudy";
    case "fog":
      return "Fog";
    case "rain":
    case "rainy":
      return "Rain";
    case "showers":
      return "Showers";
    case "drizzle":
      return "Drizzle";
    case "snow":
      return "Snow";
    case "storm":
    case "thunderstorm":
      return "Storms";
    case "windy":
      return "Windy";
    default:
      return condition.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

const Cloud = ({ opacity = 1 }: { opacity?: number }) => (
  <g className="cloud" fill="var(--wx-cloud)" opacity={opacity}>
    <ellipse cx="32" cy="42" rx="19" ry="9" />
    <circle cx="24" cy="39" r="9" />
    <circle cx="34" cy="34" r="12" />
    <circle cx="44" cy="40" r="8" />
  </g>
);

const Bodies: Record<IconType, () => ReactElement> = {
  sunny: () => (
    <>
      <g className="rays" stroke="var(--wx-sun)" strokeWidth={3.2} strokeLinecap="round">
        <line x1="32" y1="3" x2="32" y2="11" />
        <line x1="32" y1="53" x2="32" y2="61" />
        <line x1="3" y1="32" x2="11" y2="32" />
        <line x1="53" y1="32" x2="61" y2="32" />
        <line x1="12" y1="12" x2="17.7" y2="17.7" />
        <line x1="46.3" y1="46.3" x2="52" y2="52" />
        <line x1="12" y1="52" x2="17.7" y2="46.3" />
        <line x1="46.3" y1="17.7" x2="52" y2="12" />
      </g>
      <circle className="core" cx="32" cy="32" r="11" fill="var(--wx-sun)" />
    </>
  ),
  partly: () => (
    <>
      <g className="rays wx-sun-hi" stroke="var(--wx-sun)" strokeWidth={2.6} strokeLinecap="round">
        <line x1="43" y1="10" x2="43" y2="5" />
        <line x1="52.5" y1="15.5" x2="56.9" y2="13" />
        <line x1="52.5" y1="26.5" x2="56.9" y2="29" />
        <line x1="43" y1="32" x2="43" y2="37" />
        <line x1="33.5" y1="26.5" x2="29.1" y2="29" />
        <line x1="33.5" y1="15.5" x2="29.1" y2="13" />
      </g>
      <circle className="core wx-sun-hi" cx="43" cy="21" r="8" fill="var(--wx-sun)" />
      <Cloud />
    </>
  ),
  cloudy: () => (
    <>
      <g className="cloud" fill="var(--wx-cloud)" opacity={0.5}>
        <ellipse cx="26" cy="28" rx="15" ry="8" />
        <circle cx="20" cy="26" r="8" />
        <circle cx="30" cy="22" r="10" />
      </g>
      <Cloud />
    </>
  ),
  rainy: () => (
    <>
      <Cloud />
      <g className="rain" stroke="var(--wx-rain)" strokeWidth={3} strokeLinecap="round">
        <line className="drop d1" x1="25" y1="50" x2="23" y2="57" />
        <line className="drop d2" x1="33" y1="50" x2="31" y2="57" />
        <line className="drop d3" x1="41" y1="50" x2="39" y2="57" />
      </g>
    </>
  ),
  storm: () => (
    <>
      <Cloud />
      <polygon
        className="bolt"
        points="35,47 27,58 33,58 30,64 41,52 34,52 38,47"
        fill="var(--wx-bolt)"
      />
    </>
  ),
  windy: () => (
    <g className="wind" stroke="var(--wx-wind)" strokeWidth={3.4} strokeLinecap="round" fill="none">
      <path className="gust g1" d="M8 22 H38 a6 6 0 1 0 -6 -6" />
      <path className="gust g2" d="M8 33 H47 a6 6 0 1 1 -6 6" />
      <path className="gust g3" d="M8 44 H34 a5 5 0 1 0 -5 5" />
    </g>
  ),
  snow: () => (
    <>
      <Cloud />
      <g className="snow" fill="var(--wx-snow)">
        <circle className="flake d1" cx="24" cy="53" r="2.4" />
        <circle className="flake d2" cx="33" cy="53" r="2.4" />
        <circle className="flake d3" cx="42" cy="53" r="2.4" />
      </g>
    </>
  ),
  fog: () => (
    <>
      <Cloud opacity={0.85} />
      <g className="fog" stroke="var(--wx-fog)" strokeWidth={3.2} strokeLinecap="round">
        <line className="fogline f1" x1="18" y1="52" x2="46" y2="52" />
        <line className="fogline f2" x1="14" y1="58" x2="42" y2="58" />
      </g>
    </>
  ),
  "clear-night": () => (
    <path
      className="core"
      d="M46 40 A18 18 0 1 1 30 14 A14 14 0 1 0 46 40 Z"
      fill="var(--wx-moon)"
    />
  ),
  "partly-night": () => (
    <>
      <path
        className="core wx-moon-hi"
        d="M51 25 A10 10 0 1 1 42 12 A8 8 0 1 0 51 25 Z"
        fill="var(--wx-moon)"
      />
      <Cloud />
    </>
  ),
};

export function WeatherIcon({ type, className }: { type: IconType; className?: string }) {
  const Body = Bodies[type];
  return (
    <svg
      className={`wx-ic${className ? ` ${className}` : ""}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <Body />
    </svg>
  );
}
