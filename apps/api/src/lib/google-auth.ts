import { google } from "googleapis";
import { optionalEnv, requireEnv } from "./env";

/**
 * Creates an OAuth2 client for Gmail/Calendar using environment variables.
 */
export function createGoogleOAuthClientFromEnv() {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = optionalEnv("GOOGLE_REDIRECT_URI", "http://localhost");

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({
    refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN"),
    ...(process.env.GOOGLE_ACCESS_TOKEN
      ? { access_token: process.env.GOOGLE_ACCESS_TOKEN }
      : {}),
    ...(process.env.GOOGLE_TOKEN_EXPIRY_DATE
      ? { expiry_date: Number(process.env.GOOGLE_TOKEN_EXPIRY_DATE) }
      : {}),
  });

  return auth;
}
