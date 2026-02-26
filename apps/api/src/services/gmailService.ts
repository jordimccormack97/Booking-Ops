import { google, type gmail_v1 } from "googleapis";
import { optionalEnv } from "../lib/env";
import { createGoogleOAuthClientFromEnv } from "../lib/google-auth";
import { log } from "../lib/logger";

export type GmailMessage = {
  id: string;
  subject: string;
  fromEmail: string | null;
  plainText: string;
};

function decodeBase64Url(value?: string | null): string {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded =
    normalized.length % 4 === 0
      ? normalized
      : normalized + "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(padded, "base64").toString("utf8");
}

function findTextPart(part?: gmail_v1.Schema$MessagePart): gmail_v1.Schema$MessagePart | null {
  if (!part) return null;
  if (part.mimeType === "text/plain" && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findTextPart(child);
    if (found) return found;
  }
  return null;
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseEmailAddress(raw: string): string | null {
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

function toGmailMessage(message: gmail_v1.Schema$Message): GmailMessage {
  const payload = message.payload;
  const textPart = findTextPart(payload);
  const plainText = textPart?.body?.data
    ? decodeBase64Url(textPart.body.data)
    : decodeBase64Url(payload?.body?.data);
  const headers = payload?.headers ?? [];

  return {
    id: message.id ?? "",
    subject: headerValue(headers, "subject"),
    fromEmail: parseEmailAddress(headerValue(headers, "from")),
    plainText,
  };
}

/**
 * Provides Gmail read/send helpers for the booking workflow.
 */
export class GmailService {
  private readonly gmail: gmail_v1.Gmail;

  constructor() {
    this.gmail = google.gmail({ version: "v1", auth: createGoogleOAuthClientFromEnv() });
  }

  /** Fetches the latest unread booking test email using a configurable query. */
  async fetchLatestUnreadBookingTestEmail(): Promise<GmailMessage | null> {
    const query = optionalEnv("BOOKING_TEST_EMAIL_QUERY", "is:unread subject:(booking request)");
    log("info", "gmail.fetch.start", { query });

    const list = await this.gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 1,
    });
    const messageId = list.data.messages?.[0]?.id;
    if (!messageId) {
      log("info", "gmail.fetch.none");
      return null;
    }

    const message = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const parsed = toGmailMessage(message.data);

    log("info", "gmail.fetch.success", { messageId, subject: parsed.subject, fromEmail: parsed.fromEmail });
    return parsed;
  }

  /** Fetches unread messages by Gmail query for worker-style processing. */
  async fetchUnreadMessages(query: string, maxResults = 10): Promise<GmailMessage[]> {
    log("info", "gmail.fetch_many.start", { query, maxResults });
    const list = await this.gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults,
    });
    const ids = (list.data.messages ?? [])
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id));

    const messages: GmailMessage[] = [];
    for (const id of ids) {
      const detail = await this.gmail.users.messages.get({ userId: "me", id, format: "full" });
      messages.push(toGmailMessage(detail.data));
    }
    log("info", "gmail.fetch_many.success", { count: messages.length });
    return messages;
  }

  /** Marks a Gmail message as read by removing the UNREAD label. */
  async markAsRead(messageId: string) {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });
    log("info", "gmail.mark_read.success", { messageId });
  }

  /** Sends a plain text email from the authenticated mailbox. */
  async sendEmail(to: string, subject: string, body: string) {
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`,
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    log("info", "gmail.send.success", { to, subject });
  }
}
