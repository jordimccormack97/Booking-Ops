import { startServer } from "../src/index";

const port = 3011;
const url = `http://127.0.0.1:${port}/bookings`;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const validBooking = {
  status: "CONFIRMED",
  client_name: "Acme Corp",
  start_time: "2026-02-24T09:00:00Z",
  end_time: "2026-02-24T10:00:00Z",
  rate: 1000,
};

const invalidStatusBooking = {
  status: "INVALID",
  client_name: "Acme Corp",
  start_time: "2026-02-24T09:00:00Z",
  end_time: "2026-02-24T10:00:00Z",
  rate: 1000,
};

const missingRateBooking = {
  status: "CONFIRMED",
  client_name: "Acme Corp",
  start_time: "2026-02-24T09:00:00Z",
  end_time: "2026-02-24T10:00:00Z",
};

const server = startServer(port);

try {
  const invalidStatusRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(invalidStatusBooking),
  });
  assert(
    invalidStatusRes.status === 400,
    `Expected 400, got ${invalidStatusRes.status}`,
  );

  const missingRateRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(missingRateBooking),
  });
  assert(
    missingRateRes.status === 400,
    `Expected 400, got ${missingRateRes.status}`,
  );

  const postRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validBooking),
  });
  assert(postRes.status === 201, `Expected 201, got ${postRes.status}`);
  const validBody = await postRes.json();
  assert(
    JSON.stringify(validBody) === JSON.stringify(validBooking),
    `Unexpected booking body: ${JSON.stringify(validBody)}`,
  );

  const getRes = await fetch(url);
  assert(getRes.status === 200, `Expected 200, got ${getRes.status}`);
  const bookings = await getRes.json();
  assert(Array.isArray(bookings), "Expected bookings array");
  assert(bookings.length === 1, `Expected 1 booking, got ${bookings.length}`);
  assert(
    JSON.stringify(bookings[0]) === JSON.stringify(validBooking),
    `Unexpected stored booking: ${JSON.stringify(bookings[0])}`,
  );

  console.log("Bookings test passed");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
