import { useMemo, useState } from "react";
import { Group, Text } from "@mantine/core";
import "./usage-chart.css";

/**
 * Stacked column chart for energy over time — hand-rolled SVG, matching the
 * rest of the widget (and avoiding a charting dependency on a kiosk bundle).
 *
 * Mark specs follow the house dataviz rules: columns capped at 24 units thick
 * with a 4px rounded cap and a square baseline, a 2px surface gap between
 * stacked segments so neighbours separate without a stroke, hairline recessive
 * gridlines, ink-token text (never the series colour), a legend whenever there
 * is more than one series, and a tooltip on tap/hover rather than a number on
 * every bar.
 */

export interface ChartSeries {
	key: string;
	label: string;
	/** A --chart-* token. Pairs used together are CVD-validated; see tokens.css. */
	color: string;
}

export interface ChartBucket {
	/** Axis label, e.g. "6am" or "Tue 14". */
	label: string;
	/** Longer form for the tooltip, e.g. "Tuesday 14 July, 6:00 pm". */
	fullLabel: string;
	values: Record<string, number>;
}

interface UsageChartProps {
	buckets: ChartBucket[];
	series: ChartSeries[];
	unit: string;
	/** Values below this read as zero — keeps sensor noise out of the stack. */
	epsilon?: number;
	height?: number;
}

const VIEW_W = 900;
const PAD = { top: 16, right: 12, bottom: 30, left: 52 };
const MAX_BAR = 24;
const SEG_GAP = 2;
const CAP_RADIUS = 4;

/** Clean axis maximum: 1/2/5 × a power of ten, at or above the tallest stack. */
function niceMax(value: number): number {
	if (value <= 0) return 1;
	const magnitude = 10 ** Math.floor(Math.log10(value));
	for (const step of [1, 2, 2.5, 5, 10]) {
		if (value <= magnitude * step) return magnitude * step;
	}
	return magnitude * 10;
}

const formatTick = (value: number): string =>
	value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(0) : value.toFixed(1);

/**
 * A column with rounded top corners and a square baseline. Used for the
 * topmost segment of each stack; interior segments are plain rects.
 */
function cappedColumn(x: number, y: number, w: number, h: number): string {
	const r = Math.min(CAP_RADIUS, w / 2, h);
	return (
		`M${x} ${y + h} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} ` +
		`L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h} Z`
	);
}

