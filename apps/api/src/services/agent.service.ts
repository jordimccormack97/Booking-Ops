import { randomUUID } from "node:crypto";
import { requireEnv } from "../lib/env";
import { isInsufficientScopesError } from "../lib/google-auth";
import { log } from "../lib/logger";
import type { BookingRecord } from "../types/booking";
import { extractBookingWithAi } from "./aiExtraction.service";
import { parseBookingEmail } from "./bookingParser";
import { BookingService } from "./booking.service";
import { CalendarService } from "./calendar.service";
import { GmailApiService, type GmailMessage } from "./gmail.service";

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

  private async markMessageAsReadBestEffort(messageId: string) {
    try {
      await this.getGmailService().markAsRead(messageId);
    } catch (error) {
      if (isInsufficientScopesError(error)) {
        log("warn", "[INGEST] mark_read_skipped_insufficient_scope", {
          messageId,
          note: "gmail.readonly token cannot mark messages read; continuing without modifying labels.",
        });
        return;
      }
      throw error;
    }
  }

  private isRateMissing(rateQuoted: number) {
    return !Number.isFinite(rateQuoted) || rateQuoted <= 0;
  }

  private async enrichBookingRateIfMissing(
    booking: BookingRecord,
    content: {
      plainText: string;
      fromEmail?: string;
      messageDate?: string;
      messageId?: string;
      threadId?: string;
    },
  ) {
    if (!this.isRateMissing(booking.rateQuoted)) return booking;

    const aiInput = content.threadId
      ? `${content.plainText}\n\n${await this.getGmailService().fetchThreadPlainText(content.threadId)}`
      : content.plainText;
    const aiParsed = await extractBookingWithAi(aiInput, content.fromEmail, content.messageDate);
    if (!aiParsed) return booking;

    console.log("[AI EXTRACT]", {
      messageId: content.messageId ?? null,
      extracted: {
        rateQuoted: aiParsed.booking.rateQuoted,
        rateType: aiParsed.booking.rateType,
      },
      confidence: aiParsed.confidence,
    });

    return this.bookingService.updateRateDetails(
      booking.id,
      aiParsed.booking.rateQuoted,
      aiParsed.booking.rateType.replace("_", " "),
    );
  }

  private redactSnippet(value: string, maxLength = 420) {
    const emailRedacted = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
    const phoneRedacted = emailRedacted.replace(
      /(?:\+?\d{1,2}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?){2}\d{4}/g,
      "[redacted-phone]",
    );
    return phoneRedacted.slice(0, maxLength);
  }

  /** Ingests booking content, persists inquiry, performs conflict check, and sends approval. */
  async ingestBookingContent(content: {
    plainText: string;
    fromEmail?: string;
    subject?: string;
    messageDate?: string;
    messageId?: string;
    threadId?: string;
  }) {
    let parsed = parseBookingEmail(content.plainText, content.fromEmail, content.messageDate);
    if (
      !parsed.success &&
      parsed.missingFields.length === 1 &&
      parsed.missingFields[0] === "rateQuoted" &&
      content.threadId
    ) {
      try {
        const threadText = await this.getGmailService().fetchThreadPlainText(content.threadId);
        const combinedText = `${content.plainText}\n\n${threadText}`;
        const recovered = parseBookingEmail(combinedText, content.fromEmail, content.messageDate);
        if (recovered.success) {
          parsed = recovered;
          log("info", "[INGEST] recovered_rate_from_thread", {
            messageId: content.messageId ?? null,
            threadId: content.threadId,
          });
        }
      } catch (error) {
        log("warn", "[INGEST] thread_recovery_failed", {
          messageId: content.messageId ?? null,
          threadId: content.threadId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!parsed.success) {
      try {
        const aiInput = content.threadId
          ? `${content.plainText}\n\n${await this.getGmailService().fetchThreadPlainText(content.threadId)}`
          : content.plainText;
        const aiParsed = await extractBookingWithAi(
          aiInput,
          content.fromEmail,
          content.messageDate,
        );
        if (aiParsed) {
          parsed = { success: true, data: aiParsed.booking };
          console.log("[AI EXTRACT]", {
            messageId: content.messageId ?? null,
            extracted: {
              rateQuoted: aiParsed.booking.rateQuoted,
              rateType: aiParsed.booking.rateType,
            },
            confidence: aiParsed.confidence,
          });
        }
      } catch (error) {
        log("warn", "[INGEST] ai_recovery_failed", {
          messageId: content.messageId ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!parsed.success) {
      log("warn", "[INGEST] skipped_parse_failed", {
        messageId: content.messageId ?? null,
        subject: content.subject ?? null,
        from: content.fromEmail ?? null,
        date: content.messageDate ?? null,
        missingFields: parsed.missingFields,
        snippet: this.redactSnippet(content.plainText),
      });
      return {
        ok: false as const,
        error: "Failed to parse booking email",
        missingFields: parsed.missingFields,
      };
    }

    const createPayload = {
      id: randomUUID(),
      title: parsed.data.title || content.subject || "Booking Request",
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
      location: parsed.data.location,
      duration: parsed.data.duration,
      rateQuoted: parsed.data.rateQuoted,
      agencyEmail: parsed.data.agencyEmail,
      status: "inquiry" as const,
      approvalToken: randomUUID(),
      calendarEventId: null,
      gmailMessageId: content.messageId ?? null,
      gmailThreadId: content.threadId ?? null,
    };

    let inquiry;
    try {
      inquiry = await this.bookingService.create(createPayload);
    } catch (error) {
      log("error", "[INGEST] insert_failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        data: createPayload,
      });
      throw error;
    }

    const calendarService = this.getCalendarService();
    const hasConflict = await calendarService.checkCalendarConflicts(
      inquiry.startAt,
      inquiry.endAt,
    );

    let booking = inquiry;
    if (!hasConflict) {
      const holdEventId = await calendarService.createHoldEvent(inquiry);
      booking = await this.bookingService.updateStatus(inquiry.id, "hold", holdEventId);
    }

    await this.sendApprovalEmail(booking, hasConflict);
    return { ok: true as const, booking, conflict: hasConflict };
  }

  /** Executes ingest workflow for the latest unread booking test email. */
  async ingestTestBookingEmail() {
    log("info", "[INGEST] started");
    const gmailService = this.getGmailService();
    const message = await gmailService.fetchLatestUnreadBookingTestEmail();
    if (!message) {
      return { ok: true as const, message: "No unread test booking email found" };
    }

    const result = await this.ingestBookingContent({
      plainText: message.plainText,
      fromEmail: message.fromEmail ?? undefined,
      subject: message.subject,
      messageDate: message.date ?? undefined,
      messageId: message.id,
      threadId: message.threadId ?? undefined,
    });
    await this.markMessageAsReadBestEffort(message.id);
    if (!result.ok) return result;

    log("info", "[INGEST] completed", {
      bookingId: result.booking.id,
      status: result.booking.status,
      conflict: result.conflict,
    });
    return result;
  }

  /** Syncs Gmail messages for a query and returns import summary stats. */
  async syncGmail(query: string) {
    const gmail = this.getGmailService();
    const messages = await gmail.fetchMessagesForSync(query, 10);

    let added = 0;
    let skipped = 0;
    let errors = 0;
    const skippedReasons = {
      existingMessage: 0,
      existingThread: 0,
      parseFailed: 0,
    };

    for (const message of messages) {
      try {
        const existingByMessageId = await this.bookingService.getByGmailMessageId(message.id);
        if (existingByMessageId) {
          await this.enrichBookingRateIfMissing(existingByMessageId, {
            plainText: message.plainText,
            fromEmail: message.fromEmail ?? undefined,
            messageDate: message.date ?? undefined,
            messageId: message.id,
            threadId: message.threadId ?? undefined,
          });
          skipped += 1;
          skippedReasons.existingMessage += 1;
          log("info", "[INGEST] skipped_existing_message", {
            messageId: message.id,
            bookingId: existingByMessageId.id,
          });
          continue;
        }

        if (message.threadId) {
          const existingByThread = await this.bookingService.getByGmailThreadId(message.threadId);
          if (existingByThread.length > 0) {
            await this.enrichBookingRateIfMissing(existingByThread[0], {
              plainText: message.plainText,
              fromEmail: message.fromEmail ?? undefined,
              messageDate: message.date ?? undefined,
              messageId: message.id,
              threadId: message.threadId ?? undefined,
            });
            skipped += 1;
            skippedReasons.existingThread += 1;
            log("info", "[INGEST] skipped_existing_thread", {
              messageId: message.id,
              threadId: message.threadId,
              existingCount: existingByThread.length,
            });
            continue;
          }
        }

        const result = await this.ingestBookingContent({
          plainText: message.plainText,
          fromEmail: message.fromEmail ?? undefined,
          subject: message.subject,
          messageDate: message.date ?? undefined,
          messageId: message.id,
          threadId: message.threadId ?? undefined,
        });

        if (result.ok) {
          added += 1;
        } else {
          skipped += 1;
          skippedReasons.parseFailed += 1;
        }

        await this.markMessageAsReadBestEffort(message.id);
      } catch (error) {
        if (isInsufficientScopesError(error)) {
          log("error", "[INGEST] sync_item_failed_insufficient_scopes", {
            messageId: message.id,
            error: error instanceof Error ? error.message : String(error),
          });
          throw new Error(
            "Google token is missing required scopes. Re-connect via /auth/google/start and update GOOGLE_REFRESH_TOKEN in apps/api/.env.",
          );
        }
        errors += 1;
        log("error", "[INGEST] sync_item_failed", {
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    return { added, skipped, errors, skippedReasons };
  }

  /** Approves booking from hold state and confirms event on primary calendar. */
  async approveBooking(approvalToken: string) {
    const booking = await this.bookingService.getByApprovalToken(approvalToken);
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
    const updated = await this.bookingService.updateStatus(booking.id, "confirmed", eventId);
    await this.sendAgencyConfirmation(updated.agencyEmail, updated.id);
    log("info", "[BOOKING_CONFIRMED] completed", { bookingId: updated.id, calendarEventId: eventId });
    return updated;
  }
}
