import { google, type calendar_v3 } from "googleapis";
import { optionalEnv } from "../lib/env";
import { createGoogleOAuthClientFromEnv } from "../lib/google-auth";
import { log } from "../lib/logger";
import type { BookingRecord } from "../types/booking";

/**
 * Google Calendar API service for conflict checking and event lifecycle.
 */
export class CalendarService {
  private readonly calendar: calendar_v3.Calendar;

  constructor() {
    this.calendar = google.calendar({ version: "v3", auth: createGoogleOAuthClientFromEnv() });
  }

  /** Returns true when primary calendar has any overlapping events. */
  async checkCalendarConflicts(startAt: string, endAt: string): Promise<boolean> {
    const result = await this.calendar.freebusy.query({
      requestBody: {
        timeMin: new Date(startAt).toISOString(),
        timeMax: new Date(endAt).toISOString(),
        items: [{ id: "primary" }],
      },
    });
    const conflict = (result.data.calendars?.primary?.busy ?? []).length > 0;
    log("info", "[CONFLICT_CHECK] completed", { startAt, endAt, conflict });
    return conflict;
  }

  private async ensureBookingHoldsCalendar() {
    const summary = "Booking Holds";
    const list = await this.calendar.calendarList.list();
    const found = list.data.items?.find((item) => item.summary === summary);
    if (found?.id) return found.id;

    const created = await this.calendar.calendars.insert({
      requestBody: { summary, timeZone: optionalEnv("BOOKING_TIMEZONE", "UTC") },
    });
    if (!created.data.id) throw new Error("Failed to create Booking Holds calendar");
    return created.data.id;
  }

  /** Creates hold event in Booking Holds calendar and returns event id. */
  async createHoldEvent(booking: BookingRecord): Promise<string> {
    const calendarId = await this.ensureBookingHoldsCalendar();
    const event = await this.calendar.events.insert({
      calendarId,
      requestBody: {
        summary: booking.title,
        location: booking.location,
        description: `Rate: ${booking.rateQuoted}\nAgency: ${booking.agencyEmail}\nApproval Token: ${booking.approvalToken}`,
        start: { dateTime: new Date(booking.startAt).toISOString() },
        end: { dateTime: new Date(booking.endAt).toISOString() },
      },
    });
    const eventId = event.data.id;
    if (!eventId) throw new Error("Failed to create hold event");
    log("info", "[HOLD_CREATED] calendar_event_created", { bookingId: booking.id, calendarEventId: eventId });
    return eventId;
  }

  /** Creates/updates confirmed event on primary calendar and returns event id. */
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
      return updated.data.id ?? booking.calendarEventId;
    }

    const created = await this.calendar.events.insert({
      calendarId: "primary",
      requestBody,
    });
    if (!created.data.id) throw new Error("Failed to create confirmed primary event");
    return created.data.id;
  }
}