export function UsageChart({
	buckets,
	series,
	unit,
	epsilon = 0.001,
	height = 300,
}: UsageChartProps) {
	const [hover, setHover] = useState<number | null>(null);

	const { max, plotH, plotW, bandW, barW } = useMemo(() => {
		const totals = buckets.map((b) =>
			series.reduce((sum, s) => sum + Math.max(0, b.values[s.key] ?? 0), 0),
		);
		const plotW = VIEW_W - PAD.left - PAD.right;
		const plotH = height - PAD.top - PAD.bottom;
		const bandW = buckets.length ? plotW / buckets.length : plotW;
		return {
			max: niceMax(Math.max(...totals, 0)),
			plotH,
			plotW,
			bandW,
			// Leave the band's remainder as air, and keep a 2px gap between neighbours.
			barW: Math.max(2, Math.min(MAX_BAR, bandW - SEG_GAP)),
		};
	}, [buckets, series, height]);

	if (!buckets.length) {
		return (
			<Text c="var(--text-muted)" ta="center" py="xl">
				No data for this period.
			</Text>
		);
	}

	const y = (value: number) => PAD.top + plotH - (value / max) * plotH;
	const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);

	// Thin the axis labels until they stop colliding (~64 view units apart).
	const labelStride = Math.max(1, Math.ceil(64 / bandW));

	const active = hover === null ? null : buckets[hover];
	const activeTotal = active
		? series.reduce((sum, s) => sum + Math.max(0, active.values[s.key] ?? 0), 0)
		: 0;

	return (
		<div className="uc-wrap">
			<svg
				viewBox={`0 0 ${VIEW_W} ${height}`}
				preserveAspectRatio="xMidYMid meet"
				className="uc-svg"
				role="img"
				aria-label={`Usage by period in ${unit}`}
			>
				{ticks.map((tick) => (
					<g key={tick}>
						<line
							x1={PAD.left}
							x2={PAD.left + plotW}
							y1={y(tick)}
							y2={y(tick)}
							stroke="var(--hairline)"
							strokeWidth={1}
						/>
						<text
							x={PAD.left - 8}
							y={y(tick) + 4}
							textAnchor="end"
							fontSize={11}
							className="uc-tick"
							fill="var(--text-muted)"
						>
							{formatTick(tick)}
						</text>
					</g>
				))}

				{buckets.map((bucket, i) => {
					const bandX = PAD.left + i * bandW;
					const x = bandX + (bandW - barW) / 2;
					// Draw from the baseline up so the cap lands on the last segment.
					const stack = series
						.map((s) => ({ s, value: Math.max(0, bucket.values[s.key] ?? 0) }))
						.filter((entry) => entry.value > epsilon);
					let cursor = 0;
					const top = stack.length - 1;

					return (
						<g key={i} opacity={hover === null || hover === i ? 1 : 0.55}>
							{stack.map((entry, index) => {
								const yTop = y(cursor + entry.value);
								const rawH = y(cursor) - yTop;
								cursor += entry.value;
								// The gap is carved out of the segment, so the stack keeps its
								// true total height and segments never overlap.
								const h = Math.max(1, rawH - (index === top ? 0 : SEG_GAP));
								return index === top ? (
									<path
										key={entry.s.key}
										d={cappedColumn(x, yTop, barW, h)}
										fill={entry.s.color}
									/>
								) : (
									<rect
										key={entry.s.key}
										x={x}
										y={yTop}
										width={barW}
										height={h}
										fill={entry.s.color}
									/>
								);
							})}
							{/* Hit target spans the whole band, not just the bar — a 3-unit
                  sliver is impossible to tap on a wall panel. */}
							<rect
								x={bandX}
								y={PAD.top}
								width={bandW}
								height={plotH}
								fill="transparent"
								onPointerEnter={() => setHover(i)}
								onPointerDown={() => setHover(i)}
								onPointerLeave={() => setHover((h) => (h === i ? null : h))}
							/>
						</g>
					);
				})}

				<line
					x1={PAD.left}
					x2={PAD.left + plotW}
					y1={y(0)}
					y2={y(0)}
					stroke="var(--hairline)"
					strokeWidth={1}
				/>

				{buckets.map((bucket, i) =>
					i % labelStride === 0 ? (
						<text
							key={i}
							x={PAD.left + i * bandW + bandW / 2}
							y={height - 10}
							textAnchor="middle"
							fontSize={11}
							className="uc-tick"
							fill="var(--text-muted)"
						>
							{bucket.label}
						</text>
					) : null,
				)}
			</svg>

			{active ? (
				<div
					className="uc-tip"
					style={{
						left: `${((PAD.left + (hover! + 0.5) * bandW) / VIEW_W) * 100}%`,
					}}
				>
					<Text size="xs" c="var(--text-secondary)" mb={4}>
						{active.fullLabel}
					</Text>
					{series.map((s) => {
						const value = Math.max(0, active.values[s.key] ?? 0);
						if (value <= epsilon) return null;
						return (
							<Group key={s.key} gap={6} wrap="nowrap" justify="space-between">
								<Group gap={6} wrap="nowrap">
									<span className="uc-dot" style={{ background: s.color }} />
									<Text size="xs" c="var(--text-secondary)">
										{s.label}
									</Text>
								</Group>
								<Text size="xs" c="var(--text-primary)" className="uc-tick">
									{value.toFixed(2)}
								</Text>
							</Group>
						);
					})}
					{series.length > 1 ? (
						<Group gap={6} justify="space-between" mt={4} className="uc-tiptotal">
							<Text size="xs" c="var(--text-muted)">
								Total
							</Text>
							<Text size="xs" c="var(--text-primary)" className="uc-tick">
								{activeTotal.toFixed(2)} {unit}
							</Text>
						</Group>
					) : null}
				</div>
			) : null}

			{series.length > 1 ? (
				<Group gap="md" justify="center" mt={4}>
					{series.map((s) => (
						<Group key={s.key} gap={6} wrap="nowrap">
							<span className="uc-dot" style={{ background: s.color }} />
							<Text size="xs" c="var(--text-secondary)">
								{s.label}
							</Text>
						</Group>
					))}
				</Group>
			) : null}
		</div>
	);
}
