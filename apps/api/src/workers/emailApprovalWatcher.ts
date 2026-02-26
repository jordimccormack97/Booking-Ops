import { createDbClient } from "../db/client";
import { optionalEnv } from "../lib/env";
import { log } from "../lib/logger";
import { AgentService } from "../services/agent.service";
import { BookingService } from "../services/booking.service";
import { GmailApiService } from "../services/gmail.service";

function extractApprovalToken(text: string): string | null {
  const labeled = text.match(/approval\s*token\s*:\s*([a-f0-9-]{8,})/im)?.[1];
  if (labeled) return labeled.trim();
  const uuid = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0];
  return uuid ?? null;
}

function containsPositiveApproval(text: string): boolean {
  return /\bYES\b/i.test(text);
}

/**
 * Polls Gmail replies and autonomously approves bookings when a YES reply includes an approval token.
 */
export function startEmailApprovalWatcher() {
  const pollMinutes = Number(optionalEnv("APPROVAL_WATCHER_POLL_MINUTES", "5"));
  const pollMs = Math.max(1, pollMinutes) * 60 * 1000;
  const query = optionalEnv(
    "APPROVAL_WATCHER_QUERY",
    "is:unread subject:(Booking Hold Created) newer_than:14d",
  );

  const bookingService = new BookingService(createDbClient());
  const gmailService = new GmailApiService();
  const agentService = new AgentService(
    bookingService,
    () => gmailService,
  );

  let isRunning = false;
  const run = async () => {
    if (isRunning) {
      log("warn", "worker.email_approval.skip_overlapping_run");
      return;
    }
    isRunning = true;
    try {
      log("info", "worker.email_approval.poll.start", { query });
      const messages = await gmailService.fetchUnreadMessages(query, 10);

      for (const message of messages) {
        try {
          if (!containsPositiveApproval(message.plainText)) {
            log("info", "worker.email_approval.message.ignored", { messageId: message.id, reason: "missing_yes" });
            await gmailService.markAsRead(message.id);
            continue;
          }

          const approvalToken = extractApprovalToken(message.plainText);
          if (!approvalToken) {
            log("warn", "worker.email_approval.message.ignored", { messageId: message.id, reason: "missing_token" });
            await gmailService.markAsRead(message.id);
            continue;
          }

          const before = bookingService.getByApprovalToken(approvalToken);
          const wasConfirmed = before?.status === "confirmed";
          const updated = await agentService.approveBooking(approvalToken);
          log("info", "worker.email_approval.message.approved", {
            messageId: message.id,
            bookingId: updated.id,
            idempotent: wasConfirmed,
          });

          await gmailService.markAsRead(message.id);
        } catch (error) {
          log("error", "worker.email_approval.message.failed", {
            messageId: message.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      log("error", "worker.email_approval.poll.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      isRunning = false;
      log("info", "worker.email_approval.poll.end");
    }
  };

  void run();
  const timer = setInterval(() => {
    void run();
  }, pollMs);

  log("info", "worker.email_approval.started", { pollMinutes, query });
  return {
    stop() {
      clearInterval(timer);
      log("info", "worker.email_approval.stopped");
    },
  };
}

if (import.meta.main) {
  startEmailApprovalWatcher();
}
