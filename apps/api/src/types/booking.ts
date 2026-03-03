export type BookingStatus = "inquiry" | "hold" | "confirmed" | "canceled";

export type BookingRecord = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location: string;
  duration: string | null;
  rateQuoted: number;
  agencyEmail: string;
  status: BookingStatus;
  approvalToken: string;
  calendarEventId: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  createdAt: string;
};

export type CreateBookingInput = Omit<BookingRecord, "createdAt">;

export type ParsedBookingRequest = {
  title: string;
  startAt: string;
  endAt: string;
  location: string;
  duration: string;
  rateType: "half_day" | "full_day" | "hourly" | "flat";
  rateQuoted: number;
  agencyEmail: string;
};
