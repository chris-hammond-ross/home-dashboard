import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  CreateScreenSchema,
  ReorderScreensSchema,
  ReplaceGeneratedSchema,
  UpdateScreenSchema,
  type AmbientConfig,
  type FrontendBootstrap,
} from "@home-dashboard/shared";
import type { ScreenService } from "../screens.js";
import { ConflictError, InvalidReorderError, NotFoundError } from "../db/screen-store.js";

/** Same algorithm onboarding uses for screen ids. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
  if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
  if (err instanceof InvalidReorderError) return reply.code(400).send({ error: err.message });
  throw err;
}

export function registerScreenRoutes(
  app: FastifyInstance,
  service: ScreenService,
  ambient: AmbientConfig,
): void {
  app.get("/api/screens", (): FrontendBootstrap => ({ ambient, screens: service.list() }));

  app.post("/api/screens", (req, reply) => {
    const parsed = CreateScreenSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    }
    const input = parsed.data;
    const id = input.id ?? service.uniquifyId(slugify(input.name));
    try {
      return reply.code(201).send(service.create({ ...input, id }));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.put<{ Params: { id: string } }>("/api/screens/:id", (req, reply) => {
    const bodyId = (req.body as { id?: unknown } | null)?.id;
    if (bodyId !== undefined && bodyId !== req.params.id) {
      return reply.code(400).send({ error: "screen id cannot be changed" });
    }
    const parsed = UpdateScreenSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    }
    try {
      return reply.send(service.update(req.params.id, parsed.data));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/screens/:id", (req, reply) => {
    try {
      service.delete(req.params.id);
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/api/screens/reorder", (req, reply) => {
    const parsed = ReorderScreensSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    }
    try {
      service.reorder(parsed.data.ids);
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/screens/:id/default", (req, reply) => {
    try {
      service.setDefault(req.params.id);
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Bulk replace of onboarding-owned screens (`pnpm onboard` calls this).
  app.put("/api/screens/generated", (req, reply) => {
    const parsed = ReplaceGeneratedSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    }
    return reply.send(service.replaceGenerated(parsed.data.screens));
  });
}
