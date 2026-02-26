import { startServer } from "../src/index";
import type { AgentService } from "../src/services/agent.service";

const port = 3013;
const baseUrl = `http://127.0.0.1:${port}`;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const fakeAgentService = {
  async approveBooking(approvalToken: string) {
    return {
      id: "booking-1",
      title: "Booking Request",
      startAt: "2026-03-01T09:00:00.000Z",
      endAt: "2026-03-01T11:00:00.000Z",
      location: "Studio B",
      rateQuoted: 1200,
      agencyEmail: "agency@example.com",
      status: "confirmed",
      approvalToken,
      calendarEventId: "primary_event_1",
      createdAt: new Date().toISOString(),
    };
  },
} as unknown as AgentService;

const server = startServer(port, { agentService: fakeAgentService });

try {
  const approveRes = await fetch(`${baseUrl}/agent/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalToken: "approve-123" }),
  });
  assert(approveRes.status === 200, `Expected 200, got ${approveRes.status}`);
  const body = await approveRes.json();
  assert(body?.status === "confirmed", "Expected confirmed status");
  assert(body?.approvalToken === "approve-123", "Expected approval token");

  console.log("Gmail approval test passed");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
