import { Router } from "express";
import { RatesService } from "../services/rates.service";

/**
 * Lists portfolio-building test shoots in a dedicated folder view.
 */
export function createTestShootsRouter(ratesService: RatesService) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const rows = await ratesService.list({ recordType: "test_shoot", limit: 200 });
    return res.json(rows);
  });

  return router;
}
