import type { ParsedBookingRequest } from "../types/booking";

function capture(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, "").trim());
}

function extractRateQuoted(plainText: string): number {
  const normalized = plainText.replace(/\u00a0/g, " ");
  const patterns = [
    /rate(?:[\s_]*quoted)?[\s:=-]*(?:usd\s*)?\$?\s*([0-9]{2,6}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/im,
    /\$\s*([0-9]{2,6}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/im,
    /\bUSD\s*([0-9]{2,6}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/im,
    /\b([0-9]{2,6}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:usd|dollars?)\b/im,
    /\b([0-9]{2,6})\s*(?:half[-\s]?day|full[-\s]?day)\b/im,
  ];

  for (const pattern of patterns) {
    const found = capture(normalized, pattern);
    if (!found) continue;
    const value = toNumber(found);
    if (!Number.isNaN(value)) return value;
  }

  return Number.NaN;
}

function toIso(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function stripOrdinalDaySuffix(value: string): string {
  return value.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
}

function inferYear(datePhrase: string, fallbackMessageDate?: string): string {
  if (/\b\d{4}\b/.test(datePhrase)) return datePhrase;
  const fallback = fallbackMessageDate ? new Date(fallbackMessageDate) : new Date();
  const year = Number.isNaN(fallback.getTime()) ? new Date().getFullYear() : fallback.getFullYear();
  return `${datePhrase} ${year}`;
}

function parseNaturalDateAndTimes(plainText: string, fallbackMessageDate?: string) {
  const text = stripOrdinalDaySuffix(plainText);
  const datePhrase =
    capture(text, /\bon\s+([A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?)(?=\s+(?:in|from)\b)/im) ??
    capture(text, /\bon\s+([A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?)/im);
  const timeMatch = text.match(
    /\bfrom\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|–)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/im,
  );
  if (!datePhrase || !timeMatch) return { startAt: null, endAt: null };

  const dated = inferYear(datePhrase, fallbackMessageDate);
  const startTime = timeMatch[1].trim();
  let endTime = timeMatch[2].trim();
  if (!/(am|pm)$/i.test(endTime) && /(am|pm)$/i.test(startTime)) {
    endTime = `${endTime}${startTime.match(/(am|pm)$/i)?.[0] ?? ""}`;
  }

  const startAt = toIso(`${dated} ${startTime}`);
  const endAt = toIso(`${dated} ${endTime}`);
  return { startAt, endAt };
}

function parseDurationHours(duration: string): number | null {
  const normalized = duration.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized === "half day" || normalized === "half-day") return 4;
  if (normalized === "full day" || normalized === "full-day") return 8;
  const hourMatch = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*hours?/);
  return hourMatch ? Number(hourMatch[1]) : null;
}

function extractDuration(plainText: string): string {
  return (
    capture(plainText, /duration\s*:\s*(half[-\s]?day|full[-\s]?day|[0-9]+(?:\.[0-9]+)?\s*hours?)/im) ??
    capture(plainText, /\b(half[-\s]?day|full[-\s]?day)\b/im) ??
    "half day"
  )
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function extractRateType(plainText: string): "half_day" | "full_day" | "hourly" | "flat" {
  const normalized = plainText.toLowerCase();
  if (/half[-\s]?day/.test(normalized)) return "half_day";
  if (/full[-\s]?day/.test(normalized)) return "full_day";
  if (/\bhourly\b|\bper\s+hour\b|\b\/hr\b|\b\/hour\b/.test(normalized)) return "hourly";
  if (/\b\/day\b|\bper\s+day\b/.test(normalized)) return "full_day";
  return "flat";
}

/**
 * Extracts minimum booking hours from phrases like "3 hour minimum".
 */
export function extractMinimumHoursFromText(plainText: string): number | null {
  const match = plainText.match(/\b(\d+(?:\.\d+)?)\s*hour\s*minimum\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses a booking request email body into structured fields.
 */
export function parseBookingEmail(
  plainText: string,
  fallbackAgencyEmail?: string,
  fallbackMessageDate?: string,
): { success: true; data: ParsedBookingRequest } | { success: false; missingFields: string[] } {
  const title = capture(plainText, /title\s*:\s*(.+)/im) ?? "Booking Request";
  const date = capture(plainText, /date\s*:\s*(.+)/im);
  const startRaw =
    capture(plainText, /start(?:[\s_]*time)?\s*:\s*(.+)/im) ??
    capture(plainText, /startAt\s*:\s*(.+)/im);
  const endRaw =
    capture(plainText, /end(?:[\s_]*time)?\s*:\s*(.+)/im) ??
    capture(plainText, /endAt\s*:\s*(.+)/im);
  const location =
    capture(plainText, /location\s*:\s*(.+)/im) ??
    capture(plainText, /\bin\s+([A-Za-z][A-Za-z .'-]{1,60}?)(?=\s+from\b)/im) ??
    "TBD";
  const duration = extractDuration(plainText);
  const agencyEmail =
    capture(plainText, /agency(?:[\s_]*email)?\s*:\s*([^\s]+@[^\s]+)/im) ?? fallbackAgencyEmail;

  const startValue =
    startRaw && /\d{4}-\d{2}-\d{2}t/i.test(startRaw)
      ? startRaw
      : date && startRaw
        ? `${date} ${startRaw}`
        : "";
  const endValue =
    endRaw && /\d{4}-\d{2}-\d{2}t/i.test(endRaw) ? endRaw : date && endRaw ? `${date} ${endRaw}` : "";

  const startAtFromContent = startValue ? toIso(startValue) : null;
  const endAtFromContent = endValue ? toIso(endValue) : null;
  const natural = parseNaturalDateAndTimes(plainText, fallbackMessageDate);
  const fallbackStartAt = fallbackMessageDate ? toIso(fallbackMessageDate) : null;
  const startAt = startAtFromContent ?? natural.startAt ?? fallbackStartAt;
  const durationHours = parseDurationHours(duration) ?? 4;
  const endAt =
    endAtFromContent ??
    natural.endAt ??
    (startAt ? new Date(new Date(startAt).getTime() + durationHours * 60 * 60 * 1000).toISOString() : null);
  const rateQuoted = extractRateQuoted(plainText);
  const rateType = extractRateType(plainText);

  const missingFields: string[] = [];
  if (!startAt) missingFields.push("startAt");
  if (!endAt) missingFields.push("endAt");
  if (!agencyEmail) missingFields.push("agencyEmail");
  if (Number.isNaN(rateQuoted)) missingFields.push("rateQuoted");

  if (missingFields.length > 0) {
    return { success: false, missingFields };
  }

  const parsedStartAt = startAt as string;
  const parsedEndAt = endAt as string;
  const parsedAgencyEmail = agencyEmail as string;

  return {
    success: true,
    data: {
      title,
      startAt: parsedStartAt,
      endAt: parsedEndAt,
      location,
      duration,
      rateType,
      rateQuoted,
      agencyEmail: parsedAgencyEmail,
    },
  };
}
