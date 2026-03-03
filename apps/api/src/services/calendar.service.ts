import { google, type calendar_v3 } from "googleapis";
import { optionalEnv } from "../lib/env";
import { createGoogleOAuthClientFromEnv } from "../lib/google-auth";
import { log } from "../lib/logger";
import type { BookingRecord } from "../types/booking";
type CalendarEventWindow = {
  startAtIso: string;
  endAtIso: string;
  timezone: string;
};

type CalendarAllDayWindow = {
  allDayDate: string;
  allDayEndDate: string;
};

type CalendarUpsertInput = {
  extracted: {
    messageId: string;
    threadId: string | null;
    subject: string | null;
    title: string | null;
    clientOrBrand: string | null;
    eventDateText: string | null;
    location: string | null;
    rateQuoted: number | null;
    rateType: string | null;
    notes: string[];
    googleEventId: string | null;
  };
  subject: string | null;
  threadId: string | null;
  eventWindow: CalendarEventWindow | CalendarAllDayWindow;
};

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

  /** Creates or updates a Booking Holds event using extracted DirectionsUSA message data. */
  async upsertDirectionsUsaEvent(input: CalendarUpsertInput): Promise<{ eventId: string; action: "created" | "updated" }> {
    const calendarId = await this.ensureBookingHoldsCalendar();
    const eventTitle = input.extracted.title || input.subject || "Booking request";
    const summary = input.extracted.clientOrBrand
      ? `${input.extracted.clientOrBrand} - Booking Request`
      : eventTitle;
    const rateLine =
      input.extracted.rateQuoted === null
        ? "Rate: not provided"
        : `Rate: $${input.extracted.rateQuoted}${input.extracted.rateType ? ` (${input.extracted.rateType})` : ""}`;

    const descriptionLines = [
      `Client/Brand: ${input.extracted.clientOrBrand ?? "Unknown"}`,
      `Original Subject: ${input.subject ?? "Unknown"}`,
      `Location: ${input.extracted.location ?? "TBD"}`,
      `Event Date Text: ${input.extracted.eventDateText ?? "Unknown"}`,
      rateLine,
      `Notes: ${(input.extracted.notes ?? []).join(" | ") || "None"}`,
      `sourceMessageId:${input.extracted.messageId}`,
      `sourceThreadId:${input.threadId ?? input.extracted.threadId ?? "unknown"}`,
    ];

    const requestBody: calendar_v3.Schema$Event = {
      summary,
      location: input.extracted.location ?? "TBD",
      description: descriptionLines.join("\n"),
    };

    if ("allDayDate" in input.eventWindow) {
      requestBody.start = { date: input.eventWindow.allDayDate };
      requestBody.end = { date: input.eventWindow.allDayEndDate };
    } else {
      requestBody.start = {
        dateTime: input.eventWindow.startAtIso,
        timeZone: input.eventWindow.timezone,
      };
      requestBody.end = {
        dateTime: input.eventWindow.endAtIso,
        timeZone: input.eventWindow.timezone,
      };
    }

    if (input.extracted.googleEventId) {
      const updated = await this.calendar.events.patch({
        calendarId,
        eventId: input.extracted.googleEventId,
        requestBody,
      });
      const eventId = updated.data.id ?? input.extracted.googleEventId;
      return { eventId, action: "updated" };
    }

    const created = await this.calendar.events.insert({ calendarId, requestBody });
    const eventId = created.data.id;
    if (!eventId) throw new Error("Failed to create booking event");
    return { eventId, action: "created" };
  }
}
