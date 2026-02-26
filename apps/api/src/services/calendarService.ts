import { google, type calendar_v3 } from "googleapis";
import { optionalEnv } from "../lib/env";
import { createGoogleOAuthClientFromEnv } from "../lib/google-auth";
import { log } from "../lib/logger";
import type { BookingRecord } from "../types/booking";

/**
 * Calendar operations used by booking ingestion and approval.
 */
export class CalendarService {
  private readonly calendar: calendar_v3.Calendar;

  constructor() {
    this.calendar = google.calendar({ version: "v3", auth: createGoogleOAuthClientFromEnv() });
  }

  /**
   * Checks primary calendar freebusy for overlapping events.
   */
  async checkCalendarConflicts(startAt: string, endAt: string): Promise<boolean> {
    const result = await this.calendar.freebusy.query({
      requestBody: {
        timeMin: new Date(startAt).toISOString(),
        timeMax: new Date(endAt).toISOString(),
        items: [{ id: "primary" }],
      },
    });
    const busy = result.data.calendars?.primary?.busy ?? [];
    const conflict = busy.length > 0;
    log("info", "calendar.conflicts.checked", { startAt, endAt, conflict });
    return conflict;
  }

  private async getOrCreateHoldsCalendarId(): Promise<string> {
    const summary = "Booking Holds";
    const existing = await this.calendar.calendarList.list();
    const found = existing.data.items?.find((item) => item.summary === summary);
    if (found?.id) return found.id;

    const created = await this.calendar.calendars.insert({
      requestBody: {
        summary,
        timeZone: optionalEnv("BOOKING_TIMEZONE", "UTC"),
      },
    });
    const calendarId = created.data.id;
    if (!calendarId) throw new Error("Failed to create Booking Holds calendar");
    return calendarId;
  }

  /**
   * Creates a hold event on the "Booking Holds" calendar.
   */
  async createHoldEvent(booking: BookingRecord): Promise<string> {
    const calendarId = await this.getOrCreateHoldsCalendarId();
    const created = await this.calendar.events.insert({
      calendarId,
      requestBody: {
        summary: booking.title,
        location: booking.location,
        description: `Rate: ${booking.rateQuoted}\nAgency: ${booking.agencyEmail}\nApproval Token: ${booking.approvalToken}`,
        start: { dateTime: new Date(booking.startAt).toISOString() },
        end: { dateTime: new Date(booking.endAt).toISOString() },
      },
    });
    if (!created.data.id) throw new Error("Failed to create hold event");
    log("info", "calendar.hold.created", { bookingId: booking.id, eventId: created.data.id });
    return created.data.id;
  }

  /**
   * Creates or updates a booking event on the primary calendar.
   */
  async confirmEvent(booking: BookingRecord): Promise<string> {
    const requestBody = {
      summary: booking.title,
      location: booking.location,
      description: `Rate: ${booking.rateQuoted}\nAgency: ${booking.agencyEmail}\nApproval Token: ${booking.approvalToken}`,
      start: { dateTime: new Date(booking.startAt).toISOString() },
      end: { dateTime: new Date(booking.endAt).toISOString() },
    };

    if (booking.calendarEventId) {
      const updated = await this.calendar.events.patch({
        calendarId: "primary",
        eventId: booking.calendarEventId,
        requestBody,
      });
      const eventId = updated.data.id ?? booking.calendarEventId;
      log("info", "calendar.primary.updated", { bookingId: booking.id, eventId });
      return eventId;
    }

    const created = await this.calendar.events.insert({
      calendarId: "primary",
      requestBody,
    });
    if (!created.data.id) throw new Error("Failed to create confirmed event");
    log("info", "calendar.primary.created", { bookingId: booking.id, eventId: created.data.id });
    return created.data.id;
  }
}
