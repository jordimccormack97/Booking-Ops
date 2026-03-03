import { createDbClient } from "../src/db/client";
import { startServer } from "../src/index";
import { AgentService } from "../src/services/agent.service";
import { BookingService } from "../src/services/booking.service";

const port = 3014;
const baseUrl = `http://127.0.0.1:${port}`;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

process.env.SQLITE_DB_PATH = ":memory:";
process.env.MY_EMAIL = "owner@example.com";

const sentEmails: Array<{ to: string; subject: string; body: string }> = [];
let holdCounter = 0;
let confirmCounter = 0;

const fakeGmailService = {
  async sendEmail(to: string, subject: string, body: string) {
    sentEmails.push({ to, subject, body });
  },
} as const;

const fakeCalendarService = {
  async checkCalendarConflicts() {
    return false;
  },
  async createHoldEvent() {
    holdCounter += 1;
    return `hold_evt_${holdCounter}`;
  },
  async confirmEvent() {
    confirmCounter += 1;
    return `primary_evt_${confirmCounter}`;
  },
} as const;

const bookingService = new BookingService(createDbClient());
const agentService = new AgentService(
  bookingService,
  () => fakeGmailService as never,
  () => fakeCalendarService as never,
);

const server = startServer(port, { bookingService, agentService });

const sampleEmail = [
  "Title: Corporate Event",
  "Date: 2026-03-20",
  "Start Time: 18:00",
  "End Time: 20:00",
  "Location: Venue A",
  "Rate: 2000",
  "Agency Email: agency@example.com",
].join("\n");

try {
  const ingestRes = await fetch(`${baseUrl}/email/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailText: sampleEmail, subject: "Booking Request" }),
  });
  assert(ingestRes.status === 200, `Expected 200 for ingest, got ${ingestRes.status}`);
  const ingestBody = await ingestRes.json();
  assert(ingestBody?.ok === true, "Expected successful ingest response");
  assert(ingestBody?.conflict === false, "Expected no calendar conflict");
  assert(ingestBody?.booking?.status === "hold", "Expected booking to be in hold state");
  assert(
    typeof ingestBody?.booking?.approvalToken === "string",
    "Expected approvalToken in ingest response",
  );

  assert(sentEmails.length === 1, `Expected 1 email after ingest, got ${sentEmails.length}`);
  assert(sentEmails[0]?.to === "owner@example.com", "Expected approval email to owner");
  assert(
    sentEmails[0]?.subject.includes("Booking Hold Created"),
    "Expected approval email subject",
  );

  const approveRes = await fetch(`${baseUrl}/agent/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalToken: ingestBody.booking.approvalToken }),
  });
  assert(approveRes.status === 200, `Expected 200 for approve, got ${approveRes.status}`);
  const approveBody = await approveRes.json();
  assert(approveBody?.status === "confirmed", "Expected confirmed booking status");
  assert(approveBody?.calendarEventId === "primary_evt_1", "Expected confirmed event id");

  const listRes = await fetch(`${baseUrl}/bookings`);
  assert(listRes.status === 200, `Expected 200 for list, got ${listRes.status}`);
  const bookings = await listRes.json();
  assert(Array.isArray(bookings), "Expected bookings array");
  assert(bookings.length === 1, `Expected 1 booking, got ${bookings.length}`);
  assert(bookings[0]?.status === "confirmed", "Expected stored booking status confirmed");

  assert(sentEmails.length === 2, `Expected 2 emails after approval, got ${sentEmails.length}`);
  assert(sentEmails[1]?.to === "agency@example.com", "Expected confirmation email to agency");
  assert(sentEmails[1]?.subject === "Booking Confirmation", "Expected booking confirmation email");

  console.log("Workflow test passed");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
