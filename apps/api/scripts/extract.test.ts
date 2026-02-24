import { startServer } from "../src/index";
import { BookingCreateSchema } from "../../../packages/shared/booking.schema";

const port = 3012;
const url = `http://127.0.0.1:${port}/extract`;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const sampleEmail = `Subject: New Booking Request
Client Name: Acme Corp
Status: CONFIRMED
Start Time: 2026-02-24T09:00:00Z
End Time: 2026-02-24T10:00:00Z
Rate: 1500`;

const server = startServer(port);

try {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailText: sampleEmail }),
  });

  assert(res.status === 200, `Expected 200, got ${res.status}`);
  const body = await res.json();
  const parsed = BookingCreateSchema.safeParse(body);
  assert(parsed.success, "Response did not match BookingCreateSchema");

  console.log("Extract test passed");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}