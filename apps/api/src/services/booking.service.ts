import type { DbClient } from "../db/client";
import type { BookingRecord, BookingStatus, CreateBookingInput } from "../types/booking";

type BookingRow = {
  agency_email: string;
  approval_token: string;
  calendar_event_id: string | null;
  created_at: Date | string;
  duration: string | null;
  end_at: string;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  id: string;
  location: string;
  rate_quoted: number;
  start_at: string;
  status: BookingStatus;
  title: string;
};

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toBooking(row: BookingRow): BookingRecord {
  return {
    id: row.id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    location: row.location,
    duration: row.duration,
    rateQuoted: Number(row.rate_quoted),
    agencyEmail: row.agency_email,
    status: row.status,
    approvalToken: row.approval_token,
    calendarEventId: row.calendar_event_id,
    gmailMessageId: row.gmail_message_id,
    gmailThreadId: row.gmail_thread_id,
    createdAt: toIsoString(row.created_at),
  };
}

/**
 * Booking persistence service for Postgres.
 */
export class BookingService {
  constructor(private readonly db: DbClient) {}

  private async ensureReady() {
    await this.db.ready;
  }

  /** Creates a booking record. */
  async create(input: CreateBookingInput): Promise<BookingRecord> {
    await this.ensureReady();
    await this.db.query(
      `insert into public.bookings
        (id, title, start_at, end_at, location, duration, rate_quoted, agency_email, status, approval_token, calendar_event_id, gmail_message_id, gmail_thread_id)
       values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        input.id,
        input.title,
        input.startAt,
        input.endAt,
        input.location,
        input.duration,
        input.rateQuoted,
        input.agencyEmail,
        input.status,
        input.approvalToken,
        input.calendarEventId,
        input.gmailMessageId,
        input.gmailThreadId,
      ],
    );

    const created = await this.getById(input.id);
    if (!created) throw new Error("Failed to load inserted booking");
    return created;
  }

  /** Lists all bookings newest first. */
  async list(): Promise<BookingRecord[]> {
    await this.ensureReady();
    const result = await this.db.query<BookingRow>(
      "select * from public.bookings order by created_at desc",
    );
    return result.rows.map(toBooking);
  }

  /** Fetches booking by id. */
  async getById(id: string): Promise<BookingRecord | null> {
    await this.ensureReady();
    const result = await this.db.query<BookingRow>(
      "select * from public.bookings where id = $1",
      [id],
    );
    const row = result.rows[0];
    return row ? toBooking(row) : null;
  }

  /** Fetches booking by approval token. */
  async getByApprovalToken(token: string): Promise<BookingRecord | null> {
    await this.ensureReady();
    const result = await this.db.query<BookingRow>(
      "select * from public.bookings where approval_token = $1",
      [token],
    );
    const row = result.rows[0];
    return row ? toBooking(row) : null;
  }

  /** Fetches booking by imported Gmail message id. */
  async getByGmailMessageId(messageId: string): Promise<BookingRecord | null> {
    await this.ensureReady();
    const result = await this.db.query<BookingRow>(
      "select * from public.bookings where gmail_message_id = $1",
      [messageId],
    );
    const row = result.rows[0];
    return row ? toBooking(row) : null;
  }

  /** Fetches bookings by Gmail thread id. */
  async getByGmailThreadId(threadId: string): Promise<BookingRecord[]> {
    await this.ensureReady();
    const result = await this.db.query<BookingRow>(
      "select * from public.bookings where gmail_thread_id = $1 order by created_at desc",
      [threadId],
    );
    return result.rows.map(toBooking);
  }

  /** Updates status and optional calendar event id. */
  async updateStatus(
    id: string,
    status: BookingStatus,
    calendarEventId: string | null,
  ): Promise<BookingRecord> {
    await this.ensureReady();
    const result = await this.db.query<BookingRow>(
      "update public.bookings set status = $1, calendar_event_id = $2 where id = $3 returning *",
      [status, calendarEventId, id],
    );
    const updated = result.rows[0];
    if (!updated) throw new Error("Booking not found after update");
    return toBooking(updated);
  }

  /** Updates booking financial fields extracted from sync pipeline enrichment. */
  async updateRateDetails(id: string, rateQuoted: number, duration: string | null): Promise<BookingRecord> {
    await this.ensureReady();
    const result = await this.db.query<BookingRow>(
      "update public.bookings set rate_quoted = $1, duration = coalesce($2, duration) where id = $3 returning *",
      [rateQuoted, duration, id],
    );
    const updated = result.rows[0];
    if (!updated) throw new Error("Booking not found after financial update");
    return toBooking(updated);
  }
}
