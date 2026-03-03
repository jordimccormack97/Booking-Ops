import { Router } from "express";
import { randomUUID } from "node:crypto";
import { BookingExpensesService } from "../services/booking-expenses.service";
import { BookingService } from "../services/booking.service";
import { type ExtractedRateRecord, type UpsertExtractedRateInput, RatesService } from "../services/rates.service";

const BOOKING_STATUSES = ["request", "needs_confirmation", "confirmed", "follow_up", "canceled"] as const;
const REQUEST_TYPES = ["application", "availability_check", "booking_confirmation"] as const;

function mergeUniqueStrings(a: string[], b: string[]) {
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function parseDateRangeToken(value: string | null | undefined): { start: string; end: string } | null {
  if (!value) return null;
  const text = value.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
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
  const monthRange = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})\s*(?:-|to|through|thru)\s*(\d{1,2})\b/,
  );
  if (monthRange) {
    const month = monthMap[monthRange[1]];
    const startDay = monthRange[2].padStart(2, "0");
    const endDay = monthRange[3].padStart(2, "0");
    const start = `${month}-${startDay}`;
    const end = `${month}-${endDay}`;
    return start <= end ? { start, end } : { start: end, end: start };
  }

  const slashRange = text.match(/\b(\d{1,2})\/(\d{1,2})\s*(?:-|to|through|thru)\s*(\d{1,2})\b/);
  if (slashRange) {
    const month = slashRange[1].padStart(2, "0");
    const startDay = slashRange[2].padStart(2, "0");
    const endDay = slashRange[3].padStart(2, "0");
    const start = `${month}-${startDay}`;
    const end = `${month}-${endDay}`;
    return start <= end ? { start, end } : { start: end, end: start };
  }

  return null;
}

