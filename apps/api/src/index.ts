import { createApp } from "./app";
import { log } from "./lib/logger";
import type { AgentService } from "./services/agentService";
import type { BookingsRepository } from "./db/bookings-repository";

type StartServerOptions = {
  bookingsRepository?: BookingsRepository;
  agentService?: AgentService;
};

/**
 * Starts the HTTP server.
 */
export function startServer(
  port = Number(process.env.PORT ?? 3000),
  options: StartServerOptions = {},
) {
  const app = createApp(options);
  return app.listen(port, () => {
    log("info", "api.server.started", { port });
  });
}

if (import.meta.main) {
  startServer();
}
