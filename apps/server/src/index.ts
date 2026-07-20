import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { findConfigPath, loadConfig } from "./config.js";
import { openDatabase, resolveDbPath } from "./db/index.js";
import { ScreenStore } from "./db/screen-store.js";
import { ScreenService } from "./screens.js";
import { TopicHub } from "./hub.js";
import { PluginHost } from "./plugins.js";
import { registerScreenRoutes } from "./routes/screens.js";
import { registerWs } from "./ws.js";
import { makeLogger } from "./log.js";

const VERSION = "0.0.1";
const log = makeLogger("server");

async function main(): Promise<void> {
  const configPath = findConfigPath();
  const config = loadConfig(configPath);
  log.info(`config loaded from ${configPath}`);

  const dbPath = resolveDbPath(configPath, config.storage.path);
  const db = openDatabase(dbPath);
  log.info(`database at ${dbPath}`);
  const store = new ScreenStore(db);
  const imported = store.importFromConfig(config.screens);
  if (imported >= 0) log.info(`first boot: imported ${imported} screen(s) from YAML`);

  const hub = new TopicHub();
  const pluginHost = new PluginHost(hub, makeLogger);
  await pluginHost.start(config.integrations);
  log.info(`integrations up: ${config.integrations.filter((i) => i.enabled).length}`);

  // After plugin start so entity-hints handlers exist; retains core/screens from boot.
  const screens = new ScreenService(store, hub, pluginHost);
  screens.broadcast();

  const app = Fastify({ logger: false });
  await app.register(websocket);

  app.get("/api/health", () => ({
    ok: true,
    version: VERSION,
    uptimeSec: Math.round(process.uptime()),
  }));
  registerScreenRoutes(app, screens, config.ambient);

  registerWs(app, hub, pluginHost, VERSION);

  // In production the built frontend is served from here (dev uses Vite + proxy).
  const staticDir =
    process.env.STATIC_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api") || req.raw.url?.startsWith("/ws")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html"); // SPA fallback
    });
    log.info(`serving frontend from ${staticDir}`);
  }

  await app.listen({ host: config.server.host, port: config.server.port });
  log.info(`listening on http://${config.server.host}:${config.server.port}`);

  const shutdown = async (): Promise<void> => {
    log.info("shutting down");
    await pluginHost.dispose();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
