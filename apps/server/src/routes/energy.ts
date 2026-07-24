import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EnergyHistoryRequestSchema } from "@home-dashboard/shared";
import { EnergyRequestError, type EnergyService } from "../energy.js";

export function registerEnergyRoutes(app: FastifyInstance, service: EnergyService): void {
  app.post("/api/energy/history", async (req, reply) => {
    const parsed = EnergyHistoryRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    try {
      return reply.send(await service.history(parsed.data));
    } catch (err) {
      if (err instanceof EnergyRequestError) {
        return reply.code(400).send({ error: err.message });
      }
      // Home Assistant being down or lacking the recorder is expected, not a
      // server fault — surface it so the modal can say so plainly.
      return reply.code(502).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
