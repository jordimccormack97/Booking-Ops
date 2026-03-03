import { Router } from "express";
import { log } from "../lib/logger";
import { AgentService } from "../services/agent.service";

/**
 * Creates routes for triggering email ingestion.
 */
export function createEmailRouter(agentService: AgentService) {
  const router = Router();

  router.post("/ingest", async (req, res) => {
    const emailText = req.body?.emailText;
    const fromEmail = req.body?.fromEmail;
    const subject = req.body?.subject;

    if (typeof emailText !== "string" || emailText.trim().length === 0) {
      return res
        .status(400)
        .json({ error: "emailText is required and must be a non-empty string" });
    }

    try {
      const result = await agentService.ingestBookingContent({
        plainText: emailText,
        fromEmail: typeof fromEmail === "string" ? fromEmail : undefined,
        subject: typeof subject === "string" ? subject : undefined,
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (error) {
      log("error", "route.email.ingest_manual.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: "Failed to ingest booking email" });
    }
  });

  router.post("/ingest-test", async (_req, res) => {
    try {
      const result = await agentService.ingestTestBookingEmail();
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
