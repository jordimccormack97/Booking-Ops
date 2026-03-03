import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBookings, type BookingEventRecord } from "@/lib/api";

function value<T>(row: Record<string, unknown>, camel: string, snake: string): T | undefined {
  const v = row[camel];
  if (v !== undefined) return v as T;
  return row[snake] as T | undefined;
}

function normalizeStatus(input: unknown): "request" | "needs_confirmation" | "confirmed" | "follow_up" | "canceled" {
  const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (raw === "confirmed" || raw === "approved" || raw === "booked" || raw === "confirmed_booking") return "confirmed";
  if (raw === "canceled" || raw === "cancelled" || raw === "denied" || raw === "declined") return "canceled";
  if (raw === "needs_confirmation" || raw === "hold" || raw === "pending_confirmation") return "needs_confirmation";
  if (raw === "follow_up" || raw === "followup") return "follow_up";
  return "request";
}

function parseEventDateToken(value: string | null | undefined): Date | null {
  if (!value) return null;
  const text = value.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const yearRaw = slash[3];
    const year = yearRaw ? (yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw)) : new Date().getFullYear();
    return new Date(year, Number(slash[1]) - 1, Number(slash[2]));
  }
  const monthMatch = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/,
  );
  if (!monthMatch) return null;
  const monthMap: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  return new Date(new Date().getFullYear(), monthMap[monthMatch[1]], Number(monthMatch[2]));
}

