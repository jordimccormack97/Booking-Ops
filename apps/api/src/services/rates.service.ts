import type { DbClient } from "../db/client";

export type CalendarStatus = "not_requested" | "on_calendar" | "needs_auth" | "needs_details";

export type ExtractedRateRecord = {
  id: string;
  source: "directionsusa";
  messageId: string;
  threadId: string | null;
  subject: string | null;
  fromEmail: string | null;
  dateReceived: string | null;
  isBookingRequest: boolean;
  title: string | null;
  brandOrClient: string | null;
  jobType: "shoot" | "fitting" | "travel" | "other" | null;
  eventDateText: string | null;
  startTimeText: string | null;
  endTimeText: string | null;
  timezone: string | null;
  minimumHours: number | null;
  location: string | null;
  rateQuoted: number | null;
  currency: "USD" | null;
  rateType: "half_day" | "full_day" | "hourly" | "flat" | null;
  recordType: "booking" | "partnership" | "test_shoot";
  requestType: "application" | "availability_check" | "booking_confirmation";
  bookingStatus: "request" | "needs_confirmation" | "confirmed" | "follow_up" | "canceled";
  linkedMessageIds: string[];
  usageTerms: string[];
  notes: string[];
  confidence: number;
  financialConfidence: number | null;
  needsReview: boolean;
  calendarStatus: CalendarStatus;
  googleEventId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertExtractedRateInput = Omit<
  ExtractedRateRecord,
  "id" | "createdAt" | "updatedAt" | "recordType" | "requestType" | "bookingStatus" | "linkedMessageIds"
> & {
  recordType?: ExtractedRateRecord["recordType"];
  requestType?: ExtractedRateRecord["requestType"];
  bookingStatus?: ExtractedRateRecord["bookingStatus"];
  linkedMessageIds?: string[];
};

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type ExtractedRateRow = {
  booking_status: ExtractedRateRecord["bookingStatus"];
  brand_or_client: string | null;
  calendar_status: CalendarStatus;
  confidence: number;
  created_at: Date | string;
  currency: "USD" | null;
  date_received: Date | string | null;
  end_time_text: string | null;
  event_date_text: string | null;
  financial_confidence: number | null;
  from_email: string | null;
  google_event_id: string | null;
  id: string;
  is_booking_request: boolean;
  job_type: ExtractedRateRecord["jobType"];
  location: string | null;
  message_id: string;
  minimum_hours: number | null;
  needs_review: boolean;
  notes: unknown;
  record_type: ExtractedRateRecord["recordType"];
  request_type: ExtractedRateRecord["requestType"];
  rate_quoted: number | null;
  rate_type: ExtractedRateRecord["rateType"];
  source: "directionsusa";
  start_time_text: string | null;
  subject: string | null;
  title: string | null;
  thread_id: string | null;
  linked_message_ids: unknown;
  timezone: string | null;
  updated_at: Date | string;
  usage_terms: unknown;
};

function toRecord(row: ExtractedRateRow): ExtractedRateRecord {
  return {
    id: row.id,
    source: "directionsusa",
    messageId: row.message_id,
    threadId: row.thread_id,
    subject: row.subject,
    fromEmail: row.from_email,
    dateReceived: toIsoOrNull(row.date_received),
    isBookingRequest: row.is_booking_request,
    title: row.title,
    brandOrClient: row.brand_or_client,
    jobType: row.job_type,
    eventDateText: row.event_date_text,
    startTimeText: row.start_time_text,
    endTimeText: row.end_time_text,
    timezone: row.timezone,
    minimumHours: toNumberOrNull(row.minimum_hours),
    location: row.location,
    rateQuoted: toNumberOrNull(row.rate_quoted),
    currency: row.currency,
    rateType: row.rate_type,
    recordType: row.record_type ?? "booking",
    requestType: row.request_type ?? "availability_check",
    bookingStatus: row.booking_status ?? "request",
    linkedMessageIds: parseJsonArray(row.linked_message_ids),
    usageTerms: parseJsonArray(row.usage_terms),
    notes: parseJsonArray(row.notes),
    confidence: Number(row.confidence ?? 0),
    financialConfidence: toNumberOrNull(row.financial_confidence),
    needsReview: row.needs_review,
    calendarStatus: row.calendar_status ?? "not_requested",
    googleEventId: row.google_event_id,
    createdAt: toIsoOrNull(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIsoOrNull(row.updated_at) ?? new Date(0).toISOString(),
  };
}

export class RatesService {
  constructor(private readonly db: DbClient) {}

  private async ensureReady() {
    await this.db.ready;
  }

  async getByMessageId(messageId: string): Promise<ExtractedRateRecord | null> {
    await this.ensureReady();
    const result = await this.db.query<ExtractedRateRow>(
      "select * from public.extracted_rates where message_id = $1",
      [messageId],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async getById(id: string): Promise<ExtractedRateRecord | null> {
    await this.ensureReady();
    const result = await this.db.query<ExtractedRateRow>(
      "select * from public.extracted_rates where id = $1",
      [id],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async upsert(input: UpsertExtractedRateInput): Promise<ExtractedRateRecord> {
    await this.ensureReady();
    const result = await this.db.query<ExtractedRateRow>(
      `insert into public.extracted_rates
        (source, message_id, thread_id, subject, from_email, date_received, is_booking_request, title, client_or_brand, job_type, event_date_text, start_time_text, end_time_text, timezone, minimum_hours, location, rate_quoted, currency, rate_type, record_type, request_type, booking_status, linked_message_ids, usage_terms, notes, confidence, financial_confidence, needs_review, calendar_status, google_event_id)
       values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb, $24::jsonb, $25::jsonb, $26, $27, $28, $29, $30)
       on conflict(message_id) do update set
        thread_id = excluded.thread_id,
        subject = excluded.subject,
        from_email = excluded.from_email,
        date_received = excluded.date_received,
        is_booking_request = excluded.is_booking_request,
        title = excluded.title,
        client_or_brand = excluded.client_or_brand,
        job_type = excluded.job_type,
        event_date_text = excluded.event_date_text,
        start_time_text = excluded.start_time_text,
        end_time_text = excluded.end_time_text,
        timezone = excluded.timezone,
        minimum_hours = excluded.minimum_hours,
        location = excluded.location,
        rate_quoted = excluded.rate_quoted,
        currency = excluded.currency,
        rate_type = excluded.rate_type,
        record_type = excluded.record_type,
        request_type = excluded.request_type,
        booking_status = excluded.booking_status,
        linked_message_ids = excluded.linked_message_ids,
        usage_terms = excluded.usage_terms,
        notes = excluded.notes,
        confidence = excluded.confidence,
        financial_confidence = excluded.financial_confidence,
        needs_review = excluded.needs_review,
        calendar_status = excluded.calendar_status,
        google_event_id = excluded.google_event_id
       returning *`,
      [
        input.source,
        input.messageId,
        input.threadId,
        input.subject,
        input.fromEmail,
        input.dateReceived,
        input.isBookingRequest,
        input.title,
        input.brandOrClient,
        input.jobType,
        input.eventDateText,
        input.startTimeText,
        input.endTimeText,
        input.timezone,
        input.minimumHours,
        input.location,
        input.rateQuoted,
        input.currency,
        input.rateType,
        input.recordType ?? "booking",
        input.requestType ?? "availability_check",
        input.bookingStatus ?? (input.isBookingRequest ? "needs_confirmation" : "request"),
        JSON.stringify(input.linkedMessageIds ?? [input.messageId]),
        JSON.stringify(input.usageTerms ?? []),
        JSON.stringify(input.notes ?? []),
        input.confidence,
        input.financialConfidence,
        input.needsReview,
        input.calendarStatus,
        input.googleEventId,
      ],
    );
    const record = result.rows[0] ? toRecord(result.rows[0]) : null;
    if (!record) throw new Error("Failed to load upserted extracted rate");
    return record;
  }

  async deleteById(id: string): Promise<boolean> {
    await this.ensureReady();
    const result = await this.db.query<{ id: string }>(
      "delete from public.extracted_rates where id = $1 returning id",
      [id],
    );
    return Number(result.rowCount ?? 0) > 0;
  }

  async list(filters?: {
    domain?: string;
    needsReview?: boolean;
    dateFrom?: string;
    dateTo?: string;
    bookingsOnly?: boolean;
    recordType?: "booking" | "partnership" | "test_shoot";
    limit?: number;
  }): Promise<ExtractedRateRecord[]> {
    await this.ensureReady();
    const where: string[] = [];
    const args: unknown[] = [];
    if (filters?.domain) {
      where.push(`lower(from_email) like $${args.length + 1}`);
      args.push(`%@${filters.domain.toLowerCase().replace(/^@/, "")}`);
    }
    if (typeof filters?.needsReview === "boolean") {
      where.push(`needs_review = $${args.length + 1}`);
      args.push(filters.needsReview);
    }
    if (typeof filters?.bookingsOnly === "boolean") {
      where.push(`is_booking_request = $${args.length + 1}`);
      args.push(filters.bookingsOnly);
    }
    if (filters?.recordType) {
      where.push(`record_type = $${args.length + 1}`);
      args.push(filters.recordType);
    }
    if (filters?.dateFrom) {
      where.push(`date_received >= $${args.length + 1}::timestamptz`);
      args.push(filters.dateFrom);
    }
    if (filters?.dateTo) {
      where.push(`date_received <= $${args.length + 1}::timestamptz`);
      args.push(filters.dateTo);
    }

    const limit = filters?.limit && Number.isFinite(filters.limit) ? Math.max(1, filters.limit) : 100;
    args.push(limit);
    const sql = `select * from public.extracted_rates ${
      where.length > 0 ? `where ${where.join(" and ")}` : ""
    } order by date_received desc nulls last, updated_at desc limit $${args.length}`;
    const result = await this.db.query<ExtractedRateRow>(sql, args);
    return result.rows.map(toRecord);
  }
}
