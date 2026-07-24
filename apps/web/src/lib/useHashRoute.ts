import { useEffect, useState } from "react";

/** Minimal hash "router": #/settings etc. Empty string when no hash is set. */
export function useHashRoute(): string {
	const [hash, setHash] = useState(() => window.location.hash);
	useEffect(() => {
		const onChange = () => setHash(window.location.hash);
		window.addEventListener("hashchange", onChange);
		return () => window.removeEventListener("hashchange", onChange);
	}, []);
	return hash;
}
