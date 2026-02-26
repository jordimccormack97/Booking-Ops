import { randomUUID } from "node:crypto";
import { requireEnv } from "../lib/env";
import { log } from "../lib/logger";
import type { BookingRecord } from "../types/booking";
import { parseBookingEmail } from "./bookingParser";
import { BookingService } from "./booking.service";
import { CalendarService } from "./calendar.service";
import { GmailApiService } from "./gmail.service";

/**
 * Agent workflow orchestration across Gmail, booking persistence, and calendar.
 */
export class AgentService {
  private gmailServiceInstance: GmailApiService | null = null;
  private calendarServiceInstance: CalendarService | null = null;

  constructor(
    private readonly bookingService: BookingService,
    private readonly gmailServiceFactory: () => GmailApiService = () => new GmailApiService(),
    private readonly calendarServiceFactory: () => CalendarService = () => new CalendarService(),
  ) {}

  private getGmailService() {
    if (!this.gmailServiceInstance) {
      this.gmailServiceInstance = this.gmailServiceFactory();
    }
    return this.gmailServiceInstance;
  }

  private getCalendarService() {
    if (!this.calendarServiceInstance) {
      this.calendarServiceInstance = this.calendarServiceFactory();
    }
    return this.calendarServiceInstance;
  }

  private async sendApprovalEmail(booking: BookingRecord, hasConflict: boolean) {
    await this.getGmailService().sendEmail(
      requireEnv("MY_EMAIL"),
      "Booking Hold Created - Reply YES to Confirm",
      [
        `Date/Time: ${booking.startAt} -> ${booking.endAt}`,
        `Location: ${booking.location}`,
        `Rate: ${booking.rateQuoted}`,
        `Conflict: ${hasConflict ? "YES" : "NO"}`,
        `Approval Token: ${booking.approvalToken}`,
      ].join("\n"),
    );
    log("info", "[APPROVAL_SENT] owner_email_dispatched", { bookingId: booking.id });
  }

  private async sendAgencyConfirmation(agencyEmail: string, bookingId: string) {
    await this.getGmailService().sendEmail(
      agencyEmail,
      "Booking Confirmation",
      "I confirm my availability for this booking.",
    );
    log("info", "[BOOKING_CONFIRMED] agency_email_dispatched", { bookingId, agencyEmail });
  }

  /** Executes ingest workflow for the latest unread booking test email. */
  async ingestTestBookingEmail() {
    log("info", "[INGEST] started");
    const gmailService = this.getGmailService();
    const message = await gmailService.fetchLatestUnreadBookingTestEmail();
    if (!message) {
      return { ok: true as const, message: "No unread test booking email found" };
    }

    const parsed = parseBookingEmail(message.plainText, message.fromEmail ?? undefined);
    if (!parsed.success) {
      await gmailService.markAsRead(message.id);
      return {
        ok: false as const,
        error: "Failed to parse booking email",
        missingFields: parsed.missingFields,
      };
    }

    const inquiry = this.bookingService.create({
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

    const calendarService = this.getCalendarService();
    const hasConflict = await calendarService.checkCalendarConflicts(
      inquiry.startAt,
      inquiry.endAt,
    );

    let booking = inquiry;
    if (!hasConflict) {
      const holdEventId = await calendarService.createHoldEvent(inquiry);
      booking = this.bookingService.updateStatus(inquiry.id, "hold", holdEventId);
    }
    await this.sendApprovalEmail(booking, hasConflict);
    await gmailService.markAsRead(message.id);
    log("info", "[INGEST] completed", {
      bookingId: booking.id,
      status: booking.status,
      conflict: hasConflict,
    });

    return { ok: true as const, booking, conflict: hasConflict };
  }

  /** Approves booking from hold state and confirms event on primary calendar. */
  async approveBooking(approvalToken: string) {
    const booking = this.bookingService.getByApprovalToken(approvalToken);
    if (!booking) throw new Error("Booking not found for approval token");

    if (booking.status === "confirmed") {
      log("info", "[BOOKING_CONFIRMED] idempotent_return", {
        bookingId: booking.id,
        approvalToken,
      });
      return booking;
    }

    if (booking.status !== "hold") {
      throw new Error("Booking is not in hold state");
    }

    const eventId = await this.getCalendarService().confirmEvent(booking);
    const updated = this.bookingService.updateStatus(booking.id, "confirmed", eventId);
    await this.sendAgencyConfirmation(updated.agencyEmail, updated.id);
    log("info", "[BOOKING_CONFIRMED] completed", { bookingId: updated.id, calendarEventId: eventId });
    return updated;
  }
}
