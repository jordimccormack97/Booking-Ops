import { Router } from "express";
import { RatesService } from "../services/rates.service";

/**
 * Lists non-event partnership records separately from bookings.
 */
export function createPartnershipsRouter(ratesService: RatesService) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const rows = await ratesService.list({ recordType: "partnership", limit: 200 });
    return res.json(rows);
  });

  return router;
}
