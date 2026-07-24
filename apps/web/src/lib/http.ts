/**
 * Thin fetch helper for the REST side of the API. Live state arrives over the
 * WebSocket (see socket.ts); REST covers request/response — CRUD from the
 * settings UI and on-demand history queries. Non-2xx throws the server's error
 * text so callers can show it verbatim.
 */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
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
