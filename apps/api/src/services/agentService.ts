import { randomUUID } from "node:crypto";
import { BookingsRepository } from "../db/bookings-repository";
import { requireEnv } from "../lib/env";
import { log } from "../lib/logger";
import type { BookingRecord } from "../types/booking";
import { parseBookingEmail } from "./bookingParser";
import { CalendarService } from "./calendarService";
import { GmailService } from "./gmailService";

/**
 * Orchestrates the end-to-end booking workflow from email to calendar.
 */
export class AgentService {
  private gmailService: GmailService | null = null;
  private calendarService: CalendarService | null = null;

  constructor(
    private readonly bookingsRepository: BookingsRepository,
    private readonly gmailServiceFactory: () => GmailService = () => new GmailService(),
    private readonly calendarServiceFactory: () => CalendarService = () => new CalendarService(),
  ) {}

  private getGmailService() {
    if (!this.gmailService) this.gmailService = this.gmailServiceFactory();
    return this.gmailService;
  }

  private getCalendarService() {
    if (!this.calendarService) this.calendarService = this.calendarServiceFactory();
    return this.calendarService;
  }

  /** Sends owner approval email with conflict and token details. */
  async sendApprovalEmail(booking: BookingRecord, hasConflict: boolean) {
    await this.getGmailService().sendEmail(
      requireEnv("MY_EMAIL"),
      "Booking Hold Created – Reply YES to Confirm",
      [
        `Date/Time: ${booking.startAt} -> ${booking.endAt}`,
        `Location: ${booking.location}`,
        `Rate: ${booking.rateQuoted}`,
        `Conflict: ${hasConflict ? "YES" : "NO"}`,
        `Approval Token: ${booking.approvalToken}`,
      ].join("\n"),
    );
  }

  /** Runs workflow on latest unread test booking email. */
  async ingestLatestUnreadTestEmail() {
    log("info", "agent.ingest.start");
    const gmailService = this.getGmailService();
    const calendarService = this.getCalendarService();
    const message = await gmailService.fetchLatestUnreadBookingTestEmail();
    if (!message) {
      return { ok: true as const, message: "No unread test booking email found" };
    }

    const parsed = parseBookingEmail(message.plainText, message.fromEmail ?? undefined);
    if (!parsed.success) {
      log("warn", "agent.ingest.parse_failed", { messageId: message.id, missingFields: parsed.missingFields });
      await gmailService.markAsRead(message.id);
      return {
        ok: false as const,
        error: "Failed to parse booking email",
        missingFields: parsed.missingFields,
      };
    }

    const booking = this.bookingsRepository.create({
      id: randomUUID(),
      title: parsed.data.title || message.subject || "Booking Request",
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
      location: parsed.data.location,
      rateQuoted: parsed.data.rateQuoted,
      agencyEmail: parsed.data.agencyEmail,
      status: "inquiry",
      approvalToken: randomUUID(),
      calendarEventId: null,
    });

    const hasConflict = await calendarService.checkCalendarConflicts(booking.startAt, booking.endAt);

    let updatedBooking = booking;
    if (!hasConflict) {
      const holdEventId = await calendarService.createHoldEvent(booking);
      updatedBooking = this.bookingsRepository.updateStatus(booking.id, "hold", holdEventId);
    }

    await this.sendApprovalEmail(updatedBooking, hasConflict);
    await gmailService.markAsRead(message.id);
    log("info", "agent.ingest.completed", {
      bookingId: updatedBooking.id,
      status: updatedBooking.status,
      conflict: hasConflict,
    });

    return { ok: true as const, booking: updatedBooking, conflict: hasConflict };
  }
}
