import { Pool, type QueryResult } from "pg";
import { requireEnv } from "../lib/env";
import { log } from "../lib/logger";

export type DbClient = {
  close: () => Promise<void>;
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<QueryResult<T>>;
  ready: Promise<void>;
};

async function ensureSchema(pool: Pool) {
  const statements = [
    "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    `CREATE TABLE IF NOT EXISTS public.bookings (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      title text NOT NULL,
      start_at text NOT NULL,
      end_at text NOT NULL,
      location text NOT NULL,
      duration text,
      rate_quoted double precision NOT NULL,
      agency_email text NOT NULL,
      status text NOT NULL CHECK (status IN ('inquiry', 'hold', 'confirmed', 'canceled')),
      approval_token text NOT NULL UNIQUE,
      calendar_event_id text,
      gmail_message_id text,
      gmail_thread_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_gmail_message_id ON public.bookings(gmail_message_id) WHERE gmail_message_id IS NOT NULL",
    `CREATE TABLE IF NOT EXISTS public.extracted_rates (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      source text NOT NULL,
      message_id text NOT NULL UNIQUE,
      thread_id text,
      subject text,
      from_email text,
      date_received timestamptz,
      is_booking_request boolean NOT NULL DEFAULT false,
      title text,
      client_or_brand text,
      job_type text,
      event_date_text text,
      start_time_text text,
      end_time_text text,
      timezone text,
      minimum_hours double precision,
      location text,
      rate_quoted double precision,
      currency text,
      rate_type text,
      record_type text NOT NULL DEFAULT 'booking',
      folder_type text NOT NULL DEFAULT 'booking_request',
      request_type text NOT NULL DEFAULT 'availability_check',
      booking_status text NOT NULL DEFAULT 'request',
      linked_message_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      usage_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
      notes jsonb NOT NULL DEFAULT '[]'::jsonb,
      confidence double precision NOT NULL DEFAULT 0,
      financial_confidence double precision,
      needs_review boolean NOT NULL DEFAULT true,
      calendar_status text NOT NULL DEFAULT 'not_requested',
      google_event_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT extracted_rates_job_type_check CHECK (job_type IS NULL OR job_type IN ('shoot', 'fitting', 'travel', 'other')),
      CONSTRAINT extracted_rates_rate_type_check CHECK (rate_type IS NULL OR rate_type IN ('half_day', 'full_day', 'hourly', 'flat')),
      CONSTRAINT extracted_rates_currency_check CHECK (currency IS NULL OR currency = 'USD'),
      CONSTRAINT extracted_rates_record_type_check CHECK (record_type IN ('booking', 'partnership', 'test_shoot')),
      CONSTRAINT extracted_rates_folder_type_check CHECK (folder_type IN ('booking_request', 'partnership', 'confirmed_booking')),
      CONSTRAINT extracted_rates_request_type_check CHECK (request_type IN ('application', 'availability_check', 'booking_confirmation')),
      CONSTRAINT extracted_rates_booking_status_check CHECK (booking_status IN ('request', 'needs_confirmation', 'confirmed', 'follow_up', 'canceled')),
      CONSTRAINT extracted_rates_calendar_status_check CHECK (calendar_status IN ('not_requested', 'on_calendar', 'needs_auth', 'needs_details')),
      CONSTRAINT extracted_rates_linked_message_ids_array_check CHECK (jsonb_typeof(linked_message_ids) = 'array'),
      CONSTRAINT extracted_rates_usage_terms_array_check CHECK (jsonb_typeof(usage_terms) = 'array'),
      CONSTRAINT extracted_rates_notes_array_check CHECK (jsonb_typeof(notes) = 'array')
    )`,
    "ALTER TABLE public.extracted_rates ADD COLUMN IF NOT EXISTS record_type text",
    "UPDATE public.extracted_rates SET record_type = 'booking' WHERE record_type IS NULL OR btrim(record_type) = ''",
    "ALTER TABLE public.extracted_rates ADD COLUMN IF NOT EXISTS folder_type text",
    `UPDATE public.extracted_rates
     SET folder_type = CASE
       WHEN record_type = 'partnership' THEN 'partnership'
       WHEN booking_status = 'confirmed' THEN 'confirmed_booking'
       ELSE 'booking_request'
     END
     WHERE folder_type IS NULL OR btrim(folder_type) = ''`,
    "ALTER TABLE public.extracted_rates ADD COLUMN IF NOT EXISTS request_type text",
    "UPDATE public.extracted_rates SET request_type = 'availability_check' WHERE request_type IS NULL OR btrim(request_type) = ''",
    "ALTER TABLE public.extracted_rates ADD COLUMN IF NOT EXISTS booking_status text",
    "UPDATE public.extracted_rates SET booking_status = CASE WHEN is_booking_request THEN 'needs_confirmation' ELSE 'request' END WHERE booking_status IS NULL OR btrim(booking_status) = ''",
    "ALTER TABLE public.extracted_rates ADD COLUMN IF NOT EXISTS linked_message_ids jsonb",
    "UPDATE public.extracted_rates SET linked_message_ids = jsonb_build_array(message_id) WHERE linked_message_ids IS NULL OR linked_message_ids = '[]'::jsonb",
    "CREATE INDEX IF NOT EXISTS idx_extracted_rates_date_received ON public.extracted_rates(date_received DESC)",
    "CREATE INDEX IF NOT EXISTS idx_extracted_rates_from_email ON public.extracted_rates(from_email)",
    "CREATE INDEX IF NOT EXISTS idx_extracted_rates_calendar_status ON public.extracted_rates(calendar_status)",
    "CREATE INDEX IF NOT EXISTS idx_extracted_rates_thread_id ON public.extracted_rates(thread_id)",
    `CREATE TABLE IF NOT EXISTS public.booking_expenses (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      booking_id text NOT NULL REFERENCES public.extracted_rates(id) ON DELETE CASCADE,
      expense_date date NOT NULL,
      category text NOT NULL,
      amount numeric(12,2) NOT NULL CHECK (amount >= 0),
      currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
      vendor text,
      notes text,
      receipt_url text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_booking_expenses_booking_id ON public.booking_expenses(booking_id)",
    "CREATE INDEX IF NOT EXISTS idx_booking_expenses_expense_date ON public.booking_expenses(expense_date DESC)",
    `CREATE TABLE IF NOT EXISTS public.booking_expense_audit (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      booking_id text NOT NULL REFERENCES public.extracted_rates(id) ON DELETE CASCADE,
      expense_id text,
      action text NOT NULL CHECK (action IN ('created', 'deleted')),
      changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
      performed_by text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_booking_expense_audit_booking_id ON public.booking_expense_audit(booking_id, created_at DESC)",
    `CREATE OR REPLACE FUNCTION public.set_updated_at()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$`,
    "DROP TRIGGER IF EXISTS trg_extracted_rates_set_updated_at ON public.extracted_rates",
    `CREATE TRIGGER trg_extracted_rates_set_updated_at
      BEFORE UPDATE ON public.extracted_rates
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at()`,
    "DROP TRIGGER IF EXISTS trg_booking_expenses_set_updated_at ON public.booking_expenses",
    `CREATE TRIGGER trg_booking_expenses_set_updated_at
      BEFORE UPDATE ON public.booking_expenses
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at()`,
  ];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query("COMMIT");
    log("info", "[DB_INIT] schema_ready");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Initializes Neon/Postgres client and ensures required schema exists.
 */
export function createDbClient(): DbClient {
  const connectionString = requireEnv("DATABASE_URL");
  const pool = new Pool({ connectionString });
  const ready = ensureSchema(pool).catch((error) => {
    log("error", "[DB_INIT] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  });

  return {
    query: (sql, params) => pool.query(sql, params),
    ready,
    close: () => pool.end(),
  };
}
