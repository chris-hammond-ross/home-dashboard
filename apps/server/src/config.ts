import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { DashboardConfigSchema, type DashboardConfig } from "@home-dashboard/shared";

/**
 * Config resolution order:
 *   1. DASHBOARD_CONFIG env var (absolute or cwd-relative path)
 *   2. config/local.yaml, then config/example.yaml — from cwd, then repo root
 *      (dev runs with cwd = apps/server, so ../../config covers the monorepo).
 */
const CANDIDATES = [
  "config/local.yaml",
  "config/example.yaml",
  "../../config/local.yaml",
  "../../config/example.yaml",
];

export function findConfigPath(): string {
  const fromEnv = process.env.DASHBOARD_CONFIG;
  if (fromEnv) {
    const path = resolve(fromEnv);
    if (!existsSync(path)) throw new Error(`DASHBOARD_CONFIG points to a missing file: ${path}`);
    return path;
  }
  for (const candidate of CANDIDATES) {
    const path = resolve(process.cwd(), candidate);
    if (existsSync(path)) return path;
  }
  throw new Error(
    "No config file found. Set DASHBOARD_CONFIG or create config/local.yaml (copy config/example.yaml).",
  );
}

/** Load .env (cwd, then repo root) so config can reference secrets as ${VAR}. */
function loadDotEnv(): void {
  for (const candidate of [".env", "../../.env"]) {
    try {
      process.loadEnvFile(resolve(process.cwd(), candidate));
    } catch {
      /* missing .env is fine */
    }
  }
}

/** Expand ${VAR} in every string value; collect missing vars for one clear error. */
function expandEnv(value: unknown, missing: Set<string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      const env = process.env[name];
      if (env === undefined) {
        missing.add(name);
        return "";
      }
      return env;
    });
  }
  if (Array.isArray(value)) return value.map((v) => expandEnv(v, missing));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandEnv(v, missing)]));
  }
  return value;
}

export function loadConfig(path: string): DashboardConfig {
  loadDotEnv();
  const parsed: unknown = parse(readFileSync(path, "utf8"));
  const missing = new Set<string>();
  const raw = expandEnv(parsed, missing);
  if (missing.size) {
    throw new Error(
      `Config ${path} references undefined environment variable(s): ${[...missing].join(", ")}. ` +
        `Set them in the environment or a .env file in the repo root.`,
    );
  }
  const result = DashboardConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid config at ${path}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
