type LogLevel = "info" | "warn" | "error";

/**
 * Emits a structured JSON log line with a level and message.
 */
export function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(meta ?? {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}
