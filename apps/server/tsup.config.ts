import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	clean: true,
	sourcemap: true,
	// Workspace packages export TypeScript source, so bundle them in; real
	// node_modules deps (fastify, zod, ...) stay external.
	noExternal: [/^@home-dashboard\//],
});
