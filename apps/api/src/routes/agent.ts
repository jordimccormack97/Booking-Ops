import { Router } from "express";
import { log } from "../lib/logger";
import { AgentService } from "../services/agent.service";

/**
 * Creates routes for agent approval actions.
 */
export function createAgentRouter(agentService: AgentService) {
  const router = Router();

  router.post("/approve", async (req, res) => {
    const approvalToken = req.body?.approvalToken;
    if (typeof approvalToken !== "string" || approvalToken.trim().length === 0) {
      return res.status(400).json({ error: "approvalToken is required" });
    }

    try {
      const booking = await agentService.approveBooking(approvalToken.trim());
      return res.json(booking);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to approve booking";
      if (message.includes("not found")) {
        return res.status(404).json({ error: message });
      }
      if (message.includes("hold state")) {
        return res.status(409).json({ error: message });
      }
      log("error", "route.agent.approve.failed", { error: message });
      return res.status(500).json({ error: "Failed to approve booking" });
    }
  });

  return router;
}
