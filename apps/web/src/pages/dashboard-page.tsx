import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteBookingRow,
  getApiBaseUrl,
  getBookings,
  gmailProfile,
  gmailSyncDirectionsusa,
  updateBookingStatus,
  type BookingEventRecord,
} from "@/lib/api";

function value<T>(row: Record<string, unknown>, camel: string, snake: string): T | undefined {
  const v = row[camel];
  if (v !== undefined) return v as T;
  return row[snake] as T | undefined;
}

function badgeLabel(status: BookingEventRecord["calendarStatus"]) {
  if (status === "on_calendar") return "On calendar";
  if (status === "needs_auth") return "Needs calendar auth";
  if (status === "needs_details") return "Needs details";
  return "Needs details";
}

function badgeVariant(status: BookingEventRecord["calendarStatus"]): "default" | "outline" | "secondary" {
  if (status === "on_calendar") return "default";
  if (status === "needs_auth") return "secondary";
  return "outline";
}

function eventText(booking: BookingEventRecord) {
  const row = booking as unknown as Record<string, unknown>;
  const date = (value<string>(row, "eventDateText", "event_date_text") ?? "-").toString();
  const start = (value<string>(row, "startTimeText", "start_time_text") ?? "").toString();
  const rawEnd = value<string>(row, "endTimeText", "end_time_text");
  const end = rawEnd ? ` - ${rawEnd}` : "";
  return `${date}${start ? ` ${start}` : ""}${end}`;
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

function normalizeLabel(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function DashboardPage() {
  const [bookings, setBookings] = useState<BookingEventRecord[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [gmailStatus, setGmailStatus] = useState("not connected");
  const [isBusy, setIsBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"all" | "confirmed" | "unconfirmed" | "denied" | "missed">("unconfirmed");
  const [periodMode, setPeriodMode] = useState<"all" | "current_month">("all");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [message, setMessage] = useState("");

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
    return normalizeBookingStatus(
      row.bookingStatus ??
        row.booking_status ??
        row.status ??
        null,
    );
  }

  function parseEventDateToken(value: string | null | undefined) {
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

  function isPastEvent(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const parsed = parseEventDateToken(
      value<string>(row, "eventDateText", "event_date_text") ??
        value<string>(row, "dateReceived", "date_received") ??
        null,
    );
    if (!parsed) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return parsed < today;
  }

  function isCurrentMonthEvent(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const parsed =
      parseEventDateToken(value<string>(row, "eventDateText", "event_date_text") ?? null) ??
      (() => {
        const raw = value<string>(row, "dateReceived", "date_received");
        if (!raw) return null;
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? null : date;
      })();
    if (!parsed) return false;
    const now = new Date();
    return parsed.getFullYear() === now.getFullYear() && parsed.getMonth() === now.getMonth();
  }

  function hasDeniedAvailabilitySignal(booking: BookingEventRecord) {
    const status = getBookingStatus(booking);
    if (status === "canceled") return true;
    const row = booking as unknown as Record<string, unknown>;
    const notesRaw = (row.notes ?? row.notes_json ?? []) as unknown;
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

  function isMissedBooking(booking: BookingEventRecord) {
    return hasDeniedAvailabilitySignal(booking);
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

  function comparableEventDate(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const eventParsed = parseEventDateToken(value<string>(row, "eventDateText", "event_date_text") ?? null);
    if (eventParsed) return eventParsed;
    const received = value<string>(row, "dateReceived", "date_received");
    if (!received) return null;
    const parsed = new Date(received);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function compareByClosestToToday(a: BookingEventRecord, b: BookingEventRecord) {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const aDate = comparableEventDate(a);
    const bDate = comparableEventDate(b);
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;
    const aDelta = Math.abs(aDate.getTime() - todayStart);
    const bDelta = Math.abs(bDate.getTime() - todayStart);
    if (aDelta !== bDelta) return aDelta - bDelta;
    return aDate.getTime() - bDate.getTime();
  }

  function hasNearbyConfirmedMatch(booking: BookingEventRecord, allRows: BookingEventRecord[]) {
    if (getBookingStatus(booking) === "confirmed") return false;
    const label = normalizeLabel(bookingLabel(booking));
    if (!label) return false;
    const date = comparableEventDate(booking);
    if (!date) return false;

    return allRows.some((candidate) => {
      if (getBookingStatus(candidate) !== "confirmed") return false;
      const candidateLabel = normalizeLabel(bookingLabel(candidate));
      if (candidateLabel !== label) return false;
      const candidateDate = comparableEventDate(candidate);
      if (!candidateDate) return false;
      const dayMs = 24 * 60 * 60 * 1000;
      return Math.abs(candidateDate.getTime() - date.getTime()) <= 2 * dayMs;
    });
  }

  function isPipelineBooking(booking: BookingEventRecord, allRows: BookingEventRecord[]) {
    const status = getBookingStatus(booking);
    if (status === "confirmed" || status === "canceled") return false;
    if (isPastEvent(booking)) return false;
    if (hasNearbyConfirmedMatch(booking, allRows)) return false;
    return true;
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

  const filtered = useMemo(() => {
    let rows: BookingEventRecord[];
    if (viewMode === "all") {
      rows = bookings;
    } else if (viewMode === "confirmed") {
      rows = bookings.filter((booking) => getBookingStatus(booking) === "confirmed");
    } else if (viewMode === "denied") {
      rows = bookings.filter((booking) => hasDeniedAvailabilitySignal(booking));
    } else if (viewMode === "missed") {
      rows = bookings.filter((booking) => isMissedBooking(booking));
    } else {
      rows = bookings.filter((booking) => isPipelineBooking(booking, bookings));
    }
    if (periodMode === "current_month") {
      rows = rows.filter((booking) => isCurrentMonthEvent(booking));
    }
    if (needsReviewOnly) {
      rows = rows.filter((booking) => isNeedsReviewBooking(booking));
    }
    return [...rows].sort(compareByClosestToToday);
  }, [bookings, viewMode, periodMode, needsReviewOnly]);

  function showBucket(mode: "all" | "confirmed" | "unconfirmed" | "denied" | "missed", reviewOnly = false) {
    setViewMode(mode);
    setNeedsReviewOnly(reviewOnly);
    const next = new URLSearchParams(searchParams);
    next.set("view", mode);
    next.set("period", periodMode);
    if (reviewOnly) next.set("reviewOnly", "1");
    else next.delete("reviewOnly");
    setSearchParams(next, { replace: true });
  }

  function setPeriod(period: "all" | "current_month") {
    setPeriodMode(period);
    const next = new URLSearchParams(searchParams);
    next.set("view", viewMode);
    next.set("period", period);
    if (needsReviewOnly) next.set("reviewOnly", "1");
    else next.delete("reviewOnly");
    setSearchParams(next, { replace: true });
  }

  const stats = useMemo(() => {
    const totalRows = bookings.length;
    const confirmedRevenue = bookings.reduce((sum, booking) => {
      if (getBookingStatus(booking) !== "confirmed") return sum;
      const row = booking as unknown as Record<string, unknown>;
      const rate = value<number>(row, "rateQuoted", "rate_quoted");
      return sum + (typeof rate === "number" && Number.isFinite(rate) ? rate : 0);
    }, 0);
    const unconfirmedRevenue = bookings.reduce((sum, booking) => {
      if (!isPipelineBooking(booking, bookings)) return sum;
      const row = booking as unknown as Record<string, unknown>;
      const rate = value<number>(row, "rateQuoted", "rate_quoted");
      return sum + (typeof rate === "number" && Number.isFinite(rate) ? rate : 0);
    }, 0);
    const totalForecast = confirmedRevenue + unconfirmedRevenue;

    const confirmedCount = bookings.filter((booking) => getBookingStatus(booking) === "confirmed").length;
    const unconfirmedCount = bookings.filter((booking) => isPipelineBooking(booking, bookings)).length;
    const needsReview = bookings.filter((booking) => isNeedsReviewBooking(booking)).length;
    return {
      totalRows,
      confirmedRevenue,
      unconfirmedRevenue,
      totalForecast,
      confirmedCount,
      unconfirmedCount,
      needsReview,
    };
  }, [bookings]);

  async function loadBookings() {
    try {
      const data = await getBookings();
      console.log("[Dashboard] Bookings loaded:", { count: Array.isArray(data) ? data.length : 0, data });
      setBookings(Array.isArray(data) ? data : []);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[Dashboard] Failed to load bookings:", msg);
      setMessage(`Error loading bookings: ${msg}`);
    }
  }

  async function loadGmailProfile() {
    try {
      const profile = await gmailProfile();
      if (profile.connected && profile.email) {
        setGmailStatus(profile.email);
        return;
      }
      if (profile.error && profile.error.trim().length > 0) {
        setGmailStatus(`not connected (${profile.error})`);
        return;
      }
      setGmailStatus("not connected");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[Dashboard] Failed to load Gmail profile:", msg);
      setGmailStatus(`Error: ${msg}`);
    }
  }

  useEffect(() => {
    const requestedView = searchParams.get("view");
    const requestedPeriod = searchParams.get("period");
    const requestedReview = searchParams.get("reviewOnly");
    if (
      requestedView === "all" ||
      requestedView === "confirmed" ||
      requestedView === "unconfirmed" ||
      requestedView === "denied" ||
      requestedView === "missed"
    ) {
      setViewMode(requestedView);
    } else if (requestedView === "review") {
      setViewMode("all");
      setNeedsReviewOnly(true);
    }
    if (requestedReview === "1") {
      setNeedsReviewOnly(true);
    } else if (requestedView !== "review") {
      setNeedsReviewOnly(false);
    }
    if (requestedPeriod === "current_month") {
      setPeriodMode("current_month");
    } else {
      setPeriodMode("all");
    }
  }, [searchParams]);

  useEffect(() => {
    void loadBookings();
    void loadGmailProfile();
  }, []);

  async function onSyncDirectionsusa() {
    setIsBusy(true);
    setMessage("");
    try {
      const summary = await gmailSyncDirectionsusa();
      await loadBookings();
      await loadGmailProfile();
      setMessage(
        `Sync complete: ${summary.added} added, ${summary.skipped} skipped, ${summary.errors} errors`,
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unable to sync";
      setMessage(`DirectionsUSA sync failed: ${text}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function onDeleteBooking(id: string) {
    const ok = window.confirm("Delete this booking row?");
    if (!ok) return;

    setDeletingId(id);
    setMessage("");
    try {
      await deleteBookingRow(id);
      setBookings((current) => current.filter((row) => row.id !== id));
      setMessage("Booking row deleted");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unable to delete row";
      setMessage(`Delete failed: ${text}`);
    } finally {
      setDeletingId(null);
    }
  }

  async function onUpdateBookingStatus(
    id: string,
    bookingStatus: "request" | "needs_confirmation" | "confirmed" | "follow_up" | "canceled",
  ) {
    setUpdatingStatusId(id);
    setMessage("");
    try {
      await updateBookingStatus(id, bookingStatus);
      setBookings((current) =>
        current.map((row) => (row.id === id ? { ...row, bookingStatus } : row)),
      );
      setMessage("Booking status updated");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unable to update status";
      setMessage(`Status update failed: ${text}`);
    } finally {
      setUpdatingStatusId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-8">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Earnings</h1>
          <p className="text-muted-foreground">Revenue and booking pipeline synced from Gmail.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={gmailStatus === "not connected" ? "secondary" : "default"}>
            Gmail: {gmailStatus}
          </Badge>
          <Badge variant="outline">Rows: {filtered.length}</Badge>
        </div>
      </header>

      <section className="mb-4">
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Sync + Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-end gap-2 lg:col-span-4">
                <Button type="button" variant="outline" onClick={() => void loadBookings()}>
                  Refresh
                </Button>
                <Button
                  onClick={() => setPeriod("all")}
                  size="sm"
                  type="button"
                  variant={periodMode === "all" ? "default" : "outline"}
                >
                  All Time
                </Button>
                <Button
                  onClick={() => setPeriod("current_month")}
                  size="sm"
                  type="button"
                  variant={periodMode === "current_month" ? "default" : "outline"}
                >
                  This Month
                </Button>
                <Button
                  onClick={() => showBucket("confirmed")}
                  size="sm"
                  type="button"
                  variant={viewMode === "confirmed" ? "default" : "outline"}
                >
                  Confirmed
                </Button>
                <Button
                  onClick={() => showBucket("unconfirmed")}
                  size="sm"
                  type="button"
                  variant={viewMode === "unconfirmed" ? "default" : "outline"}
                >
                  Unconfirmed
                </Button>
                <Button
                  onClick={() => showBucket("denied")}
                  size="sm"
                  type="button"
                  variant={viewMode === "denied" ? "default" : "outline"}
                >
                  Denied
                </Button>
                <Button
                  onClick={() => showBucket("missed")}
                  size="sm"
                  type="button"
                  variant={viewMode === "missed" ? "default" : "outline"}
                >
                  Missed
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={isBusy} onClick={onSyncDirectionsusa} type="button" variant="secondary">
                Sync Gmail
              </Button>
              <Button disabled={isBusy} onClick={onSyncDirectionsusa} type="button">
                Sync DirectionsUSA
              </Button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              API base URL: <code>{getApiBaseUrl()}</code>
            </p>
            {message ? <p className="mt-2 text-sm">{message}</p> : null}
          </CardContent>
        </Card>

        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            className={`cursor-pointer transition ${viewMode === "confirmed" ? "ring-2 ring-primary/40" : ""}`}
            onClick={() => showBucket("confirmed")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") showBucket("confirmed");
            }}
            role="button"
            tabIndex={0}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Confirmed Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">${stats.confirmedRevenue.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition ${viewMode === "unconfirmed" ? "ring-2 ring-primary/40" : ""}`}
            onClick={() => showBucket("unconfirmed")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") showBucket("unconfirmed");
            }}
            role="button"
            tabIndex={0}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Pipeline Revenue (Projected)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">${stats.unconfirmedRevenue.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition ${viewMode === "all" ? "ring-2 ring-primary/40" : ""}`}
            onClick={() => showBucket("all")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") showBucket("all");
            }}
            role="button"
            tabIndex={0}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Total Forecast</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">${stats.totalForecast.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card
            className={`transition ${needsReviewOnly ? "ring-2 ring-primary/40" : ""}`}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Confirmed / Unconfirmed / Review</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 text-xs">
                <Button
                  onClick={(event) => {
                    event.stopPropagation();
                    showBucket("confirmed");
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Confirmed ({stats.confirmedCount})
                </Button>
                <Button
                  onClick={(event) => {
                    event.stopPropagation();
                    showBucket("unconfirmed");
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Unconfirmed ({stats.unconfirmedCount})
                </Button>
                <Button
                  onClick={(event) => {
                    event.stopPropagation();
                    showBucket("all", true);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Needs Review ({stats.needsReview})
                </Button>
                <Button
                  onClick={(event) => {
                    event.stopPropagation();
                    showBucket("missed");
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Missed
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Confirmed Revenue = scheduled/locked jobs. Pipeline Revenue = inquiries, quotes, negotiations, holds, and
          verbal interest not yet confirmed.
        </p>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Bookings</CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24 whitespace-normal">Received</TableHead>
                    <TableHead className="whitespace-normal">Booking</TableHead>
                    <TableHead className="w-52 whitespace-normal">Financial</TableHead>
                    <TableHead className="w-28 whitespace-normal">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        No booking rows.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((booking) => (
                      <TableRow
                        key={
                          ((booking as unknown as Record<string, unknown>).messageId as string | undefined) ??
                          ((booking as unknown as Record<string, unknown>).message_id as string | undefined) ??
                          booking.id
                        }
                      >
                        <TableCell className="whitespace-normal align-top">
                          {formatCompactDateTime(
                            ((booking as unknown as Record<string, unknown>).dateReceived as string | undefined) ??
                              ((booking as unknown as Record<string, unknown>).date_received as string | undefined) ??
                              null,
                          )}
                        </TableCell>
                        <TableCell className="whitespace-normal align-top">
                          <p className="font-medium leading-tight">
                            {((booking as unknown as Record<string, unknown>).brandOrClient as string | undefined) ??
                              ((booking as unknown as Record<string, unknown>).brand_or_client as string | undefined) ??
                              booking.title ??
                              ((booking as unknown as Record<string, unknown>).subject as string | undefined) ??
                              "-"}
                          </p>
                          <p className="mt-1 leading-tight text-muted-foreground">{eventText(booking)}</p>
                          <p className="mt-1 leading-tight text-muted-foreground">
                            {((booking as unknown as Record<string, unknown>).location as string | undefined) ??
                              "TBD"}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-normal align-top">
                          <div className="mb-1">
                            <Select
                              disabled={updatingStatusId === booking.id}
                              onValueChange={(value) =>
                                void onUpdateBookingStatus(
                                  booking.id,
                                  value as "request" | "needs_confirmation" | "confirmed" | "follow_up" | "canceled",
                                )
                              }
                              value={getBookingStatus(booking)}
                            >
                              <SelectTrigger className="h-7 w-44 text-xs">
                                <SelectValue placeholder="Set status" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="request">Request</SelectItem>
                                <SelectItem value="needs_confirmation">Needs Confirmation</SelectItem>
                                <SelectItem value="confirmed">Confirmed</SelectItem>
                                <SelectItem value="follow_up">Follow Up</SelectItem>
                                <SelectItem value="canceled">Canceled</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Badge
                            variant={badgeVariant(
                              (booking.calendarStatus ??
                                ((booking as unknown as Record<string, unknown>).calendar_status as
                                  | BookingEventRecord["calendarStatus"]
                                  | undefined)) as BookingEventRecord["calendarStatus"],
                            )}
                          >
                            {badgeLabel(
                              (booking.calendarStatus ??
                                ((booking as unknown as Record<string, unknown>).calendar_status as
                                  | BookingEventRecord["calendarStatus"]
                                  | undefined)) as BookingEventRecord["calendarStatus"],
                            )}
                          </Badge>
                          {updatingStatusId === booking.id ? (
                            <p className="mt-1 text-[11px] text-muted-foreground">Saving status...</p>
                          ) : null}
                          <p className="mt-1 leading-tight">
                            {value<number>(booking as unknown as Record<string, unknown>, "rateQuoted", "rate_quoted") ===
                              null ||
                            value<number>(booking as unknown as Record<string, unknown>, "rateQuoted", "rate_quoted") ===
                              undefined
                              ? "Needs review"
                              : `$${Number(value<number>(booking as unknown as Record<string, unknown>, "rateQuoted", "rate_quoted")).toLocaleString()}${
                                  value<string>(booking as unknown as Record<string, unknown>, "rateType", "rate_type")
                                    ? ` (${String(
                                        value<string>(
                                          booking as unknown as Record<string, unknown>,
                                          "rateType",
                                          "rate_type",
                                        ),
                                      ).replace("_", " ")})`
                                    : ""
                                }`}
                          </p>
                          <p className="mt-1 leading-tight text-muted-foreground">
                            Confidence:{" "}
                            {Math.round(
                              (Number(
                                value<number>(
                                  booking as unknown as Record<string, unknown>,
                                  "confidence",
                                  "confidence",
                                ) ?? 0,
                              ) || 0) * 100,
                            )}
                            %
                          </p>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-col gap-1">
                            <Button asChild size="sm" type="button" variant="outline">
                              <Link to={`/bookings/${booking.id}`}>Open</Link>
                            </Button>
                            <Button
                              disabled={deletingId === booking.id}
                              onClick={() => void onDeleteBooking(booking.id)}
                              size="sm"
                              type="button"
                              variant="destructive"
                            >
                              {deletingId === booking.id ? "Deleting..." : "Delete"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {filtered.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                No rows are visible for this filter. If everything appears empty, verify your API URL in Settings.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