function isInCurrentMonth(date: Date | null) {
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function getEventDate(booking: BookingEventRecord) {
  const row = booking as unknown as Record<string, unknown>;
  const eventDateText = value<string>(row, "eventDateText", "event_date_text");
  const parsedEvent = parseEventDateToken(eventDateText);
  if (parsedEvent) return parsedEvent;
  const received = value<string>(row, "dateReceived", "date_received");
  if (!received) return null;
  const parsedReceived = new Date(received);
  return Number.isNaN(parsedReceived.getTime()) ? null : parsedReceived;
}

function getRate(booking: BookingEventRecord) {
  const row = booking as unknown as Record<string, unknown>;
  const rate = value<number>(row, "rateQuoted", "rate_quoted");
  return typeof rate === "number" && Number.isFinite(rate) ? rate : 0;
}

function bookingLabel(booking: BookingEventRecord) {
  const row = booking as unknown as Record<string, unknown>;
  return (
    value<string>(row, "brandOrClient", "brand_or_client") ??
    value<string>(row, "title", "title") ??
    value<string>(row, "subject", "subject") ??
    "booking"
  );
}

function normalizeLabel(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasNearbyConfirmedMatch(booking: BookingEventRecord, allRows: BookingEventRecord[]) {
  const status = normalizeStatus(
    (booking as unknown as Record<string, unknown>).bookingStatus ??
      (booking as unknown as Record<string, unknown>).booking_status ??
      (booking as unknown as Record<string, unknown>).status,
  );
  if (status === "confirmed") return false;
  const label = normalizeLabel(bookingLabel(booking));
  if (!label) return false;
  const date = getEventDate(booking);
  if (!date) return false;

  return allRows.some((candidate) => {
    const candidateStatus = normalizeStatus(
      (candidate as unknown as Record<string, unknown>).bookingStatus ??
        (candidate as unknown as Record<string, unknown>).booking_status ??
        (candidate as unknown as Record<string, unknown>).status,
    );
    if (candidateStatus !== "confirmed") return false;
    const candidateLabel = normalizeLabel(bookingLabel(candidate));
    if (candidateLabel !== label) return false;
    const candidateDate = getEventDate(candidate);
    if (!candidateDate) return false;
    const dayMs = 24 * 60 * 60 * 1000;
    return Math.abs(candidateDate.getTime() - date.getTime()) <= 2 * dayMs;
  });
}

function hasDeniedAvailabilitySignal(booking: BookingEventRecord) {
  const status = normalizeStatus(
    (booking as unknown as Record<string, unknown>).bookingStatus ??
      (booking as unknown as Record<string, unknown>).booking_status ??
      (booking as unknown as Record<string, unknown>).status,
  );
  if (status === "canceled") return true;
  const notesRaw =
    (booking as unknown as Record<string, unknown>).notes ??
    (booking as unknown as Record<string, unknown>).notes_json ??
    [];
  const notes = Array.isArray(notesRaw)
    ? notesRaw.map((item) => String(item)).join(" | ").toLowerCase()
    : String(notesRaw ?? "").toLowerCase();
  return (
    /\btalent response detected.*:\s*no\b/i.test(notes) ||
    /\bnot available\b/i.test(notes) ||
    /\bunavailable\b/i.test(notes) ||
    /\bdeclined?\b/i.test(notes)
  );
}

function isNeedsReview(booking: BookingEventRecord) {
  const row = booking as unknown as Record<string, unknown>;
  return (
    value<number | null>(row, "rateQuoted", "rate_quoted") === null ||
    booking.calendarStatus === "needs_details" ||
    row.calendar_status === "needs_details"
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BookingEventRecord[]>([]);
  const [message, setMessage] = useState("");

  function cardNavProps(target: string) {
    return {
      className: "cursor-pointer",
      onClick: () => navigate(target),
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          navigate(target);
        }
      },
      role: "button" as const,
      tabIndex: 0,
    };
  }

  useEffect(() => {
    async function load() {
      try {
        const data = await getBookings();
        setRows(Array.isArray(data) ? data : []);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
    void load();
  }, []);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
      }).format(new Date()),
    [],
  );

  const stats = useMemo(() => {
    let confirmedRevenueThisMonth = 0;
    let missedRevenueThisMonth = 0;
    let pipelineThisMonth = 0;
    let confirmedCountThisMonth = 0;
    let missedCountThisMonth = 0;

    for (const row of rows) {
      const status = normalizeStatus(
        (row as unknown as Record<string, unknown>).bookingStatus ??
          (row as unknown as Record<string, unknown>).booking_status ??
          (row as unknown as Record<string, unknown>).status,
      );
      const eventDate = getEventDate(row);
      if (!isInCurrentMonth(eventDate)) continue;
      const rate = getRate(row);

      if (status === "confirmed") {
        confirmedRevenueThisMonth += rate;
        confirmedCountThisMonth += 1;
      } else if (hasDeniedAvailabilitySignal(row)) {
        missedRevenueThisMonth += rate;
        missedCountThisMonth += 1;
      } else {
        if (!hasNearbyConfirmedMatch(row, rows)) {
          pipelineThisMonth += rate;
        }
      }
    }

    return {
      confirmedRevenueThisMonth,
      missedRevenueThisMonth,
      pipelineThisMonth,
      needsReview: rows.filter((row) => isNeedsReview(row)).length,
      confirmedCountThisMonth,
      missedCountThisMonth,
    };
  }, [rows]);

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-8">
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
          <p className="text-muted-foreground">Workflow dashboard for {monthLabel}.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/earnings">Open Earnings</Link>
          </Button>
          <Button asChild>
            <Link to="/bookings">Open Bookings</Link>
          </Button>
        </div>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card {...cardNavProps("/earnings?view=confirmed&period=current_month")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Total Earnings This Month</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">${stats.confirmedRevenueThisMonth.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{stats.confirmedCountThisMonth} confirmed jobs</p>
          </CardContent>
        </Card>
        <Card {...cardNavProps("/earnings?view=missed&period=current_month")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Total Missed Earnings This Month</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">${stats.missedRevenueThisMonth.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{stats.missedCountThisMonth} missed jobs</p>
          </CardContent>
        </Card>
        <Card {...cardNavProps("/earnings?view=unconfirmed&period=current_month")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pipeline This Month</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">${stats.pipelineThisMonth.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Unconfirmed requests</p>
          </CardContent>
        </Card>
        <Card {...cardNavProps("/earnings?view=all&period=current_month&reviewOnly=1")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Needs Review</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{stats.needsReview}</p>
            <p className="mt-2 text-xs text-muted-foreground">Open review rows</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Sync + Classify</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Run Gmail sync, then classify into booking request, partnership, confirmed, past, or missed.</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/earnings">Go to Earnings Sync</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Review + Resolve</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Open review items, merge duplicates, and mark denied/missed rows for clean financial reporting.</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/earnings?view=review">Go to Needs Review</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Track Earnings + Expenses</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Use bookings detail pages to log expenses and keep audit history for taxes and reconciliation.</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/bookings">Go to Bookings</Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {message ? <p className="mt-4 text-sm text-destructive">{message}</p> : null}
    </main>
  );
}
