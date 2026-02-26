import { randomUUID } from "node:crypto";
import { requireEnv } from "../lib/env";
import { log } from "../lib/logger";
import type { BookingRecord } from "../types/booking";
import { parseBookingEmail } from "./bookingParser";
import { BookingService } from "./booking.service";
import { GmailApiService } from "./gmail.service";

/**
 * Agent workflow orchestration across Gmail, booking persistence, and calendar.
 */
export class AgentService {
  private gmailServiceInstance: GmailApiService | null = null;

  constructor(
    private readonly bookingService: BookingService,
    private readonly gmailServiceFactory: () => GmailApiService = () => new GmailApiService(),
  ) {}

  private getGmailService() {
    if (!this.gmailServiceInstance) {
      this.gmailServiceInstance = this.gmailServiceFactory();
    }
    return this.gmailServiceInstance;
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

    const booking = inquiry;
    const hasConflict = false;
    await this.sendApprovalEmail(booking, hasConflict);
    await gmailService.markAsRead(message.id);
    log("info", "[INGEST] completed", {
      bookingId: booking.id,
      status: booking.status,
      conflict: hasConflict,
    });

    return { ok: true as const, booking, conflict: hasConflict };
  }
}
