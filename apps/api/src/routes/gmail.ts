import { Router } from "express";
import { isInsufficientScopesError } from "../lib/google-auth";
import { log } from "../lib/logger";
import { extractDirectionsUsaBooking } from "../services/aiExtraction.service";
import { AgentService } from "../services/agent.service";
import { CalendarService } from "../services/calendar.service";
import { type GmailMessage, GmailApiService } from "../services/gmail.service";
import { type CalendarStatus, type ExtractedRateRecord, type UpsertExtractedRateInput, RatesService } from "../services/rates.service";

type EventWindow =
  | { startAtIso: string; endAtIso: string; timezone: string }
  | { allDayDate: string; allDayEndDate: string };

function normalizeEmailText(value: string) {
  const lines = value.split(/\r?\n/);
  const output: string[] = [];
  for (const line of lines) {
    if (/^on .*wrote:$/i.test(line.trim())) break;
    if (/^(from|sent|to|subject)\s*:/i.test(line.trim())) break;
    output.push(line);
  }
  const joined = output.join("\n");
  return joined
    .replace(/(^|\n)(best|thanks|thank you|regards)[\s,!.-]*\n[\s\S]*$/i, "")
    .trim();
}

function parseEventDate(eventDateText: string, fallbackDate: string | null): Date | null {
  const fallback = fallbackDate ? new Date(fallbackDate) : new Date();
  const fallbackYear = fallback.getUTCFullYear();
  const normalized = eventDateText.trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  const parsedWithYear = new Date(`${normalized} ${fallbackYear}`);
  if (!Number.isNaN(parsedWithYear.getTime())) return parsedWithYear;
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const mmddMatch = normalized.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (!mmddMatch) return null;
  const month = Number(mmddMatch[1]);
  const day = Number(mmddMatch[2]);
  const date = new Date(Date.UTC(fallbackYear, month - 1, day, 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTimeTo24h(text: string): { hour: number; minute: number } | null {
  const match = text
    .toLowerCase()
    .match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (hour > 23 || minute > 59) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function toAllDayDate(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function resolveEventWindow(input: {
  eventDateText: string | null;
  startTimeText: string | null;
  endTimeText: string | null;
  dateReceived: string | null;
  timezone: string | null;
}): EventWindow | null {
  if (!input.eventDateText) return null;
  const date = parseEventDate(input.eventDateText, input.dateReceived);
  if (!date) return null;

  const startTime = input.startTimeText ? parseTimeTo24h(input.startTimeText) : null;
  const endTime = input.endTimeText ? parseTimeTo24h(input.endTimeText) : null;
  const timezone = input.timezone ?? "America/New_York";

  if (!startTime && !endTime) {
    const allDayDate = toAllDayDate(date);
    const allDayEndDate = toAllDayDate(new Date(new Date(`${allDayDate}T00:00:00Z`).getTime() + 86400000));
    return { allDayDate, allDayEndDate };
  }

  const start = new Date(date);
  const resolvedStart = startTime ?? { hour: 9, minute: 0 };
  start.setUTCHours(resolvedStart.hour, resolvedStart.minute, 0, 0);

  const end = new Date(date);
  const resolvedEnd = endTime ?? { hour: resolvedStart.hour + 4, minute: resolvedStart.minute };
  end.setUTCHours(resolvedEnd.hour, resolvedEnd.minute, 0, 0);
  if (end.getTime() <= start.getTime()) {
    end.setTime(start.getTime() + 4 * 60 * 60 * 1000);
  }

  return {
    startAtIso: start.toISOString(),
    endAtIso: end.toISOString(),
    timezone,
  };
}

function shouldRunAi(existing: ExtractedRateRecord | null) {
  if (!existing) return true;
  if (!existing.isBookingRequest) return true;
  if (!existing.eventDateText) return true;
  if (!existing.location) return true;
  if (existing.calendarStatus !== "on_calendar") return true;
  if (existing.rateQuoted === null || existing.rateType === null) return true;
  return false;
}

function looksLikeBookingRequest(text: string) {
  const normalized = text.toLowerCase();
  const hasKeywords = /\b(shoot|fitting|travel day|confirm(?:ed|ation)?|availability|hold|booking request|booked?)\b/i.test(
    normalized,
  );
  const hasDate =
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(
      normalized,
    ) || /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(normalized);
  return hasKeywords || hasDate;
}

const TITLE_STOP_WORDS = new Set([
  "re",
  "fw",
  "fwd",
  "confirmed",
  "confirmation",
  "calendar",
  "update",
  "hold",
  "booking",
  "request",
  "shoot",
  "model",
  "models",
  "day",
  "half",
  "full",
]);

type ExtractedRateLike = {
  messageId: string;
  threadId: string | null;
  subject: string | null;
  title: string | null;
  brandOrClient: string | null;
  eventDateText: string | null;
  location: string | null;
  isBookingRequest: boolean;
  notes: string[];
  rateQuoted: number | null;
  currency: "USD" | null;
  rateType: "half_day" | "full_day" | "hourly" | "flat" | null;
  recordType?: "booking" | "partnership" | "test_shoot";
  requestType?: "application" | "availability_check" | "booking_confirmation";
  minimumHours: number | null;
  dateReceived: string | null;
  fromEmail: string | null;
  startTimeText: string | null;
  endTimeText: string | null;
  timezone: string | null;
  jobType: "shoot" | "fitting" | "travel" | "other" | null;
  usageTerms: string[];
  confidence: number;
  financialConfidence: number | null;
  needsReview: boolean;
  calendarStatus: CalendarStatus;
  googleEventId: string | null;
};

function normalizeLabel(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/^(re|fw|fwd)\s*:\s*/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleTokens(input: ExtractedRateLike) {
  const label = normalizeLabel(input.title ?? input.brandOrClient ?? input.subject);
  if (!label) return new Set<string>();
  return new Set(
    label
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !TITLE_STOP_WORDS.has(token)),
  );
}

function hasTitleOverlap(a: ExtractedRateLike, b: ExtractedRateLike) {
  const aTokens = toTitleTokens(a);
  const bTokens = toTitleTokens(b);
  if (aTokens.size === 0 || bTokens.size === 0) return false;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  const minSet = Math.min(aTokens.size, bTokens.size);
  return overlap > 0 && overlap / minSet >= 0.5;
}

function parseDateToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    return `${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/);
  if (slash) {
    return `${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  const monthMatch = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/,
  );
  if (!monthMatch) return null;
  const monthMap: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    sept: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  return `${monthMap[monthMatch[1]]}-${monthMatch[2].padStart(2, "0")}`;
}

function normalizeLocation(value: string | null | undefined) {
  const normalized = normalizeLabel(value);
  if (!normalized || normalized === "tbd") return "";
  return normalized;
}

function isLocationCompatible(a: string | null | undefined, b: string | null | undefined) {
  const left = normalizeLocation(a);
  const right = normalizeLocation(b);
  if (!left || !right) return true;
  return left.includes(right) || right.includes(left);
}

function isDuplicateBookingEvent(incoming: ExtractedRateLike, existing: ExtractedRateRecord) {
  if (!incoming.isBookingRequest || !existing.isBookingRequest) return false;
  if (incoming.messageId === existing.messageId) return true;
  if (incoming.threadId && existing.threadId && incoming.threadId === existing.threadId) return true;
  const incomingDate = parseDateToken(incoming.eventDateText);
  const existingDate = parseDateToken(existing.eventDateText);
  if (!incomingDate || !existingDate || incomingDate !== existingDate) return false;
  if (!hasTitleOverlap(incoming, existing)) return false;
  return isLocationCompatible(incoming.location, existing.location);
}

function chooseDate(current: string | null, incoming: string | null) {
  if (!current) return incoming;
  if (!incoming) return current;
  const left = Date.parse(current);
  const right = Date.parse(incoming);
  if (Number.isNaN(left) || Number.isNaN(right)) return incoming;
  return right >= left ? incoming : current;
}

function chooseCalendarStatus(current: CalendarStatus, incoming: CalendarStatus): CalendarStatus {
  const rank: Record<CalendarStatus, number> = {
    not_requested: 0,
    needs_details: 1,
    needs_auth: 2,
    on_calendar: 3,
  };
  return rank[incoming] >= rank[current] ? incoming : current;
}

function chooseBookingStatus(
  current: UpsertExtractedRateInput["bookingStatus"],
  incoming: UpsertExtractedRateInput["bookingStatus"],
) {
  const rank = {
    request: 0,
    needs_confirmation: 1,
    follow_up: 2,
    confirmed: 3,
    canceled: 4,
  } as const;
  const currentValue = current ?? "request";
  const incomingValue = incoming ?? "request";
  return rank[incomingValue] >= rank[currentValue] ? incomingValue : currentValue;
}

function chooseRecordType(
  current: UpsertExtractedRateInput["recordType"],
  incoming: UpsertExtractedRateInput["recordType"],
) {
  if (current === "partnership" || incoming === "partnership") return "partnership";
  if (current === "test_shoot" || incoming === "test_shoot") return "test_shoot";
  return "booking";
}

function chooseRequestType(
  current: UpsertExtractedRateInput["requestType"],
  incoming: UpsertExtractedRateInput["requestType"],
) {
  const rank = {
    application: 2,
    availability_check: 1,
    booking_confirmation: 0,
  } as const;
  const currentValue = current ?? "availability_check";
  const incomingValue = incoming ?? "availability_check";
  return rank[incomingValue] >= rank[currentValue] ? incomingValue : currentValue;
}

function mergeUnique(a: string[], b: string[]) {
  return [...new Set([...a, ...b])];
}

function chooseLonger(preferred: string | null, fallback: string | null) {
  if (!preferred) return fallback;
  if (!fallback) return preferred;
  return preferred.length >= fallback.length ? preferred : fallback;
}

function mergeWithExisting(existing: ExtractedRateRecord, incoming: UpsertExtractedRateInput): UpsertExtractedRateInput {
  const rateQuoted = incoming.rateQuoted ?? existing.rateQuoted;
  const financialConfidence =
    incoming.financialConfidence !== null && incoming.financialConfidence !== undefined
      ? incoming.financialConfidence
      : existing.financialConfidence;

  return {
    source: "directionsusa",
    messageId: existing.messageId,
    threadId: incoming.threadId ?? existing.threadId,
    subject: chooseLonger(incoming.subject, existing.subject),
    fromEmail: incoming.fromEmail ?? existing.fromEmail,
    dateReceived: chooseDate(existing.dateReceived, incoming.dateReceived),
    isBookingRequest: existing.isBookingRequest || incoming.isBookingRequest,
    title: chooseLonger(incoming.title, existing.title),
    brandOrClient: chooseLonger(incoming.brandOrClient, existing.brandOrClient),
    jobType: incoming.jobType ?? existing.jobType,
    eventDateText: incoming.eventDateText ?? existing.eventDateText,
    startTimeText: incoming.startTimeText ?? existing.startTimeText,
    endTimeText: incoming.endTimeText ?? existing.endTimeText,
    timezone: incoming.timezone ?? existing.timezone,
    minimumHours: incoming.minimumHours ?? existing.minimumHours,
    location: incoming.location ?? existing.location ?? "TBD",
    rateQuoted,
    currency: rateQuoted === null ? null : incoming.currency ?? existing.currency,
    rateType: rateQuoted === null ? null : incoming.rateType ?? existing.rateType,
    recordType: chooseRecordType(existing.recordType, incoming.recordType),
    requestType: chooseRequestType(existing.requestType, incoming.requestType),
    bookingStatus: chooseBookingStatus(existing.bookingStatus, incoming.bookingStatus),
    linkedMessageIds: mergeUnique(
      existing.linkedMessageIds ?? [existing.messageId],
      incoming.linkedMessageIds ?? [incoming.messageId],
    ),
    usageTerms: mergeUnique(existing.usageTerms ?? [], incoming.usageTerms ?? []),
    notes: mergeUnique(existing.notes ?? [], incoming.notes ?? []),
    confidence: Math.max(existing.confidence ?? 0, incoming.confidence ?? 0),
    financialConfidence,
    needsReview: rateQuoted === null,
    calendarStatus: chooseCalendarStatus(existing.calendarStatus, incoming.calendarStatus),
    googleEventId: existing.googleEventId ?? incoming.googleEventId,
  };
}

function findDuplicateCandidate(incoming: ExtractedRateLike, existingRows: ExtractedRateRecord[]) {
  for (const existing of existingRows) {
    if (isDuplicateBookingEvent(incoming, existing)) return existing;
  }
  return null;
}

function toUpsertInputFromRecord(record: ExtractedRateRecord): UpsertExtractedRateInput {
  return {
    source: "directionsusa",
    messageId: record.messageId,
    threadId: record.threadId,
    subject: record.subject,
    fromEmail: record.fromEmail,
    dateReceived: record.dateReceived,
    isBookingRequest: record.isBookingRequest,
    title: record.title,
    brandOrClient: record.brandOrClient,
    jobType: record.jobType,
    eventDateText: record.eventDateText,
    startTimeText: record.startTimeText,
    endTimeText: record.endTimeText,
    timezone: record.timezone,
    minimumHours: record.minimumHours,
    location: record.location,
    rateQuoted: record.rateQuoted,
    currency: record.currency,
    rateType: record.rateType,
    recordType: record.recordType,
    requestType: record.requestType,
    bookingStatus: record.bookingStatus,
    linkedMessageIds: record.linkedMessageIds,
    usageTerms: record.usageTerms,
    notes: record.notes,
    confidence: record.confidence,
    financialConfidence: record.financialConfidence,
    needsReview: record.needsReview,
    calendarStatus: record.calendarStatus,
    googleEventId: record.googleEventId,
  };
}

function bookingQualityScore(row: ExtractedRateRecord) {
  let score = 0;
  if (row.rateQuoted !== null) score += 5;
  if (row.location && normalizeLocation(row.location).length > 0) score += 2;
  if (row.eventDateText && row.eventDateText.trim().length > 0) score += 2;
  if (!row.needsReview) score += 1;
  const received = row.dateReceived ? Date.parse(row.dateReceived) : Number.NaN;
  if (!Number.isNaN(received)) score += received / 1e13;
  return score;
}

function titleSignature(input: ExtractedRateLike) {
  const tokens = [...toTitleTokens(input)].sort();
  return tokens.slice(0, 4).join("|");
}

function dedupeEventKey(input: ExtractedRateLike) {
  if (input.recordType === "partnership") return null;
  if (!input.isBookingRequest) return null;
  const dateKey = parseDateToken(input.eventDateText ?? input.subject);
  if (!dateKey) return null;
  const locationKey = normalizeLocation(input.location);
  if (!locationKey) return null;
  const signature = titleSignature(input);
  if (!signature) return null;
  return `${dateKey}|${locationKey}|${signature}`;
}

function shouldMarkAsPartnership(input: {
  subject: string | null;
  body: string;
  eventDateText: string | null;
  title: string | null;
  brandOrClient: string | null;
}) {
  const combined = `${input.subject ?? ""}\n${input.title ?? ""}\n${input.brandOrClient ?? ""}\n${input.body}`.toLowerCase();
  if (/\bathletic clients? casting\b/i.test(combined)) return true;
  const mentionsBelk = combined.includes("belk");
  if (!mentionsBelk) return false;
  const broadAvailabilitySignals =
    /\b(availability|month of|all weeks|mon fri|monday through friday|keep your calendar open)\b/i.test(combined);
  const hasSpecificDate = parseDateToken(input.eventDateText) !== null;
  return broadAvailabilitySignals || !hasSpecificDate;
}

function shouldMarkAsTestShoot(input: {
  subject: string | null;
  body: string;
  title: string | null;
  brandOrClient: string | null;
}) {
  const combined = `${input.subject ?? ""}\n${input.title ?? ""}\n${input.brandOrClient ?? ""}\n${input.body}`.toLowerCase();
  return /\b(test shoot|testing shoot|portfolio shoot|portfolio test|pay the photographer|paid test)\b/i.test(
    combined,
  );
}

function detectRequestType(input: { subject: string | null; body: string; title: string | null }) {
  const combined = `${input.subject ?? ""}\n${input.title ?? ""}\n${input.body}`.toLowerCase();
  if (/\bfamily dollar\b/i.test(combined)) {
    return "availability_check" as const;
  }
  if (/\biqvia\b/i.test(combined)) {
    return "availability_check" as const;
  }
  const hasCastingSignals =
    /\b(audition|self tape|apply|application|submission|submit|casting call|open call|casting)\b/i.test(combined);
  const knownApplyClients = /\b(athletic clients|real guys|gucci|bojangles)\b/i.test(combined);
  if (hasCastingSignals || knownApplyClients) {
    return "application" as const;
  }
  if (/\b(availability|avail\\b|hold|pencil|check your calendar|let me know if you can)\b/i.test(combined)) {
    return "availability_check" as const;
  }
  return "booking_confirmation" as const;
}

function deriveInitialBookingStatus(
  requestType: "application" | "availability_check" | "booking_confirmation",
  input: { subject: string | null; body: string },
) {
  const combined = `${input.subject ?? ""}\n${input.body}`.toLowerCase();
  if (requestType === "application") return "request" as const;
  if (/\b(confirmed|booked|locked in|you are in|final confirmation)\b/i.test(combined)) {
    return "confirmed" as const;
  }
  return "needs_confirmation" as const;
}

function ownerResponseSignal(messageText: string): "yes" | "no" | null {
  const text = normalizeEmailText(messageText).toLowerCase();
  if (!text) return null;
  if (
    /\b(not available|unavailable|cannot|can't|cant|decline|declined|pass|not interested|won't be able|wont be able|unable)\b/i.test(
      text,
    )
  ) {
    return "no";
  }
  if (
    /\b(yes|available|i can|can do|works for me|that works|sounds good|confirmed on my end)\b/i.test(
      text,
    )
  ) {
    return "yes";
  }
  return null;
}

function parseDateOrZero(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getOwnerResponseDecision(
  threadMessages: GmailMessage[],
  ownerEmail: string | null,
): "yes" | "no" | null {
  if (!ownerEmail) return null;
  const normalizedOwner = ownerEmail.trim().toLowerCase();
  const mine = threadMessages.filter(
    (message) => (message.fromEmail ?? "").trim().toLowerCase() === normalizedOwner,
  );
  if (mine.length === 0) return null;
  const ordered = [...mine].sort((a, b) => parseDateOrZero(a.date) - parseDateOrZero(b.date));
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const signal = ownerResponseSignal(ordered[index]?.plainText ?? "");
    if (signal) return signal;
  }
  return null;
}

function applyOwnerResponseToBookingStatus(input: {
  currentStatus: UpsertExtractedRateInput["bookingStatus"];
  requestType: UpsertExtractedRateInput["requestType"];
  ownerDecision: "yes" | "no" | null;
}): UpsertExtractedRateInput["bookingStatus"] {
  if (!input.ownerDecision) return input.currentStatus ?? "request";
  if (input.ownerDecision === "no") return "canceled";
  if (input.currentStatus === "confirmed") return "confirmed";
  if (input.requestType === "application") return "follow_up";
  return "needs_confirmation";
}

async function consolidateExistingDuplicates(
  ratesService: RatesService,
  existingRows: ExtractedRateRecord[],
) {
  const groups = new Map<string, ExtractedRateRecord[]>();
  for (const row of existingRows) {
    const key = dedupeEventKey(row);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  let removed = 0;
  let merged = 0;
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const ordered = [...group].sort((a, b) => bookingQualityScore(b) - bookingQualityScore(a));
    let canonical = ordered[0];

    for (let index = 1; index < ordered.length; index += 1) {
      const duplicate = ordered[index];
      const mergedInput = mergeWithExisting(canonical, toUpsertInputFromRecord(duplicate));
      const saved = await ratesService.upsert(mergedInput);
      const deleted = await ratesService.deleteById(duplicate.id);
      canonical = saved;
      if (deleted) {
        removed += 1;
        merged += 1;
      }
    }
  }

  return { removed, merged };
}

/**
 * Creates Gmail-facing routes used by the web dashboard.
 */
export function createGmailRouter(agentService: AgentService, ratesService: RatesService) {
  const router = Router();

  router.get("/health", (_req, res) => {
    return res.json({ ok: true });
  });

  router.get("/profile", async (_req, res) => {
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
      return res.json({ connected: false, email: null, error: "Missing GOOGLE_REFRESH_TOKEN" });
    }

    try {
      const gmail = new GmailApiService();
      const email = await gmail.getAuthenticatedEmail();
      return res.json({ connected: true, email, error: null });
    } catch (error) {
      return res.json({
        connected: false,
        email: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/sync", async (req, res) => {
    console.log("[gmail/sync] hit", {
      time: new Date().toISOString(),
      body: req.body,
    });

    const query =
      typeof req.body?.query === "string" && req.body.query.trim().length > 0
        ? req.body.query.trim()
        : "newer_than:30d from:directionsusa.com";
    const force = req.body?.force === true;
    const limitRaw = Number(req.body?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;
    const tableName = "public.extracted_rates";

    try {
      const gmail = new GmailApiService();
      let ownerEmail: string | null = null;
      try {
        ownerEmail = (await gmail.getAuthenticatedEmail()).toLowerCase();
      } catch {
        ownerEmail = null;
      }
      const messages = await gmail.fetchMessagesForSync(query, limit);
      let existingRows = await ratesService.list({ bookingsOnly: true, limit: 2000 });
      const dedupeStats = await consolidateExistingDuplicates(ratesService, existingRows);
      if (dedupeStats.removed > 0) {
        existingRows = await ratesService.list({ bookingsOnly: true, limit: 2000 });
        log("info", "[DEDUPE] existing_rows_consolidated", dedupeStats);
      }

      let added = 0;
      let skipped = 0;
      let errors = 0;
      let totalUpserted = 0;
      const totalFetched = messages.length;
      const skippedReasons = {
        existingMessage: 0,
        existingThread: 0,
        parseFailed: 0,
        duplicateEvent: 0,
      };

      for (const message of messages) {
        try {
          let threadText = "";
          let threadMessages: GmailMessage[] = [];
          if (message.threadId) {
            try {
              threadMessages = await gmail.fetchThreadMessages(message.threadId);
              threadText = threadMessages
                .map((threadMessage) => normalizeEmailText(threadMessage.plainText))
                .filter(Boolean)
                .join("\n\n--- THREAD ---\n\n");
            } catch (threadError) {
              log("warn", "[INGEST] thread_fetch_failed", {
                messageId: message.id,
                threadId: message.threadId,
                error: threadError instanceof Error ? threadError.message : String(threadError),
              });
              // Continue without thread text - it's optional
              threadText = "";
              threadMessages = [];
            }
          }

          const aiInput = [normalizeEmailText(message.plainText), threadText]
            .filter(Boolean)
            .join("\n\n--- THREAD ---\n\n");

          const extracted = await extractDirectionsUsaBooking(aiInput || message.plainText, {
            messageId: message.id,
            threadId: message.threadId ?? message.id,
            subject: message.subject || null,
            from: message.fromEmail || null,
            dateReceived: message.date || null,
          });
          const bookingLike = looksLikeBookingRequest(
            `${message.subject ?? ""}\n${message.plainText ?? ""}`,
          );

          const resolved = extracted ?? {
            source: "directionsusa" as const,
            messageId: message.id,
            threadId: message.threadId ?? message.id,
            subject: message.subject || null,
            from: message.fromEmail || null,
            dateReceived: message.date || null,
            isBookingRequest: false,
            confidence: 0,
            title: message.subject || "Booking request",
            clientOrBrand: null,
            eventDateText: null,
            startTimeText: null,
            endTimeText: null,
            timezone: "America/New_York",
            location: null,
            notes: [],
            minimumHours: null,
            rateQuoted: null,
            currency: null,
            rateType: null,
            financialConfidence: null,
            jobType: null,
            usageTerms: [],
          };

          const requestType = detectRequestType({
            subject: resolved.subject,
            title: resolved.title,
            body: aiInput || message.plainText,
          });
          const ownerDecision = getOwnerResponseDecision(threadMessages, ownerEmail);
          const ownerAwareStatus = applyOwnerResponseToBookingStatus({
            currentStatus: deriveInitialBookingStatus(requestType, {
              subject: resolved.subject,
              body: aiInput || message.plainText,
            }),
            requestType,
            ownerDecision,
          });

          const row: UpsertExtractedRateInput = {
            source: "directionsusa",
            messageId: resolved.messageId,
            threadId: resolved.threadId,
            subject: resolved.subject,
            fromEmail: resolved.from,
            dateReceived: resolved.dateReceived,
            isBookingRequest: bookingLike || (extracted ? resolved.isBookingRequest : false),
            title: resolved.title ?? resolved.subject ?? "Booking request",
            brandOrClient: resolved.clientOrBrand,
            jobType: resolved.jobType,
            eventDateText: resolved.eventDateText,
            startTimeText: resolved.startTimeText,
            endTimeText: resolved.endTimeText,
            timezone: resolved.timezone,
            minimumHours: resolved.rateQuoted === null ? null : resolved.minimumHours,
            location: resolved.location ?? "TBD",
            rateQuoted: resolved.rateQuoted,
            currency: resolved.rateQuoted === null ? null : resolved.currency,
            rateType: resolved.rateQuoted === null ? null : resolved.rateType,
            recordType: shouldMarkAsPartnership({
              subject: resolved.subject,
              body: aiInput || message.plainText,
              eventDateText: resolved.eventDateText,
              title: resolved.title,
              brandOrClient: resolved.clientOrBrand,
            })
              ? "partnership"
              : shouldMarkAsTestShoot({
                    subject: resolved.subject,
                    body: aiInput || message.plainText,
                    title: resolved.title,
                    brandOrClient: resolved.clientOrBrand,
                  })
                ? "test_shoot"
                : "booking",
            requestType,
            bookingStatus: ownerAwareStatus,
            linkedMessageIds: [resolved.messageId],
            usageTerms: resolved.usageTerms ?? [],
            notes:
              ownerDecision === null
                ? (resolved.notes ?? [])
                : [...(resolved.notes ?? []), `Talent response detected from ${ownerEmail}: ${ownerDecision}`],
            confidence: resolved.confidence,
            financialConfidence: resolved.rateQuoted === null ? null : resolved.financialConfidence,
            needsReview: resolved.rateQuoted === null,
            calendarStatus: "not_requested",
            googleEventId: null,
          };

          // Ensure we have required fields for database
          if (!row.messageId) {
            console.log("[SKIP] No messageId", { subject: resolved.subject });
            continue;
          }

          let upsertInput = row;
          const duplicate = findDuplicateCandidate(row, existingRows);
          if (duplicate && duplicate.messageId !== row.messageId) {
            upsertInput = mergeWithExisting(duplicate, row);
            skipped += 1;
            skippedReasons.duplicateEvent += 1;
            console.log("[DEDUPE] merge_duplicate_event", {
              incomingMessageId: row.messageId,
              existingMessageId: duplicate.messageId,
              subject: row.subject,
            });
          }

          console.log(`UPSERTING messageId=${upsertInput.messageId}`, {
            tableName,
            messageId: upsertInput.messageId,
            threadId: upsertInput.threadId,
            subject: upsertInput.subject,
            rateQuoted: upsertInput.rateQuoted,
            force,
          });

          const saved = await ratesService.upsert(upsertInput);
          const existingIndex = existingRows.findIndex((item) => item.messageId === saved.messageId);
          if (existingIndex >= 0) {
            existingRows[existingIndex] = saved;
          } else {
            existingRows.push(saved);
          }

          if (saved.isBookingRequest) {
            console.log("[CALENDAR] booking_request_detected", {
              messageId: saved.messageId,
              threadId: saved.threadId,
              subject: saved.subject,
              hasFinancials: saved.rateQuoted !== null,
              calendarStatus: saved.calendarStatus,
            });
          }

          if (!duplicate || duplicate.messageId === row.messageId) {
            added += 1;
          }
          totalUpserted += 1;
        } catch (error) {
          if (isInsufficientScopesError(error)) {
            throw new Error(
              "Google token is missing required scopes. Re-connect via /auth/google/start and update GOOGLE_REFRESH_TOKEN in apps/api/.env.",
            );
          }
          errors += 1;
          const errorMsg = error instanceof Error ? error.message : String(error);
          log("error", "[INGEST] sync_item_failed", {
            messageId: message.id,
            subject: message.subject?.substring(0, 50),
            error: errorMsg,
          });
          console.log(`[SYNC ERROR] message_id=${message.id}: ${errorMsg.substring(0, 100)}`);
        }
      }

      const debugRows = await ratesService.list({ limit: 10 });

      console.log("[NEON DEBUG ROWS]", {
        rowsCount: debugRows.length,
        firstMessageId: debugRows.length > 0 ? debugRows[0]?.messageId ?? null : null,
      });

      console.log("[EXTRACTED_RATES SYNC] counters", {
        inserted: added,
        skipped_existing: skippedReasons.existingMessage,
        skipped_parse_failed: skippedReasons.parseFailed,
      });
      console.log("[GMAIL SYNC SUMMARY]", {
        totalFetched,
        totalUpserted,
        totalErrors: errors,
      });

      return res.json({
        added,
        skipped,
        errors,
        duplicatesRemoved: dedupeStats.removed,
        skippedReasons,
        debugRows,
      });
    } catch (error) {
      if (isInsufficientScopesError(error)) {
        return res.status(401).json({
          added: 0,
          skipped: 0,
          errors: 1,
          error:
            "Google token is missing required Gmail/Calendar scopes. Re-connect via /auth/google/start and update GOOGLE_REFRESH_TOKEN in apps/api/.env.",
        });
      }
      return res.status(500).json({
        added: 0,
        skipped: 0,
        errors: 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/sync-directionsusa", async (_req, res) => {
    const query = "newer_than:365d (from:directionsusa.com OR from:@directionsusa.com)";
    const gmail = new GmailApiService();
    let ownerEmail: string | null = null;
    try {
      ownerEmail = (await gmail.getAuthenticatedEmail()).toLowerCase();
    } catch {
      ownerEmail = null;
    }
    const calendar = new CalendarService();
    const messages = await gmail.fetchAllMessagesForQuery(query, 500);
    let existingRows = await ratesService.list({ bookingsOnly: true, limit: 2000 });
    const dedupeStats = await consolidateExistingDuplicates(ratesService, existingRows);
    if (dedupeStats.removed > 0) {
      existingRows = await ratesService.list({ bookingsOnly: true, limit: 2000 });
      log("info", "[DEDUPE] existing_rows_consolidated", dedupeStats);
    }
    const tableName = "extracted_rates";

    let eventsCreated = 0;
    let eventsUpdated = 0;
    let financialExtractedCount = 0;
    let missingDetailsCount = 0;
    let skipped = 0;
    let inserted = 0;
    let skippedExisting = 0;
    let skippedParseFailed = 0;

    for (const message of messages) {
      const existing = await ratesService.getByMessageId(message.id);
      if (!shouldRunAi(existing)) {
        skipped += 1;
        skippedExisting += 1;
        continue;
      }

      const bodyText = message.plainText?.trim().length ? message.plainText : "";
      const normalized = normalizeEmailText(bodyText);
      const threadText = message.threadId
        ? normalizeEmailText(await gmail.fetchThreadPlainText(message.threadId))
        : "";
      const threadMessages = message.threadId ? await gmail.fetchThreadMessages(message.threadId) : [];
      const aiInput = [normalized, threadText].filter(Boolean).join("\n\n--- THREAD ---\n\n");

      const extracted = await extractDirectionsUsaBooking(aiInput || message.plainText, {
        messageId: message.id,
        threadId: message.threadId ?? message.id,
        subject: message.subject || null,
        from: message.fromEmail || null,
        dateReceived: message.date || null,
      });
      if (!extracted) {
        skipped += 1;
        skippedParseFailed += 1;
        continue;
      }

      console.log("[AI EXTRACT]", {
        messageId: message.id,
        rateQuoted: extracted.rateQuoted,
        rateType: extracted.rateType,
        minimumHours: extracted.minimumHours,
        eventDateText: extracted.eventDateText,
        location: extracted.location,
      });

      let calendarStatus: CalendarStatus = "not_requested";
      let googleEventId = existing?.googleEventId ?? null;

      const eventWindow = resolveEventWindow({
        eventDateText: extracted.eventDateText,
        startTimeText: extracted.startTimeText,
        endTimeText: extracted.endTimeText,
        dateReceived: extracted.dateReceived,
        timezone: extracted.timezone,
      });

      if (extracted.isBookingRequest && eventWindow) {
        console.log("[CALENDAR] booking_request_detected", {
          messageId: extracted.messageId,
          threadId: extracted.threadId,
          subject: extracted.subject,
          hasFinancials: extracted.rateQuoted !== null,
        });
        try {
          const calendarResult = await calendar.upsertDirectionsUsaEvent({
            extracted: {
              messageId: extracted.messageId,
              threadId: extracted.threadId,
              subject: extracted.subject,
              title: extracted.title,
              clientOrBrand: extracted.clientOrBrand,
              eventDateText: extracted.eventDateText,
              location: extracted.location ?? existing?.location ?? "TBD",
              rateQuoted: extracted.rateQuoted,
              rateType: extracted.rateType,
              notes: extracted.notes,
              googleEventId,
            },
            subject: extracted.subject,
            threadId: extracted.threadId,
            eventWindow,
          });
          googleEventId = calendarResult.eventId;
          calendarStatus = "on_calendar";
          if (calendarResult.action === "created") {
            eventsCreated += 1;
          } else {
            eventsUpdated += 1;
          }
        } catch (error) {
          if (isInsufficientScopesError(error)) {
            calendarStatus = "needs_auth";
            log("warn", "[CALENDAR] needs_auth", {
              messageId: message.id,
              error: error instanceof Error ? error.message : String(error),
            });
          } else {
            calendarStatus = "needs_details";
            log("warn", "[CALENDAR] upsert_failed", {
              messageId: message.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } else if (extracted.isBookingRequest) {
        calendarStatus = "needs_details";
        missingDetailsCount += 1;
      }

      if (extracted.rateQuoted !== null && (!existing || existing.rateQuoted === null)) {
        financialExtractedCount += 1;
      }

      const requestType = detectRequestType({
        subject: extracted.subject,
        title: extracted.title,
        body: aiInput || message.plainText,
      });
      const ownerDecision = getOwnerResponseDecision(threadMessages, ownerEmail);
      const ownerAwareStatus = applyOwnerResponseToBookingStatus({
        currentStatus: deriveInitialBookingStatus(requestType, {
          subject: extracted.subject,
          body: aiInput || message.plainText,
        }),
        requestType,
        ownerDecision,
      });

      const upsertPayload: UpsertExtractedRateInput = {
        source: "directionsusa",
        messageId: extracted.messageId,
        threadId: extracted.threadId,
        subject: extracted.subject,
        fromEmail: extracted.from,
        dateReceived: extracted.dateReceived,
        isBookingRequest: extracted.isBookingRequest,
        title: extracted.title ?? extracted.subject ?? "Booking request",
        brandOrClient: extracted.clientOrBrand,
        jobType: extracted.jobType,
        eventDateText: extracted.eventDateText,
        startTimeText: extracted.startTimeText,
        endTimeText: extracted.endTimeText,
        timezone: extracted.timezone,
        minimumHours: extracted.minimumHours,
        location: extracted.location ?? "TBD",
        rateQuoted: extracted.rateQuoted,
        currency: extracted.currency,
        rateType: extracted.rateType,
        recordType: shouldMarkAsPartnership({
          subject: extracted.subject,
          body: aiInput || message.plainText,
          eventDateText: extracted.eventDateText,
          title: extracted.title,
          brandOrClient: extracted.clientOrBrand,
        })
          ? "partnership"
          : shouldMarkAsTestShoot({
                subject: extracted.subject,
                body: aiInput || message.plainText,
                title: extracted.title,
                brandOrClient: extracted.clientOrBrand,
              })
            ? "test_shoot"
            : "booking",
        requestType,
        bookingStatus: ownerAwareStatus,
        linkedMessageIds: [extracted.messageId],
        usageTerms: extracted.usageTerms,
        notes:
          ownerDecision === null
            ? extracted.notes
            : [...extracted.notes, `Talent response detected from ${ownerEmail}: ${ownerDecision}`],
        confidence: extracted.confidence,
        financialConfidence: extracted.financialConfidence,
        needsReview: extracted.rateQuoted === null,
        calendarStatus,
        googleEventId,
      };
      const duplicate = findDuplicateCandidate(upsertPayload, existingRows);
      const finalPayload =
        duplicate && duplicate.messageId !== upsertPayload.messageId
          ? mergeWithExisting(duplicate, upsertPayload)
          : upsertPayload;

      console.log("[EXTRACTED_RATES UPSERT] attempt", {
        table: tableName,
        payloadKeys: Object.keys(finalPayload),
        message_id: finalPayload.messageId,
        subject: extracted.subject,
      });
      const saved = await ratesService.upsert(finalPayload);
      console.log("[EXTRACTED_RATES UPSERT] response", {
        data: saved,
        error: null,
      });
      const existingIndex = existingRows.findIndex((item) => item.messageId === saved.messageId);
      if (existingIndex >= 0) {
        existingRows[existingIndex] = saved;
      } else {
        existingRows.push(saved);
      }
      if (!existing && (!duplicate || duplicate.messageId === upsertPayload.messageId)) {
        inserted += 1;
      } else if (duplicate && duplicate.messageId !== upsertPayload.messageId) {
        skipped += 1;
        skippedExisting += 1;
      }
    }

    console.log("[EXTRACTED_RATES SYNC] counters", {
      inserted,
      skipped_existing: skippedExisting,
      skipped_parse_failed: skippedParseFailed,
    });

    return res.json({ eventsCreated, eventsUpdated, financialExtractedCount, missingDetailsCount, skipped });
  });

  return router;
}
