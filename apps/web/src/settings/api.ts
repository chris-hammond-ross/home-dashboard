import type { FrontendBootstrap, ScreenConfig } from "@home-dashboard/shared";

/** Thin fetch helpers for the screens REST API; non-2xx throws the server's error text. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

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
