import {
	consumptionMix,
	emptyRoleKwh,
	localParts,
	priceHour,
	summarise,
	type EnergyBucketRow,
	type EnergyHistoryRequest,
	type EnergyHistoryResponse,
	type EnergyRole,
	type EnergySource,
	type EnergyTotals,
	type HourEnergy,
	type Tariff,
} from "@home-dashboard/shared";
import type { PluginHost } from "./plugins.js";
import type { TariffService } from "./tariffs.js";

/**
 * Energy history: ask Home Assistant for hourly statistics, allocate each hour
 * across sources with the same greedy rule the live diagram uses, price it
 * against the active tariff, then bucket down for the chart.
 *
 * Always queried at `period: "hour"` regardless of the range the user picked.
 * One code path, and time-of-use costing stays exact — a day bucket cannot
 * tell peak from off-peak, so aggregating before pricing would quietly produce
 * the wrong number. A year is 8760 buckets per statistic, which is a fast local
 * query; the browser only ever receives the downsampled result.
 */

const HOUR_MS = 60 * 60 * 1000;
const CACHE_TTL_MS = 60_000;
const MAX_RANGE_MS = 400 * 24 * HOUR_MS;

export class EnergyRequestError extends Error {}

/** One bucket as HA returns it. */
interface HaPoint {
	start: number | string;
	change?: number | null;
	mean?: number | null;
}

interface HourSample {
	/** Epoch ms at the start of the hour. */
	start: number;
	kwh: Record<EnergyRole, number>;
}

interface CacheEntry {
	at: number;
	value: EnergyHistoryResponse;
}

export class EnergyService {
	private cache = new Map<string, CacheEntry>();

	constructor(
		private plugins: PluginHost,
		private tariffs: TariffService,
	) {}

