import {
	parseMinutes,
	WEEKDAYS,
	type RateBlock,
	type RateKind,
	type RateWindow,
	type Tariff,
	type Weekday,
} from "@home-dashboard/shared";
import type { Logger } from "@home-dashboard/shared";

/**
 * Australian electricity tariff lookup via the Consumer Data Right.
 *
 * Retailers must publish Product Reference Data under the CDR, and the AER
 * mirrors all of it at cdr.energymadeeasy.gov.au with **no authentication and
 * no accreditation** — so a plan's real peak/shoulder/off-peak rates, their
 * time windows, the daily supply charge and the feed-in tariff can be imported
 * instead of typed off a bill.
 *
 * Two things learned the hard way and encoded here:
 *  - Retailers' own `publicBaseUri` endpoints from the ACCC register 404 for
 *    unregistered clients. Only the AER mirror is usable.
 *  - The AER brand slug is NOT derivable from the brand name: naive kebab-case
 *    resolves 26 of 84 brands. Dropping a trailing "energy"/"power"/"electric"
 *    recovers the majors (origin, alinta, momentum, globird, kogan, …), so
 *    candidates are tried in order and the winner is cached.
 *
 * Everything is lazy and cached. Nothing here runs at startup, and an AER
 * outage can only fail an import — never the dashboard.
 */

const REGISTER_URL = "https://api.cdr.gov.au/cdr-register/v1/energy/data-holders/brands/summary";
const AER_HOST = "https://cdr.energymadeeasy.gov.au";
const PAGE_SIZE = 1000;
/** Origin publishes ~3600 plans; 10 pages is headroom without runaway. */
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 20_000;
const REGISTER_TTL_MS = 24 * 60 * 60 * 1000;
const PLANS_TTL_MS = 6 * 60 * 60 * 1000;

export class AerError extends Error {}

export interface Retailer {
	/**
	 * Kebab-cased brand name — what the UI passes back.
	 *
	 * Deliberately NOT the register's `dataHolderBrandId`: only 33 of the 84
	 * energy brands carry one (the rest are AER-mirror listings with just an
	 * `interimId`), so keying on it silently produced id-less options for most
	 * retailers. `brandName` is the only identifier present on every entry.
	 */
	id: string;
	name: string;
	logoUri?: string;
}

export interface PlanSummary {
	planId: string;
	displayName: string;
	/** STANDING / MARKET / REGULATED. */
	type: string;
	customerType?: string;
	distributors: string[];
}

export interface PlanTariffDraft {
	tariff: Omit<Tariff, "id"> & { id: string };
	warnings: string[];
}

interface RegisterBrand {
	brandName: string;
	publicBaseUri: string;
	logoUri?: string;
	/** Present on only ~40% of energy brands — never rely on it. */
	dataHolderBrandId?: string;
}

interface CachedPlans {
	at: number;
	plans: (PlanSummary & { postcodes: Set<string> })[];
}

interface Cached<T> {
	at: number;
	value: T;
}

const kebab = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

/** Stable id for a retailer. Brand names are unique within the register. */
const retailerId = (brand: RegisterBrand): string => kebab(brand.brandName);

/**
 * Slug candidates in the order most likely to hit: the AER slug embedded in
 * the register URI when there is one, then the kebab name, then the kebab name
 * with a trailing generic word removed.
 */
function slugCandidates(brand: RegisterBrand): string[] {
	const candidates: string[] = [];
	if (brand.publicBaseUri.includes("energymadeeasy.gov.au")) {
		const tail = brand.publicBaseUri.replace(/\/+$/, "").split("/").pop();
		if (tail) candidates.push(tail);
	}
	const full = kebab(brand.brandName);
	candidates.push(full);
	const trimmed = full.replace(/-(energy|power|electric|electricity|retail)$/, "");
	if (trimmed && trimmed !== full) candidates.push(trimmed);
	return [...new Set(candidates)];
}

export class AerClient {
	private register: Cached<RegisterBrand[]> | null = null;
	/** brand id → resolved AER slug, or null when no candidate had plans. */
	private slugs = new Map<string, string | null>();
	private plans = new Map<string, CachedPlans>();
	private details = new Map<string, Cached<PlanTariffDraft>>();

