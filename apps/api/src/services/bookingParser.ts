import type { ParsedBookingRequest } from "../types/booking";

function capture(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function toIso(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Parses a booking request email body into structured fields.
 */
export function parseBookingEmail(
  plainText: string,
  fallbackAgencyEmail?: string,
): { success: true; data: ParsedBookingRequest } | { success: false; missingFields: string[] } {
  const title = capture(plainText, /title\s*:\s*(.+)/im) ?? "Booking Request";
  const date = capture(plainText, /date\s*:\s*(.+)/im);
  const startRaw =
    capture(plainText, /start(?:[\s_]*time)?\s*:\s*(.+)/im) ??
    capture(plainText, /startAt\s*:\s*(.+)/im);
  const endRaw =
    capture(plainText, /end(?:[\s_]*time)?\s*:\s*(.+)/im) ??
    capture(plainText, /endAt\s*:\s*(.+)/im);
  const location = capture(plainText, /location\s*:\s*(.+)/im);
  const rateRaw = capture(plainText, /rate(?:[\s_]*quoted)?\s*:\s*\$?([0-9]+(?:[.,][0-9]+)?)/im);
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

  const startAt = startValue ? toIso(startValue) : null;
  const endAt = endValue ? toIso(endValue) : null;
  const rateQuoted = rateRaw ? Number(rateRaw.replace(",", "")) : Number.NaN;

  const missingFields: string[] = [];
  if (!startAt) missingFields.push("startAt");
  if (!endAt) missingFields.push("endAt");
  if (!location) missingFields.push("location");
  if (!agencyEmail) missingFields.push("agencyEmail");
  if (Number.isNaN(rateQuoted)) missingFields.push("rateQuoted");

  if (missingFields.length > 0) {
    return { success: false, missingFields };
  }

  return {
    success: true,
    data: {
      title,
      startAt,
      endAt,
      location,
      rateQuoted,
      agencyEmail,
    },
  };
}
