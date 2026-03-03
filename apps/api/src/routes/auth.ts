import { Router } from "express";
import {
  GOOGLE_OAUTH_SCOPES,
  createGoogleOAuthClientFromEnvWithoutRefreshToken,
} from "../lib/google-auth";
import { log } from "../lib/logger";
import { GmailApiService } from "../services/gmail.service";

function maskSecret(value: string) {
  if (value.length <= 6) return "*".repeat(value.length);
  return `${"*".repeat(value.length - 6)}${value.slice(-6)}`;
}

/**
 * Creates Google OAuth routes for interactive local auth.
 */
export function createAuthRouter() {
  const router = Router();

  router.get("/google/start", (req, res) => {
    try {
      const oauth = createGoogleOAuthClientFromEnvWithoutRefreshToken();
      const force =
        req.query.force === "1" ||
        req.query.force === "true" ||
        req.query.force === "yes";
      const url = oauth.generateAuthUrl({
        access_type: "offline",
        include_granted_scopes: true,
        scope: [...GOOGLE_OAUTH_SCOPES],
        ...(force ? { prompt: "consent" } : {}),
      });
      return res.redirect(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to initialize Google OAuth";
      return res.status(500).json({ error: message });
    }
  });

  router.get("/google/callback", async (req, res) => {
    if (typeof req.query.error === "string" && req.query.error.length > 0) {
      return res.status(400).json({
        error: `Google OAuth error: ${req.query.error}`,
      });
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) return res.status(400).json({ error: "Missing required query param: code" });

    try {
      const oauth = createGoogleOAuthClientFromEnvWithoutRefreshToken();
      const { tokens } = await oauth.getToken(code);
      const grantedScope = tokens.scope ?? "";
      const newRefreshToken = tokens.refresh_token ?? null;

      if (newRefreshToken) {
        process.env.GOOGLE_REFRESH_TOKEN = newRefreshToken;
      }

      log("info", "google.oauth.granted_scopes", {
        grantedScopes: grantedScope || "(not returned)",
      });

      if (newRefreshToken) {
        log("info", "google.oauth.refresh_token.received", {
          refreshTokenRaw: newRefreshToken,
          refreshToken: maskSecret(newRefreshToken),
          note: "Copy GOOGLE_REFRESH_TOKEN into apps/api/.env for persistence",
        });

        return res.status(200).contentType("text/html").send(`<!doctype html>
<html>
  <body>
    <h1>Connected - copy your refresh token</h1>
    <p>Granted scopes:</p>
    <pre>${grantedScope || "(not returned by Google token endpoint)"}</pre>
    <p>Update <code>apps/api/.env</code> with:</p>
    <pre>GOOGLE_REFRESH_TOKEN=${newRefreshToken}</pre>
    <p>Then restart the API server.</p>
  </body>
</html>`);
      } else {
        log("warn", "google.oauth.refresh_token.missing", {
          grantedScopes: grantedScope || "(not returned)",
          note: "No new refresh token returned. Existing GOOGLE_REFRESH_TOKEN was left unchanged.",
        });

        return res.status(200).contentType("text/html").send(`<!doctype html>
<html>
  <body>
    <h1>Connected, no new refresh token returned</h1>
    <p>Your existing <code>GOOGLE_REFRESH_TOKEN</code> was not changed.</p>
    <p>Use <code>/auth/google/start?force=1</code> only when you need to rotate token/scopes.</p>
  </body>
</html>`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to complete OAuth callback";
      log("error", "google.oauth.callback.failed", { error: message });
      return res.status(500).json({ error: message });
    }
  });

  router.get("/google/status", async (_req, res) => {
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
      return res.json({ connected: false, email: null });
    }

    try {
      const gmail = new GmailApiService();
      const email = await gmail.getAuthenticatedEmail();
      return res.json({ connected: true, email });
    } catch {
      return res.json({ connected: false, email: null });
    }
  });

  return router;
}
