/**
 * Reads a required environment variable and throws if it is missing.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * Reads an optional environment variable and returns fallback when absent.
 */
export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

/**
 * Validates required environment variables and throws a single actionable error.
 */
export function validateRequiredEnvVars(names: string[]) {
  const missing = names.filter((name) => {
    const value = process.env[name];
    return !value || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. ` +
        "Add them to apps/api/.env (see apps/api/.env.example).",
    );
  }
}