	constructor(private logger: Logger) {}

	private async getJson<T>(url: string, version: number): Promise<T> {
		let res: Response;
		try {
			res = await fetch(url, {
				headers: { "x-v": String(version), "x-min-v": "1", accept: "application/json" },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (err) {
			throw new AerError(
				`could not reach the energy plan service (${err instanceof Error ? err.message : String(err)})`,
			);
		}
		if (!res.ok) throw new AerError(`energy plan service returned HTTP ${res.status}`);
		try {
			return (await res.json()) as T;
		} catch {
			throw new AerError("energy plan service returned a non-JSON response");
		}
	}

	private async loadRegister(): Promise<RegisterBrand[]> {
		if (this.register && Date.now() - this.register.at < REGISTER_TTL_MS) {
			return this.register.value;
		}
		const body = await this.getJson<{ data: RegisterBrand[] }>(REGISTER_URL, 1);
		const brands = (body.data ?? []).filter((b) => b.brandName && b.publicBaseUri);
		this.register = { at: Date.now(), value: brands };
		return brands;
	}

	async listRetailers(): Promise<Retailer[]> {
		const brands = await this.loadRegister();
		return brands
			.map((b) => ({ id: retailerId(b), name: b.brandName, logoUri: b.logoUri }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Resolve a retailer id to its AER slug, probing candidates with a one-record
	 * request. Cached (including the negative result) for the process lifetime.
	 */
	private async resolveSlug(id: string): Promise<string> {
		const cached = this.slugs.get(id);
		if (cached !== undefined) {
			if (cached === null) throw new AerError("no published plans found for this retailer");
			return cached;
		}
		const brand = (await this.loadRegister()).find((b) => retailerId(b) === id);
		if (!brand) throw new AerError(`unknown retailer "${id}"`);

		for (const slug of slugCandidates(brand)) {
			try {
				const body = await this.getJson<{ meta: { totalRecords: number } }>(
					`${AER_HOST}/${slug}/cds-au/v1/energy/plans?page-size=1`,
					1,
				);
				if ((body.meta?.totalRecords ?? 0) > 0) {
					this.logger.debug(`AER slug for ${brand.brandName}: ${slug}`);
					this.slugs.set(id, slug);
					return slug;
				}
			} catch {
				// Try the next candidate; only an exhausted list is an error.
			}
		}
		this.slugs.set(id, null);
		throw new AerError(`no published plans found for ${brand.brandName}`);
	}

	private async loadPlans(slug: string): Promise<CachedPlans["plans"]> {
		const cached = this.plans.get(slug);
		if (cached && Date.now() - cached.at < PLANS_TTL_MS) return cached.plans;

		const collected: CachedPlans["plans"] = [];
		for (let page = 1; page <= MAX_PAGES; page++) {
			const body = await this.getJson<{
				data: {
					plans: {
						planId: string;
						displayName?: string;
						type?: string;
						customerType?: string;
						fuelType?: string;
						geography?: { includedPostcodes?: string[]; distributors?: string[] };
					}[];
				};
				meta: { totalPages: number };
			}>(
				`${AER_HOST}/${slug}/cds-au/v1/energy/plans` +
					`?type=ALL&fuelType=ELECTRICITY&page-size=${PAGE_SIZE}&page=${page}`,
				1,
			);
			for (const plan of body.data?.plans ?? []) {
				collected.push({
					planId: plan.planId,
					displayName: plan.displayName ?? plan.planId,
					type: plan.type ?? "MARKET",
					customerType: plan.customerType,
					distributors: plan.geography?.distributors ?? [],
					postcodes: new Set(plan.geography?.includedPostcodes ?? []),
				});
			}
			if (page >= (body.meta?.totalPages ?? 1)) break;
		}
		this.plans.set(slug, { at: Date.now(), plans: collected });
		return collected;
	}

	/**
	 * Plans a retailer publishes, narrowed to a postcode. Postcode filtering is
	 * done here because the CDR plans endpoint has no postcode parameter — the
	 * geography comes back on every plan and a retailer publishes thousands.
	 */
	async listPlans(
		retailer: string,
		opts: { postcode?: string; customerType?: string } = {},
	): Promise<PlanSummary[]> {
		const slug = await this.resolveSlug(retailer);
		const plans = await this.loadPlans(slug);
		const wanted = opts.customerType ?? "RESIDENTIAL";
		return plans
			.filter((p) => !opts.postcode || p.postcodes.has(opts.postcode))
			.filter((p) => !p.customerType || p.customerType === wanted)
			.map(({ postcodes: _postcodes, ...summary }) => summary)
			.sort((a, b) => a.displayName.localeCompare(b.displayName));
	}

	/** Fetch a plan and map its CDR contract into our tariff shape. */
	async getPlanTariff(retailer: string, planId: string): Promise<PlanTariffDraft> {
		const slug = await this.resolveSlug(retailer);
		const key = `${slug}/${planId}`;
		const cached = this.details.get(key);
		if (cached && Date.now() - cached.at < PLANS_TTL_MS) return cached.value;

		const body = await this.getJson<{ data: CdrPlanDetail }>(
			`${AER_HOST}/${slug}/cds-au/v1/energy/plans/${encodeURIComponent(planId)}`,
			3,
		);
		const brand = (await this.loadRegister()).find((b) => retailerId(b) === retailer);
		const draft = mapPlanToTariff(body.data, { slug, brandName: brand?.brandName });
		this.details.set(key, { at: Date.now(), value: draft });
		return draft;
	}
}

// ---------------------------------------------------------------------------
// CDR → Tariff mapping
// ---------------------------------------------------------------------------

interface CdrRate {
	unitPrice?: string;
	measureUnit?: string;
}
interface CdrTimeWindow {
	days?: string[];
	startTime?: string;
	endTime?: string;
}
interface CdrTouRate {
	type?: string;
	rates?: CdrRate[];
	timeOfUse?: CdrTimeWindow[];
	displayName?: string;
	description?: string;
}
interface CdrTariffPeriod {
	displayName?: string;
	startDate?: string;
	endDate?: string;
	rateBlockUType?: string;
	singleRate?: { rates?: CdrRate[]; displayName?: string };
	timeOfUseRates?: CdrTouRate[];
	dailySupplyCharge?: string;
}
interface CdrFeedIn {
	tariffUType?: string;
	displayName?: string;
	singleTariff?: { rates?: CdrRate[] };
	timeVaryingTariffs?: {
		type?: string;
		rates?: CdrRate[];
		timeVariations?: CdrTimeWindow[];
		displayName?: string;
	}[];
	scheme?: string;
	payerType?: string;
}
interface CdrPlanDetail {
	planId?: string;
	displayName?: string;
	brandName?: string;
	electricityContract?: {
		timeZone?: string;
		tariffPeriod?: CdrTariffPeriod[];
		solarFeedInTariff?: CdrFeedIn[];
		controlledLoad?: unknown[];
		demandCharges?: unknown[];
		pricingModel?: string;
	};
}

/** CDR unit prices are dollars per kWh as strings; we store cents. */
function toCents(unitPrice: string | undefined): number | null {
	if (unitPrice === undefined) return null;
	const value = Number(unitPrice);
	return Number.isFinite(value) ? Math.round(value * 100 * 10_000) / 10_000 : null;
}

function firstKwhRate(rates: CdrRate[] | undefined): number | null {
	const rate = rates?.find((r) => (r.measureUnit ?? "KWH").toUpperCase() === "KWH") ?? rates?.[0];
	return toCents(rate?.unitPrice);
}

const KIND_BY_CDR_TYPE: Record<string, RateKind> = {
	PEAK: "peak",
	OFF_PEAK: "offpeak",
	SHOULDER: "shoulder",
	SHOULDER1: "shoulder",
	SHOULDER2: "shoulder",
};

/**
 * CDR end times are inclusive of the stated minute ("23:59" means midnight),
 * while RateWindow.endMin is exclusive — so the end always gains a minute.
 */
function mapWindows(windows: CdrTimeWindow[] | undefined, warnings: string[]): RateWindow[] {
	const mapped: RateWindow[] = [];
	for (const window of windows ?? []) {
		const days = (window.days ?? []).filter((d): d is Weekday =>
			(WEEKDAYS as readonly string[]).includes(d),
		);
		if ((window.days ?? []).some((d) => !(WEEKDAYS as readonly string[]).includes(d))) {
			warnings.push(
				"This plan prices public holidays differently — that is not modelled, " +
					"so holidays are charged at their weekday rate.",
			);
		}
		if (!days.length) continue;
		const startMin = parseMinutes(window.startTime ?? "00:00") ?? 0;
		const endRaw = parseMinutes(window.endTime ?? "23:59");
		const endMin = endRaw === null ? 1440 : Math.min(1440, endRaw + 1);
		mapped.push({ days, startMin, endMin });
	}
	return mapped;
}

/** Stable, readable block ids: peak, shoulder, shoulder-2, offpeak, … */
function uniqueId(base: string, taken: Set<string>): string {
	let candidate = base;
	for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`;
	taken.add(candidate);
	return candidate;
}

/** Pick the tariff period in force today; CDR dates are MM-DD (seasonal). */
function currentPeriod(periods: CdrTariffPeriod[], warnings: string[]): CdrTariffPeriod | null {
	if (periods.length === 0) return null;
	if (periods.length === 1) return periods[0]!;
	warnings.push(
		`This plan has ${periods.length} seasonal rate periods; the one covering today was imported. ` +
			"Re-import when the season changes, or edit the windows by hand.",
	);
	const now = new Date();
	const today = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	const covers = (period: CdrTariffPeriod) => {
		const { startDate, endDate } = period;
		if (!startDate || !endDate) return false;
		return startDate <= endDate
			? today >= startDate && today <= endDate
			: today >= startDate || today <= endDate; // wraps the new year
	};
	return periods.find(covers) ?? periods[0]!;
}

function mapImportBlocks(period: CdrTariffPeriod | null, warnings: string[]): RateBlock[] {
	if (!period) return [];
	const taken = new Set<string>();

	if (period.rateBlockUType === "timeOfUseRates" && period.timeOfUseRates?.length) {
		const blocks: RateBlock[] = [];
		for (const tou of period.timeOfUseRates) {
			const cents = firstKwhRate(tou.rates);
			if (cents === null) continue;
			const type = (tou.type ?? "").toUpperCase();
			const kind = KIND_BY_CDR_TYPE[type];
			if (!kind)
				warnings.push(`Unrecognised rate type "${tou.type}" imported as a shoulder rate.`);
			blocks.push({
				id: uniqueId(kind ?? "shoulder", taken),
				label: tou.displayName ?? tou.description ?? type ?? "Usage",
				kind: kind ?? "shoulder",
				centsPerKwh: cents,
				windows: mapWindows(tou.timeOfUse, warnings),
			});
		}
		// A windowless block is the catch-all, so a plan that publishes windows for
		// its peak rates and none for off-peak still prices every hour. Sort them
		// last, or the catch-all would shadow the windowed rates.
		const sorted = blocks.sort(
			(a, b) => Number(a.windows.length === 0) - Number(b.windows.length === 0),
		);
		if (sorted.filter((b) => b.windows.length === 0).length > 1) {
			warnings.push(
				"This plan has more than one usage rate with no time window; only the first is used " +
					"as the catch-all. Check the bands and delete any that don't apply.",
			);
		}
		return sorted;
	}

	const rates = period.singleRate?.rates ?? [];
	if (rates.length > 1) {
		warnings.push(
			"This plan has stepped/block usage rates (price changes after a kWh threshold); " +
				"only the first step was imported.",
		);
	}
	const cents = firstKwhRate(rates);
	if (cents === null) return [];
	return [
		{
			id: uniqueId("flat", taken),
			label: period.singleRate?.displayName ?? "Usage",
			kind: "flat",
			centsPerKwh: cents,
			windows: [],
		},
	];
}

function mapExportBlocks(feedIns: CdrFeedIn[] | undefined, warnings: string[]): RateBlock[] {
	const blocks: RateBlock[] = [];
	const taken = new Set<string>();
	for (const feedIn of feedIns ?? []) {
		if (feedIn.tariffUType === "timeVaryingTariffs") {
			for (const varying of feedIn.timeVaryingTariffs ?? []) {
				const cents = firstKwhRate(varying.rates);
				if (cents === null) continue;
				const kind = KIND_BY_CDR_TYPE[(varying.type ?? "").toUpperCase()] ?? "shoulder";
				blocks.push({
					id: uniqueId(`fit-${kind}`, taken),
					label: varying.displayName ?? feedIn.displayName ?? "Feed-in",
					kind,
					centsPerKwh: cents,
					windows: mapWindows(varying.timeVariations, warnings),
				});
			}
			continue;
		}
		const cents = firstKwhRate(feedIn.singleTariff?.rates);
		if (cents === null) continue;
		blocks.push({
			id: uniqueId("fit", taken),
			label: feedIn.displayName ?? "Feed-in tariff",
			kind: "flat",
			centsPerKwh: cents,
			windows: [],
		});
	}
	// Windowed blocks must be tried before the catch-all, or the flat one wins.
	const sorted = blocks.sort(
		(a, b) => Number(a.windows.length === 0) - Number(b.windows.length === 0),
	);
	// Several always-on feed-in rates means a volume-tiered scheme (a premium
	// rate for the first N kWh, then a lower one). Only the first can ever match,
	// and silently taking a legacy 44c rate would wildly overstate the credit.
	const catchAlls = sorted.filter((b) => b.windows.length === 0);
	if (catchAlls.length > 1) {
		warnings.push(
			`This plan publishes ${catchAlls.length} feed-in rates that apply at all times ` +
				`(${catchAlls.map((b) => `${b.centsPerKwh}c`).join(", ")}) — usually a tiered scheme ` +
				`capped at so many kWh a day, which is not modelled. Only ${catchAlls[0]!.centsPerKwh}c ` +
				`is used; delete the ones that don't apply to you.`,
		);
	}
	return sorted;
}

export function mapPlanToTariff(
	plan: CdrPlanDetail,
	ctx: { slug: string; brandName?: string },
): PlanTariffDraft {
	const warnings: string[] = [];
	const contract = plan.electricityContract;
	if (!contract) throw new AerError("this plan has no electricity contract to import");

	const period = currentPeriod(contract.tariffPeriod ?? [], warnings);
	const importBlocks = mapImportBlocks(period, warnings);
	const exportBlocks = mapExportBlocks(contract.solarFeedInTariff, warnings);

	if (!importBlocks.length) {
		warnings.push("No usage rates could be read from this plan — enter them by hand.");
	}
	if (!exportBlocks.length) {
		warnings.push("This plan publishes no solar feed-in tariff; exports are credited at 0c.");
	}
	if (contract.controlledLoad?.length) {
		warnings.push(
			"This plan has a controlled-load circuit (e.g. off-peak hot water). " +
				"That is billed separately and is not included here.",
		);
	}
	if (contract.demandCharges?.length) {
		warnings.push("This plan has demand charges, which are not modelled.");
	}

	const supplyCents = toCents(period?.dailySupplyCharge);

	return {
		tariff: {
			id: "",
			name: plan.displayName ?? plan.planId ?? "Imported plan",
			// CDR publishes an abbreviation ("AEST"), not an IANA zone, and it is the
			// retailer's zone rather than the meter's. The server runs in the house,
			// so its own zone is the better default; the editor can override it.
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			dailySupplyCents: supplyCents ?? 0,
			importBlocks,
			exportBlocks,
			source: {
				kind: "aer",
				brand: ctx.slug,
				brandName: ctx.brandName ?? plan.brandName,
				planId: plan.planId ?? "",
				planName: plan.displayName,
				retrievedAt: new Date().toISOString(),
			},
		},
		warnings: [...new Set(warnings)],
	};
}
