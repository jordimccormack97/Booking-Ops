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

function toMessage(message: gmail_v1.Schema$Message): GmailMessage {
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
 * Gmail API service for reading booking requests/replies and sending workflow emails.
 */
export class GmailApiService {
  private readonly gmail: gmail_v1.Gmail;

  constructor() {
    this.gmail = google.gmail({ version: "v1", auth: createGoogleOAuthClientFromEnv() });
  }

  /** Fetches the latest unread booking test email. */
  async fetchLatestUnreadBookingTestEmail(): Promise<GmailMessage | null> {
    const query = optionalEnv("BOOKING_TEST_EMAIL_QUERY", "is:unread subject:(booking request)");
    const list = await this.gmail.users.messages.list({ userId: "me", q: query, maxResults: 1 });
    const messageId = list.data.messages?.[0]?.id;
    if (!messageId) return null;

    const detail = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    log("info", "[INGEST] gmail_message_fetched", { messageId });
    return toMessage(detail.data);
  }

  /** Fetches unread messages matching a custom query. */
  async fetchUnreadMessages(query: string, maxResults = 10): Promise<GmailMessage[]> {
    const list = await this.gmail.users.messages.list({ userId: "me", q: query, maxResults });
    const ids = (list.data.messages ?? [])
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id));

    const messages: GmailMessage[] = [];
    for (const id of ids) {
      const detail = await this.gmail.users.messages.get({ userId: "me", id, format: "full" });
      messages.push(toMessage(detail.data));
    }
    return messages;
  }

  /** Marks a message as read. */
  async markAsRead(messageId: string) {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });
  }

  /** Sends plain-text email. */
  async sendEmail(to: string, subject: string, body: string) {
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`,
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await this.gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  }
}