	async history(request: EnergyHistoryRequest): Promise<EnergyHistoryResponse> {
		const roles = Object.entries(request.roles) as [EnergyRole, EnergySource][];
		if (roles.length === 0) {
			throw new EnergyRequestError("at least one energy source must be configured");
		}

		const start = Date.parse(request.start);
		const end = Date.parse(request.end);
		if (!Number.isFinite(start) || !Number.isFinite(end)) {
			throw new EnergyRequestError("start and end must be ISO timestamps");
		}
		if (end <= start) throw new EnergyRequestError("end must be after start");
		if (end - start > MAX_RANGE_MS) {
			throw new EnergyRequestError("range is too long — request at most about a year");
		}

		const tariff = this.tariffs.active();
		const key = JSON.stringify([
			request.integration,
			request.roles,
			request.start,
			request.end,
			request.bucket,
			request.comparePrevious,
			this.tariffs.revision(),
			tariff?.id ?? null,
		]);
		const cached = this.cache.get(key);
		if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

		const timezone = tariff?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

		const current = await this.sample(request.integration, roles, start, end);
		const previous = request.comparePrevious
			? await this.sample(request.integration, roles, start - (end - start), start)
			: null;

		const buckets = this.bucket(current.hours, request.bucket, timezone, tariff);
		const value: EnergyHistoryResponse = {
			buckets,
			totals: totalsOf(current.hours),
			previous: previous ? totalsOf(previous.hours) : null,
			cost: tariff ? costOf(tariff, current.hours, previous?.hours ?? null, timezone) : null,
			estimated: current.estimated,
			missing: current.missing,
			tariff: tariff ? { id: tariff.id, name: tariff.name, timezone: tariff.timezone } : null,
		};

		this.cache.set(key, { at: Date.now(), value });
		// Bounded: the modal only ever pages through a handful of ranges.
		if (this.cache.size > 64) {
			const oldest = [...this.cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
			if (oldest) this.cache.delete(oldest[0]);
		}
		return value;
	}

	/**
	 * Fetch every role's hourly kWh. Roles are grouped by kind so at most two
	 * statistics calls go out: energy statistics want `change` in kWh, power
	 * sensors want `mean` in W (integrated to kWh below).
	 */
	private async sample(
		integration: string,
		roles: [EnergyRole, EnergySource][],
		start: number,
		end: number,
	): Promise<{ hours: HourSample[]; estimated: boolean; missing: EnergyRole[] }> {
		const energyIds = ids(roles, "energy");
		const powerIds = ids(roles, "power");

		const none: Record<string, HaPoint[]> = {};
		const [energySeries, powerSeries] = await Promise.all([
			energyIds.length
				? this.statistics(integration, energyIds, start, end, ["change"], { energy: "kWh" })
				: Promise.resolve(none),
			powerIds.length
				? this.statistics(integration, powerIds, start, end, ["mean"], { power: "W" })
				: Promise.resolve(none),
		]);

		const byHour = new Map<number, Record<EnergyRole, number>>();
		const seen = new Set<EnergyRole>();

		for (const [role, source] of roles) {
			const series =
				source.kind === "energy"
					? energySeries[source.statisticId]
					: powerSeries[source.statisticId];
			if (!series?.length) continue;
			seen.add(role);

			for (const point of series) {
				const hour = hourStart(point.start);
				if (hour === null || hour < start || hour >= end) continue;
				// A watt sensor's hourly mean IS its kWh for that hour, once scaled.
				const raw =
					source.kind === "energy"
						? (point.change ?? 0)
						: ((point.mean ?? 0) as number) / 1000;
				const kwh = applySign(raw, source);
				if (kwh === 0) continue;
				let row = byHour.get(hour);
				if (!row) {
					row = emptyRoleKwh();
					byHour.set(hour, row);
				}
				row[role] += kwh;
			}
		}

		const hours = [...byHour.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([hour, kwh]) => ({ start: hour, kwh }));

		// Home load is optional: derive it from the balance exactly as the live
		// widget does when no dedicated consumption meter is configured.
		if (!seen.has("home")) {
			for (const sample of hours) {
				const k = sample.kwh;
				k.home = Math.max(
					0,
					k.solar + k.gridImport + k.batteryDischarge - k.gridExport - k.batteryCharge,
				);
			}
		}

		return {
			hours,
			estimated: roles.some(([role, source]) => source.kind === "power" && seen.has(role)),
			missing: roles
				.map(([role]) => role)
				.filter((role) => !seen.has(role) && role !== "home"),
		};
	}

	private async statistics(
		integration: string,
		statisticIds: string[],
		start: number,
		end: number,
		types: string[],
		units: Record<string, string>,
	): Promise<Record<string, HaPoint[]>> {
		const result = await this.plugins.runAction(integration, "statistics", {
			statisticIds,
			startTime: new Date(start).toISOString(),
			endTime: new Date(end).toISOString(),
			period: "hour",
			types,
			units,
		});
		return (result ?? {}) as Record<string, HaPoint[]>;
	}

	/** Collapse hours into the requested bucket, in the tariff's local time. */
	private bucket(
		hours: HourSample[],
		size: EnergyHistoryRequest["bucket"],
		timezone: string,
		tariff: Tariff | null,
	): EnergyBucketRow[] {
		const groups = new Map<string, { start: number; hours: HourSample[] }>();
		for (const hour of hours) {
			const key = bucketKey(hour.start, size, timezone);
			let group = groups.get(key);
			if (!group) {
				group = { start: hour.start, hours: [] };
				groups.set(key, group);
			}
			group.hours.push(hour);
		}

		return [...groups.values()]
			.sort((a, b) => a.start - b.start)
			.map((group) => {
				const kwh = emptyRoleKwh();
				const mix = { solar: 0, battery: 0, grid: 0 };
				const centsByBand: Record<string, number> = {};
				let exportCents = 0;

				for (const hour of group.hours) {
					for (const role of Object.keys(kwh) as EnergyRole[])
						kwh[role] += hour.kwh[role];
					const hourMix = mixOf(hour);
					mix.solar += hourMix.solar;
					mix.battery += hourMix.battery;
					mix.grid += hourMix.grid;

					if (!tariff) continue;
					const cost = priceHour(tariff, hourEnergy(hour));
					if (cost.blockId) {
						centsByBand[cost.blockId] =
							(centsByBand[cost.blockId] ?? 0) + cost.importCents;
					}
					exportCents += cost.exportCents;
				}

				return {
					start: new Date(group.start).toISOString(),
					kwh,
					mix,
					centsByBand,
					exportCents,
				};
			});
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ids = (roles: [EnergyRole, EnergySource][], kind: EnergySource["kind"]): string[] => [
	...new Set(roles.filter(([, s]) => s.kind === kind).map(([, s]) => s.statisticId)),
];

/** HA sends bucket starts as epoch ms or ISO, depending on version. */
function hourStart(value: number | string): number | null {
	const ms = typeof value === "number" ? value : Date.parse(value);
	return Number.isFinite(ms) ? Math.floor(ms / HOUR_MS) * HOUR_MS : null;
}

/**
 * Take this role's share of a possibly-signed reading. `"positive"` /
 * `"negative"` split one signed meter into its import and export halves; note
 * that on an hourly mean this can only see the net direction of the hour, which
 * is why any power-derived answer is reported as estimated.
 *
 * Clamping at zero also swallows the negative `change` a total_increasing meter
 * emits when it resets, which would otherwise land as a huge phantom hour.
 */
function applySign(raw: number, source: EnergySource): number {
	const value = source.invert ? -raw : raw;
	if (source.sign === "negative") return Math.max(0, -value);
	if (source.sign === "magnitude") return Math.abs(value);
	return Math.max(0, value);
}

const hourEnergy = (hour: HourSample): HourEnergy => ({
	start: hour.start,
	importKwh: hour.kwh.gridImport,
	exportKwh: hour.kwh.gridExport,
});

const mixOf = (hour: HourSample) =>
	consumptionMix({
		solar: hour.kwh.solar,
		gridImport: hour.kwh.gridImport,
		gridExport: hour.kwh.gridExport,
		batteryCharge: hour.kwh.batteryCharge,
		batteryDischarge: hour.kwh.batteryDischarge,
		load: hour.kwh.home,
	});

function bucketKey(ms: number, size: EnergyHistoryRequest["bucket"], timezone: string): string {
	if (size === "hour") return String(ms);
	const { dateKey } = localParts(timezone, ms);
	return size === "day" ? dateKey : dateKey.slice(0, 7);
}

function totalsOf(hours: HourSample[]): EnergyTotals {
	const kwh = emptyRoleKwh();
	const mix = { solar: 0, battery: 0, grid: 0 };
	for (const hour of hours) {
		for (const role of Object.keys(kwh) as EnergyRole[]) kwh[role] += hour.kwh[role];
		const hourMix = mixOf(hour);
		mix.solar += hourMix.solar;
		mix.battery += hourMix.battery;
		mix.grid += hourMix.grid;
	}
	return { kwh, mix };
}

/** Distinct local days touched — a part-day still incurs a full supply charge. */
function supplyDays(hours: HourSample[], timezone: string): number {
	const days = new Set<string>();
	for (const hour of hours) days.add(localParts(timezone, hour.start).dateKey);
	return days.size;
}

function costOf(
	tariff: Tariff,
	hours: HourSample[],
	previous: HourSample[] | null,
	timezone: string,
): EnergyHistoryResponse["cost"] {
	const summary = summarise(tariff, hours.map(hourEnergy), supplyDays(hours, timezone));
	const previousNetCents = previous
		? summarise(tariff, previous.map(hourEnergy), supplyDays(previous, timezone)).netCents
		: null;
	return {
		byBand: summary.byBand.map((band) => ({
			blockId: band.blockId,
			label: band.label,
			kind: band.kind,
			centsPerKwh: band.centsPerKwh,
			kwh: band.kwh,
			cents: band.cents,
		})),
		importCents: summary.importCents,
		exportCents: summary.exportCents,
		supplyCents: summary.supplyCents,
		netCents: summary.netCents,
		previousNetCents,
	};
}
