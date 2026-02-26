import express from "express";
import { createDbClient } from "./db/client";
import { log } from "./lib/logger";
import { createAgentRouter } from "./routes/agent";
import { createBookingsRouter } from "./routes/bookings";
import { createEmailRouter } from "./routes/email";
import { AgentService } from "./services/agent.service";
import { BookingService } from "./services/booking.service";

type StartServerOptions = {
  bookingService?: BookingService;
  agentService?: AgentService;
};

/**
 * Starts the HTTP server.
 */
export function startServer(
  port = Number(process.env.PORT ?? 3000),
  options: StartServerOptions = {},
) {
  const app = express();
  app.use(express.json());

  const bookingService = options.bookingService ?? new BookingService(createDbClient());
  const agentService = options.agentService ?? new AgentService(bookingService);

  app.get("/", (_req, res) => {
    res.json({ message: "Booking-Ops API running with Bun " });
  });

  app.use("/bookings", createBookingsRouter(bookingService));
  app.use("/email", createEmailRouter(agentService));
  app.use("/agent", createAgentRouter(agentService));

  return app.listen(port, () => {
    log("info", "api.server.started", { port });
  });
}

if (import.meta.main) {
  startServer();
}
