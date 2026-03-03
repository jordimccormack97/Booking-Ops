import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createBookingExpense,
  deleteBookingExpense,
  getBookingById,
  getBookingExpenses,
  type BookingEventRecord,
  type BookingExpense,
  type BookingExpenseAudit,
} from "@/lib/api";

function value<T>(row: Record<string, unknown>, camel: string, snake: string): T | undefined {
  const v = row[camel];
  if (v !== undefined) return v as T;
  return row[snake] as T | undefined;
}

function formatCompactDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "2-digit" }).format(date);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function BookingDetailsPage() {
  const params = useParams<{ id: string }>();
  const bookingId = params.id ?? "";
  const [booking, setBooking] = useState<BookingEventRecord | null>(null);
  const [expenses, setExpenses] = useState<BookingExpense[]>([]);
  const [audit, setAudit] = useState<BookingExpenseAudit[]>([]);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);
  const [form, setForm] = useState({
    expenseDate: todayIsoDate(),
    category: "",
    amount: "",
    vendor: "",
    notes: "",
    receiptUrl: "",
  });

  async function load() {
    if (!bookingId) return;
    setMessage("");
    try {
      const [bookingRow, payload] = await Promise.all([getBookingById(bookingId), getBookingExpenses(bookingId)]);
      setBooking(bookingRow);
      setExpenses(payload.expenses ?? []);
      setAudit(payload.audit ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void load();
  }, [bookingId]);

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, expense) => sum + (typeof expense.amount === "number" ? expense.amount : 0), 0),
    [expenses],
  );

  async function onAddExpense() {
    if (!bookingId) return;
    const amount = Number(form.amount);
    if (!form.category.trim()) {
      setMessage("Category is required");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setMessage("Amount must be a non-negative number");
      return;
    }

    setIsSaving(true);
    setMessage("");
    try {
      await createBookingExpense(bookingId, {
        expenseDate: form.expenseDate,
        category: form.category.trim(),
        amount,
        vendor: form.vendor.trim(),
        notes: form.notes.trim(),
        receiptUrl: form.receiptUrl.trim(),
      });
      setForm((current) => ({ ...current, category: "", amount: "", vendor: "", notes: "", receiptUrl: "" }));
      await load();
      setMessage("Expense saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function onDeleteExpense(expenseId: string) {
    if (!bookingId) return;
    const ok = window.confirm("Delete this expense?");
    if (!ok) return;

    setDeletingExpenseId(expenseId);
    setMessage("");
    try {
      await deleteBookingExpense(bookingId, expenseId);
      await load();
      setMessage("Expense deleted");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingExpenseId(null);
    }
  }

  const bookingTitle = useMemo(() => {
    if (!booking) return "Booking";
    const row = booking as unknown as Record<string, unknown>;
    return (
      value<string>(row, "brandOrClient", "brand_or_client") ??
      value<string>(row, "title", "title") ??
      value<string>(row, "subject", "subject") ??
      "Booking"
    );
  }, [booking]);

  const dateReceived = booking
    ? value<string>(booking as unknown as Record<string, unknown>, "dateReceived", "date_received")
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Booking Details</h1>
        <Button asChild type="button" variant="outline">
          <Link to="/bookings">Back to Bookings</Link>
        </Button>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{bookingTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="font-medium">Date received:</span> {formatCompactDateTime(dateReceived)}
            </p>
            <p>
              <span className="font-medium">Event:</span>{" "}
              {booking
                ? value<string>(booking as unknown as Record<string, unknown>, "eventDateText", "event_date_text") ??
                  "-"
                : "-"}
            </p>
            <p>
              <span className="font-medium">Location:</span>{" "}
              {booking ? value<string>(booking as unknown as Record<string, unknown>, "location", "location") ?? "TBD" : "TBD"}
            </p>
            <p>
              <span className="font-medium">Rate quoted:</span>{" "}
              {booking
                ? (() => {
                    const rate = value<number>(booking as unknown as Record<string, unknown>, "rateQuoted", "rate_quoted");
                    return typeof rate === "number" ? `$${rate.toLocaleString()}` : "Needs review";
                  })()
                : "-"}
            </p>
            <p>
              <span className="font-medium">Total expenses:</span> ${totalExpenses.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add Expense</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="expense_date">Date</Label>
                <Input
                  id="expense_date"
                  onChange={(event) => setForm((current) => ({ ...current, expenseDate: event.target.value }))}
                  type="date"
                  value={form.expenseDate}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="expense_category">Category</Label>
                <Input
                  id="expense_category"
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                  placeholder="Travel, wardrobe, meals..."
                  value={form.category}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="expense_amount">Amount (USD)</Label>
                <Input
                  id="expense_amount"
                  inputMode="decimal"
                  onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="0.00"
                  value={form.amount}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="expense_vendor">Vendor</Label>
                <Input
                  id="expense_vendor"
                  onChange={(event) => setForm((current) => ({ ...current, vendor: event.target.value }))}
                  placeholder="Uber, Delta, Amazon..."
                  value={form.vendor}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="expense_notes">Notes</Label>
                <Input
                  id="expense_notes"
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Why this expense was needed"
                  value={form.notes}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="expense_receipt_url">Receipt URL (optional)</Label>
                <Input
                  id="expense_receipt_url"
                  onChange={(event) => setForm((current) => ({ ...current, receiptUrl: event.target.value }))}
                  placeholder="https://..."
                  value={form.receiptUrl}
                />
              </div>
            </div>
            <div className="mt-4">
              <Button disabled={isSaving} onClick={() => void onAddExpense()} type="button">
                {isSaving ? "Saving..." : "Save expense"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground" colSpan={5}>
                        No expenses logged yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    expenses.map((expense) => (
                      <TableRow key={expense.id}>
                        <TableCell>{formatDateOnly(expense.expenseDate)}</TableCell>
                        <TableCell>{expense.category}</TableCell>
                        <TableCell>{expense.vendor ?? "-"}</TableCell>
                        <TableCell>${expense.amount.toLocaleString()}</TableCell>
                        <TableCell>
                          <Button
                            disabled={deletingExpenseId === expense.id}
                            onClick={() => void onDeleteExpense(expense.id)}
                            size="sm"
                            type="button"
                            variant="destructive"
                          >
                            {deletingExpenseId === expense.id ? "Deleting..." : "Delete"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audit History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 space-y-2 overflow-auto">
              {audit.length === 0 ? (
                <p className="text-sm text-muted-foreground">No audit records yet.</p>
              ) : (
                audit.map((entry) => (
                  <div className="rounded-md border p-2 text-xs" key={entry.id}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium uppercase">{entry.action}</span>
                      <span>{formatCompactDateTime(entry.createdAt)}</span>
                    </div>
                    {entry.expenseId ? <p>Expense ID: {entry.expenseId}</p> : null}
                    {Object.keys(entry.changedFields ?? {}).length > 0 ? (
                      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                        {JSON.stringify(entry.changedFields, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {message ? <p className="mt-4 text-sm">{message}</p> : null}
    </main>
  );
}
