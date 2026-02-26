export type BookingStatus = "inquiry" | "hold" | "confirmed";

export type BookingRecord = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location: string;
  rateQuoted: number;
  agencyEmail: string;
  status: BookingStatus;
  approvalToken: string;
  calendarEventId: string | null;
  createdAt: string;
};

export type CreateBookingInput = Omit<BookingRecord, "createdAt">;

export type ParsedBookingRequest = {
  title: string;
  startAt: string;
  endAt: string;
  location: string;
  rateQuoted: number;
  agencyEmail: string;
};
