import { Router } from "express";
import { RatesService } from "../services/rates.service";

/**
 * Creates extracted-rates query routes.
 */
export function createRatesRouter(ratesService: RatesService) {
  const router = Router();

  router.get("/", async (req, res) => {
    const domain = typeof req.query.domain === "string" ? req.query.domain : undefined;
    const needsReview =
      typeof req.query.needsReview === "string"
        ? req.query.needsReview === "1" || req.query.needsReview.toLowerCase() === "true"
        : undefined;
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;

    const records = await ratesService.list({ domain, needsReview, dateFrom, dateTo });
    return res.json(records);
  });

  return router;
}
