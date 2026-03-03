import type { DbClient } from "../db/client";

export type BookingExpenseRecord = {
  id: string;
  bookingId: string;
  expenseDate: string;
  category: string;
  amount: number;
  currency: "USD";
  vendor: string | null;
  notes: string | null;
  receiptUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseAuditAction = "created" | "deleted";

export type BookingExpenseAuditRecord = {
  id: string;
  bookingId: string;
  expenseId: string | null;
  action: ExpenseAuditAction;
  changedFields: Record<string, unknown>;
  performedBy: string | null;
  createdAt: string;
};

export type CreateBookingExpenseInput = {
  expenseDate: string;
  category: string;
  amount: number;
  currency?: "USD";
  vendor?: string | null;
  notes?: string | null;
  receiptUrl?: string | null;
};

type BookingExpenseRow = {
  id: string;
  booking_id: string;
  expense_date: Date | string;
  category: string;
  amount: string | number;
  currency: "USD";
  vendor: string | null;
  notes: string | null;
  receipt_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BookingExpenseAuditRow = {
  id: string;
  booking_id: string;
  expense_id: string | null;
  action: ExpenseAuditAction;
  changed_fields: unknown;
  performed_by: string | null;
  created_at: Date | string;
};

function toIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toAmount(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toExpenseRecord(row: BookingExpenseRow): BookingExpenseRecord {
  return {
    id: row.id,
    bookingId: row.booking_id,
    expenseDate: toIso(row.expense_date),
    category: row.category,
    amount: toAmount(row.amount),
    currency: row.currency,
    vendor: row.vendor,
    notes: row.notes,
    receiptUrl: row.receipt_url,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toAuditRecord(row: BookingExpenseAuditRow): BookingExpenseAuditRecord {
  return {
    id: row.id,
    bookingId: row.booking_id,
    expenseId: row.expense_id,
    action: row.action,
    changedFields: parseJsonObject(row.changed_fields),
    performedBy: row.performed_by,
    createdAt: toIso(row.created_at),
  };
}

export class BookingExpensesService {
  constructor(private readonly db: DbClient) {}

  private async ensureReady() {
    await this.db.ready;
  }

  async listByBookingId(bookingId: string): Promise<BookingExpenseRecord[]> {
    await this.ensureReady();
    const result = await this.db.query<BookingExpenseRow>(
      `select *
       from public.booking_expenses
       where booking_id = $1
       order by expense_date desc, created_at desc`,
      [bookingId],
    );
    return result.rows.map(toExpenseRecord);
  }

  async listAuditByBookingId(bookingId: string, limit = 100): Promise<BookingExpenseAuditRecord[]> {
    await this.ensureReady();
    const result = await this.db.query<BookingExpenseAuditRow>(
      `select *
       from public.booking_expense_audit
       where booking_id = $1
       order by created_at desc
       limit $2`,
      [bookingId, Math.max(1, Math.min(limit, 500))],
    );
    return result.rows.map(toAuditRecord);
  }

  async create(
    bookingId: string,
    input: CreateBookingExpenseInput,
    performedBy: string | null = null,
  ): Promise<BookingExpenseRecord> {
    await this.ensureReady();
    const amountRounded = Math.round(input.amount * 100) / 100;
    const currency = input.currency ?? "USD";
    const auditPayload = {
      expenseDate: input.expenseDate,
      category: input.category,
      amount: amountRounded,
      currency,
      vendor: input.vendor ?? null,
      notes: input.notes ?? null,
      receiptUrl: input.receiptUrl ?? null,
    };

    const result = await this.db.query<BookingExpenseRow>(
      `with inserted as (
         insert into public.booking_expenses
           (booking_id, expense_date, category, amount, currency, vendor, notes, receipt_url)
         values
           ($1, $2::date, $3, $4::numeric(12,2), $5, $6, $7, $8)
         returning *
       ),
       audit as (
         insert into public.booking_expense_audit
           (booking_id, expense_id, action, changed_fields, performed_by)
         select $1, inserted.id, 'created', $9::jsonb, $10
         from inserted
       )
       select * from inserted`,
      [
        bookingId,
        input.expenseDate,
        input.category,
        amountRounded,
        currency,
        input.vendor ?? null,
        input.notes ?? null,
        input.receiptUrl ?? null,
        JSON.stringify(auditPayload),
        performedBy,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Failed to create expense");
    return toExpenseRecord(row);
  }

  async delete(bookingId: string, expenseId: string, performedBy: string | null = null): Promise<boolean> {
    await this.ensureReady();
    const result = await this.db.query<{ id: string }>(
      `with deleted as (
         delete from public.booking_expenses
         where id = $1 and booking_id = $2
         returning id
       ),
       audit as (
         insert into public.booking_expense_audit
           (booking_id, expense_id, action, changed_fields, performed_by)
         select $2, deleted.id, 'deleted', '{}'::jsonb, $3
         from deleted
       )
       select id from deleted`,
      [expenseId, bookingId, performedBy],
    );
    return Number(result.rowCount ?? 0) > 0;
  }
}
