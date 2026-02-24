export type BookingCreate = {
  status: string;
  client_name: string;
  start_time: string;
  end_time: string;
  rate: number;
  [key: string]: unknown;
};

export const REQUIRED_BOOKING_FIELDS = [
  "status",
  "client_name",
  "start_time",
  "end_time",
  "rate",
] as const;

export function isValidBookingCreate(input: unknown): input is BookingCreate {
  if (!input || typeof input !== "object") {
    return false;
  }

  const booking = input as Record<string, unknown>;
  return (
    typeof booking.status === "string" &&
    booking.status.length > 0 &&
    typeof booking.client_name === "string" &&
    booking.client_name.length > 0 &&
    typeof booking.start_time === "string" &&
    booking.start_time.length > 0 &&
    typeof booking.end_time === "string" &&
    booking.end_time.length > 0 &&
    typeof booking.rate === "number" &&
    Number.isFinite(booking.rate)
  );
}
