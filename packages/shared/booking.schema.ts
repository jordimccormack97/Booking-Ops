import { z } from "zod";

export const BookingStatusEnum = z.enum([
  "INQUIRY",
  "HOLD",
  "CONFIRMED",
  "CANCELED",
]);

export const BookingCreateSchema = z
  .object({
    status: BookingStatusEnum,
    client_name: z.string().min(1),
    start_time: z.string().min(1),
    end_time: z.string().min(1),
    rate: z.number().finite(),
    id: z.string().optional(),
    source: z.string().optional(),
    job_title: z.string().optional(),
    timezone: z.string().optional(),
    location: z.string().optional(),
    rate_type: z.enum(["day", "hour", "flat"]).optional(),
    notes: z.string().optional(),
    confidence: z.number().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export type BookingCreate = z.infer<typeof BookingCreateSchema>;
