import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBookings, type BookingEventRecord } from "@/lib/api";

function value<T>(row: Record<string, unknown>, camel: string, snake: string): T | undefined {
  const v = row[camel];
  if (v !== undefined) return v as T;
  return row[snake] as T | undefined;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function parseEventDate(booking: BookingEventRecord): Date | null {
  const row = booking as unknown as Record<string, unknown>;
  const eventDateText = value<string>(row, "eventDateText", "event_date_text") ?? "";
  const dateReceived = value<string>(row, "dateReceived", "date_received") ?? null;
  const fallbackYear = dateReceived ? new Date(dateReceived).getFullYear() : new Date().getFullYear();

  const normalized = eventDateText.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  const slash = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/);
  if (slash) {
    const month = Number(slash[1]) - 1;
    const day = Number(slash[2]);
    const parsed = new Date(fallbackYear, month, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const monthText = normalized.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})\b/,
  );
  if (monthText) {
    const parsed = new Date(`${monthText[1]} ${monthText[2]}, ${fallbackYear}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (dateReceived) {
    const parsed = new Date(dateReceived);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function eventLabel(booking: BookingEventRecord) {
  const row = booking as unknown as Record<string, unknown>;
  const brand = value<string>(row, "brandOrClient", "brand_or_client");
  const title = value<string>(row, "title", "title");
  const subject = value<string>(row, "subject", "subject");
  return brand ?? title ?? subject ?? "Booking";
}

function normalizeLabel(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function CalendarPage() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [bookings, setBookings] = useState<BookingEventRecord[]>([]);
  const [message, setMessage] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "confirmed" | "unconfirmed" | "denied" | "missed">("all");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);

  function normalizeBookingStatus(
    value: unknown,
  ): "request" | "needs_confirmation" | "confirmed" | "follow_up" | "canceled" {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (raw === "confirmed" || raw === "approved" || raw === "booked" || raw === "confirmed_booking") {
      return "confirmed";
    }
    if (raw === "canceled" || raw === "cancelled" || raw === "denied" || raw === "declined") {
      return "canceled";
    }
    if (raw === "needs_confirmation" || raw === "hold" || raw === "pending_confirmation") {
      return "needs_confirmation";
    }
    if (raw === "follow_up" || raw === "followup") {
      return "follow_up";
    }
    return "request";
  }

  function getBookingStatus(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    return normalizeBookingStatus(row.bookingStatus ?? row.booking_status ?? row.status ?? null);
  }

  function isPastEvent(booking: BookingEventRecord) {
    const date = parseEventDate(booking);
    if (!date) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return date < today;
  }

  function isNeedsReviewBooking(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    return (
      row.rateQuoted === null ||
      row.rate_quoted === null ||
      booking.calendarStatus === "needs_details" ||
      row.calendar_status === "needs_details"
    );
  }

  function hasNoResponseSignal(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const notesRaw = (row.notes ?? row.notes_json ?? []) as unknown;
    const notes = Array.isArray(notesRaw)
      ? notesRaw.map((item) => String(item))
      : typeof notesRaw === "string"
        ? [notesRaw]
        : [];
    const combined = notes.join(" | ").toLowerCase();
    return (
      /\btalent response detected.*:\s*no\b/i.test(combined) ||
      /\bnot available\b/i.test(combined) ||
      /\bunavailable\b/i.test(combined) ||
      /\bdeclined?\b/i.test(combined)
    );
  }

  function hasDeniedAvailabilitySignal(booking: BookingEventRecord) {
    if (getBookingStatus(booking) === "canceled") return true;
    if (hasNoResponseSignal(booking)) return true;
    return false;
  }

  function isMissedBooking(booking: BookingEventRecord) {
    return hasDeniedAvailabilitySignal(booking);
  }

  function hasNearbyConfirmedMatch(booking: BookingEventRecord, allRows: BookingEventRecord[]) {
    const status = getBookingStatus(booking);
    if (status === "confirmed") return false;
    const bookingDate = parseEventDate(booking);
    if (!bookingDate) return false;
    const bookingLabel = normalizeLabel(eventLabel(booking));
    if (!bookingLabel) return false;

    return allRows.some((candidate) => {
      if (getBookingStatus(candidate) !== "confirmed") return false;
      const candidateLabel = normalizeLabel(eventLabel(candidate));
      if (candidateLabel !== bookingLabel) return false;
      const candidateDate = parseEventDate(candidate);
      if (!candidateDate) return false;
      const dayMs = 24 * 60 * 60 * 1000;
      return Math.abs(candidateDate.getTime() - bookingDate.getTime()) <= 2 * dayMs;
    });
  }

  const filteredBookings = useMemo(() => {
    let rows: BookingEventRecord[] = [];
    if (viewMode === "all") {
      rows = bookings;
    } else if (viewMode === "confirmed") {
      rows = bookings.filter((booking) => getBookingStatus(booking) === "confirmed");
    } else if (viewMode === "denied") {
      rows = bookings.filter((booking) => hasDeniedAvailabilitySignal(booking));
    } else if (viewMode === "missed") {
      rows = bookings.filter((booking) => isMissedBooking(booking));
    } else {
      rows = bookings.filter((booking) => {
        const status = getBookingStatus(booking);
        const isUnconfirmed = status === "request" || status === "needs_confirmation" || status === "follow_up";
        if (!isUnconfirmed) return false;
        return !hasNearbyConfirmedMatch(booking, bookings);
      });
    }
    if (!needsReviewOnly) return rows;
    return rows.filter((booking) => isNeedsReviewBooking(booking));
  }, [bookings, viewMode, needsReviewOnly]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getBookings();
        if (!cancelled) setBookings(Array.isArray(rows) ? rows : []);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!cancelled) setMessage(`Failed to load bookings: ${text}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const eventsByDate = useMemo(() => {
    const mapped = new Map<string, BookingEventRecord[]>();
    for (const booking of filteredBookings) {
      const date = parseEventDate(booking);
      if (!date) continue;
      const key = toIsoDate(date);
      const list = mapped.get(key) ?? [];
      list.push(booking);
      mapped.set(key, list);
    }
    return mapped;
  }, [filteredBookings]);

  const days = useMemo(() => {
    const monthStart = startOfMonth(cursor);
    const firstDayOffset = monthStart.getDay();
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - firstDayOffset);
    return Array.from({ length: 42 }, (_, idx) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + idx);
      return date;
    });
  }, [cursor]);

  const monthLabel = cursor.toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Calendar</h1>
        <div className="flex gap-2">
          <Button onClick={() => setCursor((current) => addMonths(current, -1))} type="button" variant="outline">
            Prev
          </Button>
          <Button onClick={() => setCursor(startOfMonth(new Date()))} type="button" variant="outline">
            Today
          </Button>
          <Button onClick={() => setCursor((current) => addMonths(current, 1))} type="button" variant="outline">
            Next
          </Button>
        </div>
      </header>

      <section className="mb-4">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setViewMode("all");
              setNeedsReviewOnly(false);
            }}
            size="sm"
            type="button"
            variant={viewMode === "all" && !needsReviewOnly ? "default" : "outline"}
          >
            All
          </Button>
          <Button
            onClick={() => {
              setViewMode("confirmed");
              setNeedsReviewOnly(false);
            }}
            size="sm"
            type="button"
            variant={viewMode === "confirmed" && !needsReviewOnly ? "default" : "outline"}
          >
            Confirmed
          </Button>
          <Button
            onClick={() => {
              setViewMode("unconfirmed");
              setNeedsReviewOnly(false);
            }}
            size="sm"
            type="button"
            variant={viewMode === "unconfirmed" && !needsReviewOnly ? "default" : "outline"}
          >
            Unconfirmed
          </Button>
          <Button
            onClick={() => {
              setViewMode("denied");
              setNeedsReviewOnly(false);
            }}
            size="sm"
            type="button"
            variant={viewMode === "denied" && !needsReviewOnly ? "default" : "outline"}
          >
            Denied
          </Button>
          <Button
            onClick={() => {
              setViewMode("missed");
              setNeedsReviewOnly(false);
            }}
            size="sm"
            type="button"
            variant={viewMode === "missed" && !needsReviewOnly ? "default" : "outline"}
          >
            Missed
          </Button>
          <Button
            onClick={() => {
              setViewMode("all");
              setNeedsReviewOnly(true);
            }}
            size="sm"
            type="button"
            variant={needsReviewOnly ? "default" : "outline"}
          >
            Needs Review
          </Button>
          <Badge variant="outline">Rows: {filteredBookings.length}</Badge>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{monthLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-2 grid grid-cols-7 gap-2 text-xs text-muted-foreground">
            <div>Sun</div>
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div>Sat</div>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {days.map((day) => {
              const key = toIsoDate(day);
              const dayEvents = eventsByDate.get(key) ?? [];
              const isCurrentMonth = day.getMonth() === cursor.getMonth();

              return (
                <div className={`min-h-28 rounded-md border p-2 ${isCurrentMonth ? "" : "opacity-45"}`} key={key}>
                  <div className="mb-2 text-xs font-medium">{day.getDate()}</div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map((event) => (
                      <Link
                        className="block rounded bg-muted px-2 py-1 text-xs hover:bg-muted/80 hover:underline"
                        key={event.id}
                        to={`/bookings/${event.id}`}
                      >
                        {eventLabel(event)}
                      </Link>
                    ))}
                    {dayEvents.length > 3 ? (
                      <Badge className="text-[10px]" variant="outline">
                        +{dayEvents.length - 3} more
                      </Badge>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {message ? <p className="mt-4 text-sm text-destructive">{message}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
