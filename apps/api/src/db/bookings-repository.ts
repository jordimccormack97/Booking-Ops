import type { Database } from "bun:sqlite";
import type { BookingRecord, BookingStatus, CreateBookingInput } from "../types/booking";

function toBooking(row: Record<string, unknown>): BookingRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    startAt: String(row.startAt),
    endAt: String(row.endAt),
    location: String(row.location),
    rateQuoted: Number(row.rateQuoted),
    agencyEmail: String(row.agencyEmail),
    status: row.status as BookingStatus,
    approvalToken: String(row.approvalToken),
    calendarEventId: row.calendarEventId ? String(row.calendarEventId) : null,
    createdAt: String(row.createdAt),
  };
}

/**
 * Persists and queries booking workflow records from SQLite.
 */
export class BookingsRepository {
  constructor(private readonly db: Database) {}

  /** Inserts a booking row and returns the stored record. */
  create(input: CreateBookingInput): BookingRecord {
    this.db
      .prepare(
        `insert into bookings
          (id, title, startAt, endAt, location, rateQuoted, agencyEmail, status, approvalToken, calendarEventId)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.title,
        input.startAt,
        input.endAt,
        input.location,
        input.rateQuoted,
        input.agencyEmail,
        input.status,
        input.approvalToken,
        input.calendarEventId,
      );

    const record = this.getById(input.id);
    if (!record) throw new Error("Failed to load inserted booking");
    return record;
  }

  /** Returns all bookings ordered by creation time descending. */
  list(): BookingRecord[] {
    const rows = this.db
      .prepare("select * from bookings order by datetime(createdAt) desc")
      .all() as Record<string, unknown>[];
    return rows.map(toBooking);
  }

  /** Looks up a booking by primary id. */
  getById(id: string): BookingRecord | null {
    const row = this.db.prepare("select * from bookings where id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? toBooking(row) : null;
  }

  /** Looks up a booking by approval token. */
  getByApprovalToken(token: string): BookingRecord | null {
    const row = this.db.prepare("select * from bookings where approvalToken = ?").get(token) as
      | Record<string, unknown>
      | undefined;
    return row ? toBooking(row) : null;
  }

  /** Updates booking status and calendar event id. */
  updateStatus(id: string, status: BookingStatus, calendarEventId: string | null): BookingRecord {
    this.db
      .prepare("update bookings set status = ?, calendarEventId = ? where id = ?")
      .run(status, calendarEventId, id);
    const record = this.getById(id);
    if (!record) throw new Error("Booking not found after status update");
    return record;
  }
}
