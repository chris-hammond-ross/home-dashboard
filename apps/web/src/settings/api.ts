import type { FrontendBootstrap, ScreenConfig, Tariff } from "@home-dashboard/shared";
import { request } from "../lib/http.js";

export const fetchBootstrap = (): Promise<FrontendBootstrap> =>
	request<FrontendBootstrap>("/api/screens");

export const createScreen = (name: string): Promise<ScreenConfig> =>
	request<ScreenConfig>("/api/screens", { method: "POST", body: JSON.stringify({ name }) });

export const updateScreen = (id: string, body: Omit<ScreenConfig, "id">): Promise<ScreenConfig> =>
	request<ScreenConfig>(`/api/screens/${id}`, { method: "PUT", body: JSON.stringify(body) });

export const deleteScreen = (id: string): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/api/screens/${id}`, { method: "DELETE" });

export const reorderScreens = (ids: string[]): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>("/api/screens/reorder", {
		method: "POST",
		body: JSON.stringify({ ids }),
	});

export const setDefaultScreen = (id: string): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/api/screens/${id}/default`, { method: "POST" });

// --- tariffs ---------------------------------------------------------------

export interface StoredTariff extends Tariff {
	active: boolean;
}

export const fetchTariffs = (): Promise<{ tariffs: StoredTariff[] }> =>
	request<{ tariffs: StoredTariff[] }>("/api/tariffs");

export const createTariff = (body: Omit<Tariff, "id"> & { id?: string }): Promise<StoredTariff> =>
	request<StoredTariff>("/api/tariffs", { method: "POST", body: JSON.stringify(body) });

export const updateTariff = (id: string, body: Omit<Tariff, "id">): Promise<StoredTariff> =>
	request<StoredTariff>(`/api/tariffs/${id}`, { method: "PUT", body: JSON.stringify(body) });

export const deleteTariff = (id: string): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/api/tariffs/${id}`, { method: "DELETE" });

export const setActiveTariff = (id: string): Promise<{ ok: boolean }> =>
	request<{ ok: boolean }>(`/api/tariffs/${id}/active`, { method: "POST" });

// --- retailer plan import (Consumer Data Right, proxied by the server) ------

export interface Retailer {
	id: string;
	name: string;
	logoUri?: string;
}

export interface PlanSummary {
	planId: string;
	displayName: string;
	type: string;
	distributors: string[];
}

export const fetchRetailers = (): Promise<{ retailers: Retailer[] }> =>
	request<{ retailers: Retailer[] }>("/api/tariffs/retailers");

export const fetchPlans = (
	retailer: string,
	postcode?: string,
): Promise<{ plans: PlanSummary[] }> => {
	const params = new URLSearchParams({ retailer });
	if (postcode) params.set("postcode", postcode);
	return request<{ plans: PlanSummary[] }>(`/api/tariffs/plans?${params.toString()}`);
};

export const fetchPlanTariff = (
	retailer: string,
	planId: string,
): Promise<{ tariff: Tariff; warnings: string[] }> =>
	request<{ tariff: Tariff; warnings: string[] }>(
		`/api/tariffs/plans/${retailer}/${encodeURIComponent(planId)}`,
	);
