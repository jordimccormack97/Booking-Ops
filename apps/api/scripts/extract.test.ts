import { startServer } from "../src/index";
import type { AgentService } from "../src/services/agent.service";

const port = 3012;
const url = `http://127.0.0.1:${port}/email/ingest-test`;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const fakeAgentService = {
  async ingestTestBookingEmail() {
    return {
      ok: true as const,
      booking: {
        id: "1",
        title: "Booking Request",
        startAt: "2026-02-24T09:00:00.000Z",
        endAt: "2026-02-24T10:00:00.000Z",
        location: "Studio A",
        rateQuoted: 1500,
        agencyEmail: "agency@example.com",
        status: "hold",
        approvalToken: "token-123",
        calendarEventId: "evt_1",
        createdAt: new Date().toISOString(),
      },
      conflict: false,
    };
  },
} as unknown as AgentService;

const server = startServer(port, { agentService: fakeAgentService });

try {
  const res = await fetch(url, {
    method: "POST",
  });

  assert(res.status === 200, `Expected 200, got ${res.status}`);
  const body = await res.json();
  assert(body?.ok === true, "Expected ok response");
  assert(body?.booking?.approvalToken === "token-123", "Expected booking payload");

  console.log("Extract test passed");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
