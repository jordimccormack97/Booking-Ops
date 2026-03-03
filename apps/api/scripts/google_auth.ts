import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { google } from "googleapis";
import { GOOGLE_OAUTH_SCOPES } from "../src/lib/google-auth";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI;

if (!clientId || !clientSecret || !redirectUri) {
  throw new Error(
    "Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI in apps/api/.env",
  );
}

const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const authUrl = oauth.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  include_granted_scopes: true,
  scope: [...GOOGLE_OAUTH_SCOPES],
});

console.log("Open this URL in your browser, approve access, then paste the code parameter.");
console.log(authUrl);

const rl = createInterface({ input, output });
const code = (await rl.question("Authorization code: ")).trim();
rl.close();

if (!code) throw new Error("Authorization code is required");

const tokenResponse = await oauth.getToken(code);
oauth.setCredentials(tokenResponse.tokens);

console.log("Google OAuth complete.");
console.log("Copy these values into apps/api/.env:");
console.log(`GOOGLE_REFRESH_TOKEN=${tokenResponse.tokens.refresh_token ?? ""}`);
