import { createClient } from "@supabase/supabase-js";
import { type BookingCreate, BookingCreateSchema } from "../../../packages/shared/booking.schema";

const BOOKINGS_TABLE = "bookings";
const BOOKING_COLUMNS = "status,client_name,start_time,end_time,rate";

export interface BookingRepository {
  create(booking: BookingCreate): Promise<BookingCreate>;
  list(): Promise<BookingCreate[]>;
}

export function createInMemoryBookingRepository(): BookingRepository {
  const bookings: BookingCreate[] = [];

  return {
    async create(booking) {
      bookings.push(booking);
      return booking;
    },
    async list() {
      return [...bookings];
    },
  };
}

export function createSupabaseBookingRepositoryFromEnv(): BookingRepository {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async create(booking) {
      const payload = {
        status: booking.status,
        client_name: booking.client_name,
        start_time: booking.start_time,
        end_time: booking.end_time,
        rate: booking.rate,
      };

      const { data, error } = await supabase
        .from(BOOKINGS_TABLE)
        .insert(payload)
        .select(BOOKING_COLUMNS)
        .single();
      if (error) throw error;

      const parsed = BookingCreateSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error("Supabase returned invalid booking data");
      }
      return parsed.data;
    },
    async list() {
      const { data, error } = await supabase
        .from(BOOKINGS_TABLE)
        .select(BOOKING_COLUMNS)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;

      const rows = data ?? [];
      return rows.map((row) => {
        const parsed = BookingCreateSchema.safeParse(row);
        if (!parsed.success) {
          throw new Error("Supabase returned invalid booking data");
        }
        return parsed.data;
      });
    },
  };
}
