import { tariffState, type Tariff } from "@home-dashboard/shared";
import type { TopicHub } from "./hub.js";
import type { StoredTariff, TariffStore } from "./db/tariff-store.js";

/**
 * Tariff mutations = store write + broadcast, mirroring ScreenService.
 *
 * The retained `core/tariff` topic carries the active plan *and* the band in
 * force right now, so the widget can show "Peak 51.3c · $1.42/h" without a
 * round-trip. A chained timer re-publishes at each window boundary — that is
 * the only thing on the server that ticks, and it fires a handful of times a
 * day, not on an interval.
 */
export class TariffService {
	private timer: NodeJS.Timeout | null = null;

	constructor(
		private store: TariffStore,
		private hub: TopicHub,
	) {}

	list(): StoredTariff[] {
		return this.store.list();
	}

	active(): StoredTariff | null {
		return this.store.active();
	}

	revision(): string {
		return this.store.revision();
	}

	create(input: Tariff, active?: boolean): StoredTariff {
		const created = this.store.create(input, active);
		this.broadcast();
		return created;
	}

	update(id: string, input: Omit<Tariff, "id">): StoredTariff {
		const updated = this.store.update(id, input);
		this.broadcast();
		return updated;
	}

	delete(id: string): void {
		this.store.delete(id);
		this.broadcast();
	}

	setActive(id: string): void {
		this.store.setActive(id);
		this.broadcast();
	}

	uniquifyId(base: string): string {
		return this.store.uniquifyId(base);
	}

	/** Also called once at startup so `core/tariff` is retained from boot. */
	broadcast(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const active = this.store.active();
		const state = tariffState(active, Date.now());
		this.hub.publish("core/tariff", state);

		if (!state.nextChangeAt) return;
		// Land just after the boundary so the new band resolves, and never
		// schedule a zero/negative delay (which would spin).
		const delay = Math.max(1000, new Date(state.nextChangeAt).getTime() - Date.now() + 500);
		this.timer = setTimeout(() => this.broadcast(), delay);
		this.timer.unref?.();
	}

	dispose(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}
}