function tokenToOrdinal(token: string): number | null {
  const match = token.match(/^(\d{2})-(\d{2})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const millis = Date.UTC(2001, month - 1, day);
  if (Number.isNaN(millis)) return null;
  return Math.floor(millis / (24 * 60 * 60 * 1000));
}

function tokenWithinRange(token: string, start: string, end: string): boolean {
  const value = tokenToOrdinal(token);
  const startValue = tokenToOrdinal(start);
  const endValue = tokenToOrdinal(end);
  if (value === null || startValue === null || endValue === null) return false;
  return value >= startValue && value <= endValue;
}

function bookingDisplayLabel(row: ExtractedRateRecord) {
  return normalizeText(row.brandOrClient ?? row.title ?? row.subject ?? "");
}

function hasScheduleSignals(row: ExtractedRateRecord) {
  const hasDate = Boolean(parseDateToken(row.eventDateText ?? row.subject ?? null));
  const hasTime = Boolean((row.startTimeText ?? "").trim() || (row.endTimeText ?? "").trim());
  const hasLocation = normalizeText(row.location) !== "" && normalizeText(row.location) !== "tbd";
  return hasDate || hasTime || hasLocation;
}

function isNonBookingAnnouncement(row: ExtractedRateRecord) {
  const combined = normalizeText(`${row.subject ?? ""} ${row.title ?? ""} ${row.brandOrClient ?? ""}`);
  if (combined.includes("introducing new local model")) return true;
  if (combined.includes("paper store") && !hasScheduleSignals(row)) return true;
  const hasIntentSignals =
    /\b(apply|application|audition|casting|availability|confirm|confirmed|book|booking|shoot|fitting|travel)\b/i.test(
      `${row.subject ?? ""}\n${row.title ?? ""}\n${row.brandOrClient ?? ""}`,
    );
  if (hasIntentSignals) return false;
  return !hasScheduleSignals(row);
}

function dedupeKey(row: ExtractedRateRecord): string | null {
  if (row.recordType === "partnership") {
    const label = bookingDisplayLabel(row);
    if (!label) return null;
    return `partnership|${label}`;
  }
  if (row.recordType !== "booking") return null;
  const label = bookingDisplayLabel(row);
  if (!label) return null;
  const threadLabel = normalizeText(row.threadId);
  if (threadLabel) {
    return `booking-thread|${threadLabel}|${label}`;
  }
  const dateKey = parseDateToken(row.eventDateText ?? row.subject ?? row.dateReceived ?? null);
  if (!dateKey) return null;
  const location = normalizeText(row.location);
  const locationKey = location && location !== "tbd" ? location : row.requestType === "application" ? "unknown" : "";
  if (!locationKey) return null;
  return `${dateKey}|${locationKey}|${label}`;
}

function bookingScore(row: ExtractedRateRecord) {
  let score = 0;
  if (row.rateQuoted !== null) score += 5;
  if (row.eventDateText) score += 2;
  if (row.location && normalizeText(row.location) !== "tbd") score += 2;
  if (row.requestType === "booking_confirmation") score += 1;
  const updated = Date.parse(row.updatedAt);
  if (!Number.isNaN(updated)) score += updated / 1e13;
  return score;
}

function dedupeRows(rows: ExtractedRateRecord[]) {
  const byKey = new Map<string, ExtractedRateRecord>();
  const passthrough: ExtractedRateRecord[] = [];
  for (const row of rows) {
    const key = dedupeKey(row);
    if (!key) {
      passthrough.push(row);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing || bookingScore(row) > bookingScore(existing)) {
      byKey.set(key, row);
    }
  }
  const deduped = [...passthrough, ...byKey.values()];
  return deduped.filter((row) => {
    if (row.recordType !== "booking") return true;
    const range = parseDateRangeToken(row.eventDateText ?? row.subject ?? null);
    if (!range) return true;

    const rowLabel = bookingDisplayLabel(row);
    if (!rowLabel) return true;
    const rowLocation = normalizeText(row.location);

    const hasCoveredConfirmedDate = deduped.some((candidate) => {
      if (candidate.id === row.id) return false;
      if (candidate.recordType !== "booking") return false;
      if (candidate.bookingStatus !== "confirmed") return false;
      if (bookingDisplayLabel(candidate) !== rowLabel) return false;

      const candidateRange = parseDateRangeToken(candidate.eventDateText ?? candidate.subject ?? null);
      if (candidateRange) return false;
      const candidateDate = parseDateToken(candidate.eventDateText ?? candidate.subject ?? candidate.dateReceived ?? null);
      if (!candidateDate) return false;

      const candidateLocation = normalizeText(candidate.location);
      const locationMatches =
        rowLocation === "" ||
        rowLocation === "tbd" ||
        candidateLocation === "" ||
        candidateLocation === "tbd" ||
        rowLocation === candidateLocation;
      if (!locationMatches) return false;

      return tokenWithinRange(candidateDate, range.start, range.end);
    });

    return !hasCoveredConfirmedDate;
  });
}

function withAddedNote(notes: string[], note: string) {
  if (notes.includes(note)) return notes;
  return [...notes, note];
}

function applyBusinessOverrides(row: ExtractedRateRecord): ExtractedRateRecord {
  const label = bookingDisplayLabel(row);
  const dateToken = parseDateToken(row.eventDateText ?? row.subject ?? row.dateReceived ?? null);

  if (label.includes("iqvia") && dateToken === "01-21") {
    return {
      ...row,
      bookingStatus: "canceled",
      notes: withAddedNote(row.notes ?? [], "Manual rule: IQVIA 1/21 marked as denied availability"),
    };
  }

  if (label.includes("delta thc")) {
    return {
      ...row,
      bookingStatus: "canceled",
      notes: withAddedNote(row.notes ?? [], "Manual rule: Delta THC marked as denied availability"),
    };
  }

  if (label.includes("belk")) {
    return {
      ...row,
      recordType: "partnership",
      bookingStatus: "confirmed",
      requestType: "application",
      notes: withAddedNote(row.notes ?? [], "Manual rule: belk.com confirmed partnership (applied)"),
    };
  }

  if (label.includes("athletic client casting") || label.includes("athletic clients casting")) {
    const nextStatus =
      row.bookingStatus === "confirmed" || row.bookingStatus === "canceled" ? row.bookingStatus : "follow_up";
    return {
      ...row,
      recordType: "partnership",
      requestType: "application",
      bookingStatus: nextStatus,
      notes: withAddedNote(row.notes ?? [], "Manual rule: Athletic Client Casting application submitted (photos sent)"),
    };
  }

  return row;
}

function shouldSuppressIqviaRangeRow(row: ExtractedRateRecord, allRows: ExtractedRateRecord[]) {
  const label = bookingDisplayLabel(row);
  if (!label.includes("iqvia")) return false;

  const range = parseDateRangeToken(row.eventDateText ?? row.subject ?? null);
  if (!range) return false;

  const start = tokenToOrdinal(range.start);
  const end = tokenToOrdinal(range.end);
  const march7 = tokenToOrdinal("03-07");
  if (start === null || end === null || march7 === null) return false;
  if (march7 < start || march7 > end) return false;

  return allRows.some((candidate) => {
    if (candidate.id === row.id) return false;
    if (candidate.bookingStatus !== "confirmed") return false;
    const candidateLabel = bookingDisplayLabel(candidate);
    if (!candidateLabel.includes("iqvia")) return false;
    const candidateDate = parseDateToken(candidate.eventDateText ?? candidate.subject ?? candidate.dateReceived ?? null);
    return candidateDate === "03-07";
  });
}

function preferStatus(
  target: ExtractedRateRecord["bookingStatus"],
  source: ExtractedRateRecord["bookingStatus"],
): ExtractedRateRecord["bookingStatus"] {
  const rank = {
    request: 0,
    needs_confirmation: 1,
    follow_up: 2,
    confirmed: 3,
    canceled: 4,
  } as const;
  return rank[source] > rank[target] ? source : target;
}

function mergeBookingRows(
  target: ExtractedRateRecord,
  source: ExtractedRateRecord,
): UpsertExtractedRateInput {
  const rateQuoted = target.rateQuoted ?? source.rateQuoted;

  return {
    source: "directionsusa",
    messageId: target.messageId,
    threadId: target.threadId ?? source.threadId,
    subject: target.subject ?? source.subject,
    fromEmail: target.fromEmail ?? source.fromEmail,
    dateReceived: target.dateReceived ?? source.dateReceived,
    isBookingRequest: target.isBookingRequest || source.isBookingRequest,
    title: target.title ?? source.title,
    brandOrClient: target.brandOrClient ?? source.brandOrClient,
    jobType: target.jobType ?? source.jobType,
    eventDateText: target.eventDateText ?? source.eventDateText,
    startTimeText: target.startTimeText ?? source.startTimeText,
    endTimeText: target.endTimeText ?? source.endTimeText,
    timezone: target.timezone ?? source.timezone,
    minimumHours: target.minimumHours ?? source.minimumHours,
    location: target.location ?? source.location,
    rateQuoted,
    currency: rateQuoted === null ? null : target.currency ?? source.currency,
    rateType: rateQuoted === null ? null : target.rateType ?? source.rateType,
    recordType: target.recordType,
    requestType: target.requestType,
    bookingStatus: preferStatus(target.bookingStatus, source.bookingStatus),
    linkedMessageIds: mergeUniqueStrings(target.linkedMessageIds, source.linkedMessageIds),
    usageTerms: mergeUniqueStrings(target.usageTerms, source.usageTerms),
    notes: mergeUniqueStrings(target.notes, source.notes),
    confidence: Math.max(target.confidence ?? 0, source.confidence ?? 0),
    financialConfidence:
      target.financialConfidence !== null && target.financialConfidence !== undefined
        ? target.financialConfidence
        : source.financialConfidence,
    needsReview: target.needsReview && source.needsReview,
    calendarStatus: target.calendarStatus === "on_calendar" ? target.calendarStatus : source.calendarStatus,
    googleEventId: target.googleEventId ?? source.googleEventId,
  };
}

/**
 * Creates booking query routes.
 */
export function createBookingsRouter(
  _bookingService: BookingService,
  ratesService?: RatesService,
  bookingExpensesService?: BookingExpensesService,
) {
  const router = Router();

  if (!ratesService) {
    throw new Error("RatesService is required for bookings router");
  }
  if (!bookingExpensesService) {
    throw new Error("BookingExpensesService is required for bookings router");
  }

  router.get("/", async (req, res) => {
    const includeAllRaw = String(req.query?.includeAll ?? "").trim().toLowerCase();
    const includeAll = includeAllRaw === "1" || includeAllRaw === "true" || includeAllRaw === "yes";
    const rows = includeAll
      ? await ratesService.list({ limit: 500 })
      : await ratesService.list({ limit: 200, recordType: "booking" });
    const filtered = rows.filter((row) => row.recordType !== "booking" || !isNonBookingAnnouncement(row));
    const overridden = filtered.map((row) => applyBusinessOverrides(row));
    const deduped = dedupeRows(overridden);
    const finalRows = deduped.filter((row) => !shouldSuppressIqviaRangeRow(row, deduped));
    return res.json(finalRows);
  });

  router.post("/merge", async (req, res) => {
    const sourceId = typeof req.body?.sourceId === "string" ? req.body.sourceId.trim() : "";
    const targetId = typeof req.body?.targetId === "string" ? req.body.targetId.trim() : "";
    if (!sourceId || !targetId) return res.status(400).json({ error: "sourceId and targetId are required" });
    if (sourceId === targetId) return res.status(400).json({ error: "Cannot merge a row into itself" });

    const [source, target] = await Promise.all([ratesService.getById(sourceId), ratesService.getById(targetId)]);
    if (!source) return res.status(404).json({ error: "Source booking not found" });
    if (!target) return res.status(404).json({ error: "Target booking not found" });

    const merged = mergeBookingRows(target, source);
    const saved = await ratesService.upsert(merged);
    await ratesService.deleteById(sourceId);

    return res.json({
      merged: true,
      removedBookingId: sourceId,
      targetBookingId: targetId,
      booking: saved,
    });
  });

  router.get("/:id", async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: "Missing booking row id" });

    const booking = await ratesService.getById(id);
    if (!booking) return res.status(404).json({ error: "Booking row not found" });
    return res.json(booking);
  });

  router.delete("/:id", async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) {
      return res.status(400).json({ error: "Missing booking row id" });
    }

    const deleted = await ratesService.deleteById(id);
    if (!deleted) {
      return res.status(404).json({ error: "Booking row not found" });
    }

    return res.json({ deleted: true, id });
  });

  router.patch("/:id/status", async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: "Missing booking row id" });

    const booking = await ratesService.getById(id);
    if (!booking) return res.status(404).json({ error: "Booking row not found" });

    const status = typeof req.body?.bookingStatus === "string" ? req.body.bookingStatus.trim() : "";
    if (!BOOKING_STATUSES.includes(status as (typeof BOOKING_STATUSES)[number])) {
      return res.status(400).json({ error: "Invalid bookingStatus value" });
    }

    const updated = await ratesService.upsert({
      source: "directionsusa",
      messageId: booking.messageId,
      threadId: booking.threadId,
      subject: booking.subject,
      fromEmail: booking.fromEmail,
      dateReceived: booking.dateReceived,
      isBookingRequest: booking.isBookingRequest,
      title: booking.title,
      brandOrClient: booking.brandOrClient,
      jobType: booking.jobType,
      eventDateText: booking.eventDateText,
      startTimeText: booking.startTimeText,
      endTimeText: booking.endTimeText,
      timezone: booking.timezone,
      minimumHours: booking.minimumHours,
      location: booking.location,
      rateQuoted: booking.rateQuoted,
      currency: booking.currency,
      rateType: booking.rateType,
      recordType: booking.recordType,
      requestType: booking.requestType,
      bookingStatus: status as UpsertExtractedRateInput["bookingStatus"],
      linkedMessageIds: booking.linkedMessageIds,
      usageTerms: booking.usageTerms,
      notes: booking.notes,
      confidence: booking.confidence,
      financialConfidence: booking.financialConfidence,
      needsReview: booking.needsReview,
      calendarStatus: booking.calendarStatus,
      googleEventId: booking.googleEventId,
    });

    return res.json({ booking: updated });
  });

  router.patch("/:id/type", async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: "Missing booking row id" });

    const booking = await ratesService.getById(id);
    if (!booking) return res.status(404).json({ error: "Booking row not found" });

    const recordType = typeof req.body?.recordType === "string" ? req.body.recordType.trim() : "";
    if (recordType !== "booking" && recordType !== "partnership" && recordType !== "test_shoot") {
      return res.status(400).json({ error: "Invalid recordType value" });
    }

    const updated = await ratesService.upsert({
      source: "directionsusa",
      messageId: booking.messageId,
      threadId: booking.threadId,
      subject: booking.subject,
      fromEmail: booking.fromEmail,
      dateReceived: booking.dateReceived,
      isBookingRequest: booking.isBookingRequest,
      title: booking.title,
      brandOrClient: booking.brandOrClient,
      jobType: booking.jobType,
      eventDateText: booking.eventDateText,
      startTimeText: booking.startTimeText,
      endTimeText: booking.endTimeText,
      timezone: booking.timezone,
      minimumHours: booking.minimumHours,
      location: booking.location,
      rateQuoted: booking.rateQuoted,
      currency: booking.currency,
      rateType: booking.rateType,
      recordType,
      requestType: booking.requestType,
      bookingStatus: booking.bookingStatus,
      linkedMessageIds: booking.linkedMessageIds,
      usageTerms: booking.usageTerms,
      notes: booking.notes,
      confidence: booking.confidence,
      financialConfidence: booking.financialConfidence,
      needsReview: booking.needsReview,
      calendarStatus: booking.calendarStatus,
      googleEventId: booking.googleEventId,
    });

    return res.json({ booking: updated });
  });

  router.patch("/:id/request-type", async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: "Missing booking row id" });

    const booking = await ratesService.getById(id);
    if (!booking) return res.status(404).json({ error: "Booking row not found" });

    const requestType = typeof req.body?.requestType === "string" ? req.body.requestType.trim() : "";
    if (!REQUEST_TYPES.includes(requestType as (typeof REQUEST_TYPES)[number])) {
      return res.status(400).json({ error: "Invalid requestType value" });
    }

    const updated = await ratesService.upsert({
      source: "directionsusa",
      messageId: booking.messageId,
      threadId: booking.threadId,
      subject: booking.subject,
      fromEmail: booking.fromEmail,
      dateReceived: booking.dateReceived,
      isBookingRequest: booking.isBookingRequest,
      title: booking.title,
      brandOrClient: booking.brandOrClient,
      jobType: booking.jobType,
      eventDateText: booking.eventDateText,
      startTimeText: booking.startTimeText,
      endTimeText: booking.endTimeText,
      timezone: booking.timezone,
      minimumHours: booking.minimumHours,
      location: booking.location,
      rateQuoted: booking.rateQuoted,
      currency: booking.currency,
      rateType: booking.rateType,
      recordType: booking.recordType,
      requestType: requestType as UpsertExtractedRateInput["requestType"],
      bookingStatus: booking.bookingStatus,
      linkedMessageIds: booking.linkedMessageIds,
      usageTerms: booking.usageTerms,
      notes: booking.notes,
      confidence: booking.confidence,
      financialConfidence: booking.financialConfidence,
      needsReview: booking.needsReview,
      calendarStatus: booking.calendarStatus,
      googleEventId: booking.googleEventId,
    });

    return res.json({ booking: updated });
  });

  router.get("/:id/expenses", async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: "Missing booking row id" });

    const booking = await ratesService.getById(id);
    if (!booking) return res.status(404).json({ error: "Booking row not found" });

    const [expenses, audit] = await Promise.all([
      bookingExpensesService.listByBookingId(id),
      bookingExpensesService.listAuditByBookingId(id, 200),
    ]);
    return res.json({ expenses, audit });
  });

  router.post("/:id/expenses", async (req, res) => {
    const id = req.params.id?.trim();
    if (!id) return res.status(400).json({ error: "Missing booking row id" });

    const booking = await ratesService.getById(id);
    if (!booking) return res.status(404).json({ error: "Booking row not found" });

    const body = req.body as Record<string, unknown>;
    const expenseDate = typeof body.expenseDate === "string" ? body.expenseDate.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
    if (!expenseDate) return res.status(400).json({ error: "expenseDate is required" });
    if (!category) return res.status(400).json({ error: "category is required" });
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: "amount must be a valid non-negative number" });
    }

    const created = await bookingExpensesService.create(
      id,
      {
        expenseDate,
        category,
        amount,
        currency: "USD",
        vendor: typeof body.vendor === "string" && body.vendor.trim().length > 0 ? body.vendor.trim() : null,
        notes: typeof body.notes === "string" && body.notes.trim().length > 0 ? body.notes.trim() : null,
        receiptUrl:
          typeof body.receiptUrl === "string" && body.receiptUrl.trim().length > 0
            ? body.receiptUrl.trim()
            : null,
      },
      typeof body.performedBy === "string" ? body.performedBy : null,
    );
    return res.status(201).json({ expense: created });
  });

  router.delete("/:id/expenses/:expenseId", async (req, res) => {
    const id = req.params.id?.trim();
    const expenseId = req.params.expenseId?.trim();
    if (!id || !expenseId) return res.status(400).json({ error: "Missing booking or expense id" });

    const deleted = await bookingExpensesService.delete(id, expenseId);
    if (!deleted) return res.status(404).json({ error: "Expense not found" });
    return res.json({ deleted: true, expenseId });
  });

  // Debug endpoint to insert test rows (only for development)
  router.post("/test-insert", async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "Not available in production" });
    }

    const input = req.body as Record<string, unknown>;
    const messageId =
      typeof input.messageId === "string" && input.messageId.trim().length > 0
        ? input.messageId
        : randomUUID();
    const dateReceived =
      typeof input.dateReceived === "string" && input.dateReceived.trim().length > 0
        ? input.dateReceived
        : new Date().toISOString();

    const payload: UpsertExtractedRateInput = {
      source: "directionsusa",
      messageId,
      threadId: typeof input.threadId === "string" ? input.threadId : messageId,
      subject: typeof input.subject === "string" ? input.subject : "Test booking row",
      fromEmail: typeof input.fromEmail === "string" ? input.fromEmail : "test@example.com",
      dateReceived,
      isBookingRequest: Boolean(input.isBookingRequest ?? true),
      title: typeof input.title === "string" ? input.title : "Test booking row",
      brandOrClient: typeof input.brandOrClient === "string" ? input.brandOrClient : "Test Client",
      jobType: null,
      eventDateText: typeof input.eventDateText === "string" ? input.eventDateText : null,
      startTimeText: typeof input.startTimeText === "string" ? input.startTimeText : null,
      endTimeText: typeof input.endTimeText === "string" ? input.endTimeText : null,
      timezone: typeof input.timezone === "string" ? input.timezone : "America/New_York",
      minimumHours: typeof input.minimumHours === "number" ? input.minimumHours : null,
      location: typeof input.location === "string" ? input.location : "TBD",
      rateQuoted: typeof input.rateQuoted === "number" ? input.rateQuoted : null,
      currency: typeof input.currency === "string" && input.currency === "USD" ? "USD" : null,
      rateType:
        typeof input.rateType === "string" &&
        ["half_day", "full_day", "hourly", "flat"].includes(input.rateType)
          ? (input.rateType as "half_day" | "full_day" | "hourly" | "flat")
          : null,
      recordType:
        typeof input.recordType === "string" && ["booking", "partnership", "test_shoot"].includes(input.recordType)
          ? (input.recordType as UpsertExtractedRateInput["recordType"])
          : "booking",
      requestType:
        typeof input.requestType === "string" &&
        ["application", "availability_check", "booking_confirmation"].includes(input.requestType)
          ? (input.requestType as UpsertExtractedRateInput["requestType"])
          : "availability_check",
      bookingStatus:
        typeof input.bookingStatus === "string" &&
        BOOKING_STATUSES.includes(input.bookingStatus as (typeof BOOKING_STATUSES)[number])
          ? (input.bookingStatus as UpsertExtractedRateInput["bookingStatus"])
          : (Boolean(input.isBookingRequest ?? true) ? "needs_confirmation" : "request"),
      linkedMessageIds: [messageId],
      usageTerms: Array.isArray(input.usageTerms)
        ? input.usageTerms.filter((value): value is string => typeof value === "string")
        : [],
      notes: Array.isArray(input.notes)
        ? input.notes.filter((value): value is string => typeof value === "string")
        : [],
      confidence: typeof input.confidence === "number" ? input.confidence : 0,
      financialConfidence: typeof input.financialConfidence === "number" ? input.financialConfidence : null,
      needsReview: Boolean(input.needsReview ?? true),
      calendarStatus:
        typeof input.calendarStatus === "string" &&
        ["not_requested", "on_calendar", "needs_auth", "needs_details"].includes(input.calendarStatus)
          ? (input.calendarStatus as "not_requested" | "on_calendar" | "needs_auth" | "needs_details")
          : "not_requested",
      googleEventId: typeof input.googleEventId === "string" ? input.googleEventId : null,
    };

    const inserted = await ratesService.upsert(payload);
    return res.json({ inserted });
  });

  return router;
}
