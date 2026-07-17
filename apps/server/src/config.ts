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

export function loadConfig(path: string): DashboardConfig {
  const raw: unknown = parse(readFileSync(path, "utf8"));
  const result = DashboardConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid config at ${path}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
