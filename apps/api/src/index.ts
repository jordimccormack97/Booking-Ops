import "dotenv/config";
import express from "express";
import { createDbClient } from "./db/client";
import { validateRequiredEnvVars } from "./lib/env";
import {
  GOOGLE_OAUTH_SCOPES,
  getGoogleRedirectUriFromEnv,
  getMaskedGoogleClientIdFromEnv,
} from "./lib/google-auth";
import { log } from "./lib/logger";
import { createAgentRouter } from "./routes/agent";
import { createAuthRouter } from "./routes/auth";
import { createBookingsRouter } from "./routes/bookings";
import { createEmailRouter } from "./routes/email";
import { createGmailRouter } from "./routes/gmail";
import { createPartnershipsRouter } from "./routes/partnerships";
import { createRatesRouter } from "./routes/rates";
import { createTestShootsRouter } from "./routes/test-shoots";
import { AgentService } from "./services/agent.service";
import { BookingExpensesService } from "./services/booking-expenses.service";
import { BookingService } from "./services/booking.service";
import { RatesService } from "./services/rates.service";

type StartServerOptions = {
  bookingService?: BookingService;
  ratesService?: RatesService;
  bookingExpensesService?: BookingExpensesService;
  agentService?: AgentService;
};

/**
 * Starts the HTTP server.
 */
export function startServer(
  port = Number(process.env.PORT ?? 3000),
  options: StartServerOptions = {},
) {
  validateRequiredEnvVars([
    "DATABASE_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
  ]);

  const app = express();
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowByPattern = (candidate: string) => {
      return (
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(candidate) ||
        /^https:\/\/.*\.netlify\.app$/i.test(candidate)
      );
    };
    if (origin && allowByPattern(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  });
  app.use(express.json());

  const db = createDbClient();
  const bookingService = options.bookingService ?? new BookingService(db);
  const ratesService = options.ratesService ?? new RatesService(db);
  const bookingExpensesService = options.bookingExpensesService ?? new BookingExpensesService(db);
  const agentService = options.agentService ?? new AgentService(bookingService);

  app.get("/", (_req, res) => {
    res.json({ message: "Booking-Ops API running with Bun " });
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/bookings", createBookingsRouter(bookingService, ratesService, bookingExpensesService));
  app.use("/rates", createRatesRouter(ratesService));
  app.use("/partnerships", createPartnershipsRouter(ratesService));
  app.use("/test-shoots", createTestShootsRouter(ratesService));
  app.use("/auth", createAuthRouter());
  app.use("/email", createEmailRouter(agentService));
  app.use("/gmail", createGmailRouter(agentService, ratesService));
  app.use("/agent", createAgentRouter(agentService));

  app.use((req, res) => {
    return res.status(404).json({
      error: "Route not found",
      path: req.path,
      method: req.method,
    });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Internal server error";
    return res.status(500).json({ error: message });
  });

  const server = app.listen(port, () => {
    log("info", "google.oauth.client.loaded", { clientId: getMaskedGoogleClientIdFromEnv() });
    log("info", "google.oauth.redirect_uri", { redirectUri: getGoogleRedirectUriFromEnv() });
    log("info", "google.oauth.scopes", { scopes: [...GOOGLE_OAUTH_SCOPES] });
    log("info", "api.server.started", { port });
  });

  server.on("close", () => {
    void db.close();
  });

  return server;
}

if (import.meta.main) {
  startServer();
}
