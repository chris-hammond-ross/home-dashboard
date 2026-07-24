import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { CreateTariffSchema, UpdateTariffSchema } from "@home-dashboard/shared";
import type { TariffService } from "../tariffs.js";
import { AerError, type AerClient } from "../aer.js";
import { ConflictError, NotFoundError } from "../db/screen-store.js";

/** Same algorithm the screens routes use for ids. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
  if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
  // The AER is a third party: never let its outage read as a dashboard bug.
  if (err instanceof AerError) return reply.code(502).send({ error: err.message });
  throw err;
}

export function registerTariffRoutes(
  app: FastifyInstance,
  service: TariffService,
  aer: AerClient,
): void {
  app.get("/api/tariffs", () => ({ tariffs: service.list() }));

  app.post("/api/tariffs", (req, reply) => {
    const parsed = CreateTariffSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    const input = parsed.data;
    const id = input.id ?? service.uniquifyId(slugify(input.name));
    try {
      return reply.code(201).send(service.create({ ...input, id }));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.put<{ Params: { id: string } }>("/api/tariffs/:id", (req, reply) => {
    const bodyId = (req.body as { id?: unknown } | null)?.id;
    if (bodyId !== undefined && bodyId !== req.params.id) {
      return reply.code(400).send({ error: "tariff id cannot be changed" });
    }
    const parsed = UpdateTariffSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    try {
      return reply.send(service.update(req.params.id, parsed.data));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/tariffs/:id", (req, reply) => {
    try {
      service.delete(req.params.id);
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/tariffs/:id/active", (req, reply) => {
    try {
      service.setActive(req.params.id);
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // --- Plan import (Consumer Data Right, via the AER's public mirror) -------
  // Proxied rather than fetched from the browser: the kiosk stays LAN-only,
  // the CDR endpoints send no CORS headers, and the plan lists are multi-MB
  // and worth caching once per household rather than per page load.

  app.get("/api/tariffs/retailers", async (_req, reply) => {
    try {
      return reply.send({ retailers: await aer.listRetailers() });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  const PlanQuery = z.object({
    retailer: z.string().min(1),
    postcode: z
      .string()
      .regex(/^\d{4}$/, "postcode must be four digits")
      .optional(),
    customerType: z.enum(["RESIDENTIAL", "BUSINESS"]).optional(),
  });

  app.get("/api/tariffs/plans", async (req, reply) => {
    const parsed = PlanQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    try {
      const plans = await aer.listPlans(parsed.data.retailer, {
        postcode: parsed.data.postcode,
        customerType: parsed.data.customerType,
      });
      return reply.send({ plans });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Returns a DRAFT tariff for preview — nothing is stored until POSTed back. */
  app.get<{ Params: { retailer: string; planId: string } }>(
    "/api/tariffs/plans/:retailer/:planId",
    async (req, reply) => {
      try {
        const draft = await aer.getPlanTariff(req.params.retailer, req.params.planId);
        return reply.send(draft);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );
}
