import express from "express";
import {
  type BookingCreate,
  BookingCreateSchema,
} from "../../../packages/shared/booking.schema";

export const app = express();
app.use(express.json());
const bookings: BookingCreate[] = [];

function extractBookingFromEmail(emailText: string) {
  const match = (pattern: RegExp) => emailText.match(pattern)?.[1]?.trim();
  const status = match(/status\s*:\s*(INQUIRY|HOLD|CONFIRMED|CANCELED)/im);
  const client_name = match(/client(?:\s*name)?\s*:\s*(.+)/im);
  const start_time = match(/start(?:\s*time)?\s*:\s*(.+)/im);
  const end_time = match(/end(?:\s*time)?\s*:\s*(.+)/im);
  const rateRaw = match(/rate\s*:\s*\$?([0-9]+(?:[.,][0-9]+)?)/im);
  const rate = rateRaw ? Number(rateRaw.replace(",", "")) : undefined;

  const missingFields: string[] = [];
  if (!status) missingFields.push("status");
  if (!client_name) missingFields.push("client_name");
  if (!start_time) missingFields.push("start_time");
  if (!end_time) missingFields.push("end_time");
  if (rate === undefined || Number.isNaN(rate)) missingFields.push("rate");

  if (missingFields.length > 0) {
    return { success: false as const, missingFields };
  }

  const candidate = { status, client_name, start_time, end_time, rate };
  const parsed = BookingCreateSchema.safeParse(candidate);
  if (!parsed.success) {
    return { success: false as const, details: parsed.error.flatten() };
  }

  return { success: true as const, data: parsed.data };
}

app.get("/", (_req, res) => {
  res.json({ message: "Booking-Ops API running with Bun " });
});

app.post("/bookings", (req, res) => {
  const parsed = BookingCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid booking payload",
      details: parsed.error.flatten(),
    });
  }

  bookings.push(parsed.data);
  return res.status(201).json(parsed.data);
});

app.get("/bookings", (_req, res) => {
  return res.json(bookings);
});

app.post("/extract", (req, res) => {
  const emailText = req.body?.emailText;
  if (typeof emailText !== "string" || emailText.trim().length === 0) {
    return res
      .status(400)
      .json({ error: "emailText is required and must be a non-empty string" });
  }

  const extracted = extractBookingFromEmail(emailText);
  if (!extracted.success) {
    return res.status(400).json({
      error: "Could not extract required booking fields from email",
      ...("missingFields" in extracted
        ? { missingFields: extracted.missingFields }
        : { details: extracted.details }),
    });
  }

  return res.json(extracted.data);
});

export function startServer(port = Number(process.env.PORT ?? 3000)) {
  return app.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });
}

if (import.meta.main) {
  startServer();
}
