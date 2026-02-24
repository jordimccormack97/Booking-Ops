import { startServer } from "../src/index";
import { createInMemoryBookingRepository } from "../src/bookings-repository";

const expected = { message: "Booking-Ops API running with Bun " };
const port = 3010;
const url = `http://127.0.0.1:${port}/`;
const server = startServer(port, createInMemoryBookingRepository());

try {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Unexpected status: ${res.status}`);
  }

  const body = await res.json();
  if (JSON.stringify(body) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected response body: ${JSON.stringify(body)}`);
  }

  console.log("Smoke test passed");
  console.log(JSON.stringify(body));
  process.exitCode = 0;
} catch (error) {
  console.error("Smoke test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
