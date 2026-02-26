export type BookingStatus = "INQUIRY" | "HOLD" | "CONFIRMED" | "CANCELED";

export type Booking = {
  status: BookingStatus;
  client_name: string;
  start_time: string;
  end_time: string;
  rate: number;
};
