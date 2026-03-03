import { google, type gmail_v1 } from "googleapis";
import { optionalEnv } from "../lib/env";
import { createGoogleOAuthClientFromEnv } from "../lib/google-auth";
import { log } from "../lib/logger";

export type GmailMessage = {
  id: string;
  threadId: string | null;
  subject: string;
  fromEmail: string | null;
  date: string | null;
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

function findHtmlPart(part?: gmail_v1.Schema$MessagePart): gmail_v1.Schema$MessagePart | null {
  if (!part) return null;
  if (part.mimeType === "text/html" && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findHtmlPart(child);
    if (found) return found;
  }
  return null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
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
  const htmlPart = findHtmlPart(payload);
  const plainTextFromTextPart = textPart?.body?.data ? decodeBase64Url(textPart.body.data) : "";
  const plainTextFromPayload = decodeBase64Url(payload?.body?.data);
  const plainTextFromHtml = htmlPart?.body?.data ? htmlToText(decodeBase64Url(htmlPart.body.data)) : "";
  const plainText =
    plainTextFromTextPart ||
    plainTextFromPayload ||
    plainTextFromHtml ||
    (message.snippet ?? "");
  const headers = payload?.headers ?? [];
  return {
    id: message.id ?? "",
    threadId: message.threadId ?? null,
    subject: headerValue(headers, "subject"),
    fromEmail: parseEmailAddress(headerValue(headers, "from")),
    date: headerValue(headers, "date") || null,
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

  /** Fetches the latest booking email based on configured query (read + unread by default). */
  async fetchLatestUnreadBookingTestEmail(): Promise<GmailMessage | null> {
    const query = optionalEnv("BOOKING_TEST_EMAIL_QUERY", "newer_than:30d from:directionsusa.com");
    const list = await this.gmail.users.messages.list({ userId: "me", q: query, maxResults: 1 });
    const messageId = list.data.messages?.[0]?.id;
    if (!messageId) return null;

    const detail = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    log("info", "[INGEST] gmail_message_fetched", { messageId, threadId: detail.data.threadId ?? null });
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

  /** Fetches messages for a query and logs summary details for debugging ingestion. */
  async fetchMessagesForSync(query: string, maxResults = 10): Promise<GmailMessage[]> {
    const list = await this.gmail.users.messages.list({ userId: "me", q: query, maxResults });
    const ids = (list.data.messages ?? [])
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id));

    log("info", "[INGEST] gmail_sync_message_ids", { query, count: ids.length, ids });

    const messages: GmailMessage[] = [];
    for (const id of ids) {
      const detail = await this.gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });
      const parsed = toMessage(detail.data);
      messages.push(parsed);
    }

    for (const message of messages.slice(0, 10)) {
      log("info", "[INGEST] gmail_sync_message_preview", {
        messageId: message.id,
        threadId: message.threadId,
        subject: message.subject,
        from: message.fromEmail,
        date: message.date,
      });
    }

    return messages;
  }

  /** Fetches all messages for a query using Gmail pagination, then returns full parsed bodies. */
  async fetchAllMessagesForQuery(query: string, limit = 500): Promise<GmailMessage[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const list = await this.gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: 100,
        pageToken,
      });
      const batch = (list.data.messages ?? [])
        .map((message) => message.id)
        .filter((id): id is string => Boolean(id));
      ids.push(...batch);
      pageToken = list.data.nextPageToken ?? undefined;
    } while (pageToken && ids.length < limit);

    const slicedIds = ids.slice(0, limit);
    const messages: GmailMessage[] = [];
    for (const id of slicedIds) {
      const detail = await this.gmail.users.messages.get({ userId: "me", id, format: "full" });
      messages.push(toMessage(detail.data));
    }

    log("info", "[INGEST] gmail_sync_all_messages", {
      query,
      count: messages.length,
    });
    return messages;
  }

  /** Fetches plain text across the full thread to recover missing booking details from prior messages. */
  async fetchThreadPlainText(threadId: string): Promise<string> {
    const messages = await this.fetchThreadMessages(threadId);
    const parts = messages.map((message) => message.plainText).filter(Boolean);
    return parts.join("\n\n---\n\n");
  }

  /** Fetches parsed messages for a Gmail thread. */
  async fetchThreadMessages(threadId: string): Promise<GmailMessage[]> {
    const thread = await this.gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
    const messages = thread.data.messages ?? [];
    return messages.map((message) => toMessage(message));
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

  /** Returns authenticated mailbox email address. */
  async getAuthenticatedEmail(): Promise<string> {
    const profile = await this.gmail.users.getProfile({ userId: "me" });
    const email = profile.data.emailAddress;
    if (!email) throw new Error("Unable to resolve authenticated Gmail address");
    return email;
  }
}
