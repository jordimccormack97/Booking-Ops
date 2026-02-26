import express from "express";
import { BookingsRepository } from "./db/bookings-repository";
import { initDatabase } from "./db/sqlite";
import { log } from "./lib/logger";
import { createAgentRouter } from "./routes/agent";
import { createBookingsRouter } from "./routes/bookings";
import { createEmailRouter } from "./routes/email";
import { AgentService } from "./services/agentService";

type CreateAppOptions = {
  bookingsRepository?: BookingsRepository;
  agentService?: AgentService;
};

/**
 * Builds the API application and wires routes/services.
 */
export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.use(express.json());

  const bookingsRepository =
    options.bookingsRepository ?? new BookingsRepository(initDatabase());
  const agentService = options.agentService ?? new AgentService(bookingsRepository);

  app.get("/", (_req, res) => {
    res.json({ message: "Booking-Ops API running with Bun " });
  });

  app.use("/bookings", createBookingsRouter(bookingsRepository));
  app.use("/email", createEmailRouter(agentService));
  app.use("/agent", createAgentRouter(agentService));

  log("info", "api.app.ready");
  return app;
}
