import { Router } from "express";
import { log } from "../lib/logger";
import { AgentService } from "../services/agentService";

/**
 * Creates routes for triggering email ingestion.
 */
export function createEmailRouter(agentService: AgentService) {
  const router = Router();

  router.post("/ingest-test", async (_req, res) => {
    try {
      const result = await agentService.ingestLatestUnreadTestEmail();
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (error) {
      log("error", "route.email.ingest.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: "Failed to ingest test booking email" });
    }
  });

  return router;
}
