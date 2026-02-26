import { startServer } from "../src/index";

const port = 3011;
const url = `http://127.0.0.1:${port}/bookings`;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

process.env.SQLITE_DB_PATH = ":memory:";
const server = startServer(port);

try {
  const getRes = await fetch(url);
  assert(getRes.status === 200, `Expected 200, got ${getRes.status}`);
  const bookings = await getRes.json();
  assert(Array.isArray(bookings), "Expected bookings array");
  assert(bookings.length === 0, `Expected 0 bookings, got ${bookings.length}`);

  console.log("Bookings test passed");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
