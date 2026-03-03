import { google } from "googleapis";
import { optionalEnv, requireEnv } from "./env";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

function maskClientId(clientId: string) {
  const visibleChars = 6;
  if (clientId.length <= visibleChars) return "*".repeat(clientId.length);
  return `${"*".repeat(clientId.length - visibleChars)}${clientId.slice(-visibleChars)}`;
}

/**
 * Creates an OAuth2 client for Gmail/Calendar using environment variables.
 */
export function createGoogleOAuthClientFromEnv() {
  const auth = createGoogleOAuthClientFromEnvWithoutRefreshToken();
  auth.setCredentials({
    refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN"),
  });

  return auth;
}

/**
 * Creates an OAuth2 client from environment variables without requiring refresh token.
 */
export function createGoogleOAuthClientFromEnvWithoutRefreshToken() {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = getGoogleRedirectUriFromEnv();

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return auth;
}

/**
 * Returns masked client id for startup diagnostics.
 */
export function getMaskedGoogleClientIdFromEnv() {
  return maskClientId(requireEnv("GOOGLE_CLIENT_ID"));
}

/**
 * Returns redirect URI used by OAuth client.
 */
export function getGoogleRedirectUriFromEnv() {
  return optionalEnv("GOOGLE_REDIRECT_URI", "http://localhost");
}

/**
 * True when Google API call failed due to missing OAuth scopes.
 */
export function isInsufficientScopesError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("insufficient authentication scopes") ||
    normalized.includes("missing required scopes")
  );
}
