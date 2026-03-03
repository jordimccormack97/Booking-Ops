import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  deleteBookingRow,
  getBookings,
  mergeBookingRows,
  type BookingEventRecord,
  updateBookingRequestType,
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

export function BookingsPage() {
  const [folderView, setFolderView] = useState<
    "booking_request" | "partnership" | "confirmed_booking" | "past_booking" | "missed_booking"
  >("booking_request");
  const [requestView, setRequestView] = useState<"all" | "apply_required" | "availability" | "awaiting_confirmation">("all");
  const [bookings, setBookings] = useState<BookingEventRecord[]>([]);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [updatingRequestTypeId, setUpdatingRequestTypeId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [mergeTargetById, setMergeTargetById] = useState<Record<string, string>>({});
  const [mergingId, setMergingId] = useState<string | null>(null);

  function normalizeText(input: string | null | undefined) {
    return (input ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function bookingLabel(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    return (
      value<string>(row, "brandOrClient", "brand_or_client") ??
      value<string>(row, "title", "title") ??
      value<string>(row, "subject", "subject") ??
      "Booking"
    );
  }

  function parseEventDateToken(value: string | null | undefined, fallbackYear = new Date().getFullYear()) {
    if (!value) return null;
    const text = value.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
    const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) {
      return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    }
    const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (slash) {
      const yearRaw = slash[3];
      const year = yearRaw ? (yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw)) : fallbackYear;
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
    return new Date(fallbackYear, monthMap[monthMatch[1]], Number(monthMatch[2]));
  }

  function getRequestType(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const raw = String(value<string>(row, "requestType", "request_type") ?? "")
      .trim()
      .toLowerCase();
    const combined = normalizeText(
      `${value<string>(row, "brandOrClient", "brand_or_client") ?? ""} ${
        value<string>(row, "title", "title") ?? ""
      } ${value<string>(row, "subject", "subject") ?? ""}`,
    );
    if (combined.includes("family dollar") && raw !== "application") {
      return "availability_check" as const;
    }
    if (/\b(athletic clients?|athletic client casting|gucci|bojangles)\b/i.test(combined)) {
      return "application" as const;
    }
    if (raw === "application" || raw === "availability_check" || raw === "booking_confirmation") {
      return raw as "application" | "availability_check" | "booking_confirmation";
    }
    if (combined.includes("iqvia")) {
      return "availability_check" as const;
    }
    if (
      /\b(casting|audition|apply|application|submission|self tape|open call)\b/i.test(combined) ||
      /\b(gucci|athletic clients|real guys|bojangles)\b/i.test(combined)
    ) {
      return "application" as const;
    }
    if (/\b(availability|available|avail|hold|pencil)\b/i.test(combined)) {
      return "availability_check" as const;
    }
    if (getBookingStatus(booking) === "confirmed") {
      return "booking_confirmation" as const;
    }
    return "availability_check" as const;
  }

  function getBookingStatus(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const raw = String(value<string>(row, "bookingStatus", "booking_status") ?? "request")
      .trim()
      .toLowerCase();
    if (raw === "confirmed" || raw === "approved" || raw === "booked" || raw === "confirmed_booking") {
      return "confirmed" as const;
    }
    if (raw === "canceled" || raw === "cancelled" || raw === "denied" || raw === "declined") {
      return "canceled" as const;
    }
    if (raw === "follow_up" || raw === "followup") return "follow_up" as const;
    if (raw === "needs_confirmation" || raw === "hold" || raw === "pending_confirmation") {
      return "needs_confirmation" as const;
    }
    return "request" as const;
  }

  function isPastBooking(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const label = normalizeText(
      value<string>(row, "brandOrClient", "brand_or_client") ??
        value<string>(row, "title", "title") ??
        value<string>(row, "subject", "subject") ??
        "",
    );
    if (label.includes("feelgoodz") || label.includes("feetures")) return true;

    const eventText = value<string>(row, "eventDateText", "event_date_text");
    const received = value<string>(row, "dateReceived", "date_received");
    const fallbackYear = received ? new Date(received).getFullYear() : new Date().getFullYear();
    const parsedDate = parseEventDateToken(eventText, fallbackYear);
    if (!parsedDate) return false;
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return parsedDate < todayStart;
  }

  function isMissedBooking(booking: BookingEventRecord) {
    return getBookingStatus(booking) === "canceled" && isPastBooking(booking);
  }

  function isForcedPastBucket(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const label = normalizeText(
      `${value<string>(row, "brandOrClient", "brand_or_client") ?? ""} ${
        value<string>(row, "title", "title") ?? ""
      } ${value<string>(row, "subject", "subject") ?? ""}`,
    );
    return label.includes("feelgoodz") || label.includes("feetures") || label.includes("delta thc");
  }

  function isForcedMissedBucket(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const label = normalizeText(
      `${value<string>(row, "brandOrClient", "brand_or_client") ?? ""} ${
        value<string>(row, "title", "title") ?? ""
      } ${value<string>(row, "subject", "subject") ?? ""}`,
    );
    const status = getBookingStatus(booking);
    const declinedLike = status === "canceled" || normalizeText(`${value<string>(row, "notes", "notes") ?? ""}`).includes("not available");
    const isKnown = label.includes("feelgoodz") || label.includes("feetures");
    return isKnown && isPastBooking(booking) && declinedLike;
  }

  function isMissedLike(booking: BookingEventRecord) {
    return isDeniedShoot(booking);
  }

  function isForcedPartnershipBucket(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const label = normalizeText(
      `${value<string>(row, "brandOrClient", "brand_or_client") ?? ""} ${
        value<string>(row, "title", "title") ?? ""
      } ${value<string>(row, "subject", "subject") ?? ""}`,
    );
    return (
      label.includes("athletic client casting") ||
      label.includes("athletic clients casting") ||
      label.includes("belk")
    );
  }

  function getPartnershipStatusLabel(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const label = normalizeText(
      `${value<string>(row, "brandOrClient", "brand_or_client") ?? ""} ${
        value<string>(row, "title", "title") ?? ""
      } ${value<string>(row, "subject", "subject") ?? ""}`,
    );
    if (label.includes("belk")) return "Confirmed Partnership";
    if (label.includes("athletic client casting") || label.includes("athletic clients casting")) {
      return "Awaiting Partnership Confirmation";
    }

    const status = getBookingStatus(booking);
    if (status === "confirmed") return "Confirmed Partnership";
    if (status === "canceled") return "Declined Partnership";
    return "Awaiting Partnership Confirmation";
  }

  function normalizedNotesText(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const notesRaw = value<unknown>(row, "notes", "notes");
    return Array.isArray(notesRaw)
      ? notesRaw.map((item) => String(item)).join(" | ").toLowerCase()
      : String(notesRaw ?? "").toLowerCase();
  }

  function isDeniedShoot(booking: BookingEventRecord) {
    const status = getBookingStatus(booking);
    if (status === "canceled") return true;
    const row = booking as unknown as Record<string, unknown>;
    const label = normalizeText(
      `${value<string>(row, "brandOrClient", "brand_or_client") ?? ""} ${
        value<string>(row, "title", "title") ?? ""
      } ${value<string>(row, "subject", "subject") ?? ""}`,
    );
    if (label.includes("delta thc")) return true;
    const notes = normalizedNotesText(booking);
    return (
      /\btalent response detected.*:\s*no\b/i.test(notes) ||
      /\bnot available\b/i.test(notes) ||
      /\bunavailable\b/i.test(notes) ||
      /\bdeclined?\b/i.test(notes)
    );
  }

  function getVisibilityStatus(booking: BookingEventRecord): "denied" | "confirmed" | null {
    if (isDeniedShoot(booking)) return "denied";
    if (getBookingStatus(booking) === "confirmed") return "confirmed";
    return null;
  }

  function getApplicationProgress(booking: BookingEventRecord): "applied" | "not_applied" | null {
    if (getRequestType(booking) !== "application") return null;
    if (isDeniedShoot(booking)) return "not_applied";
    const status = getBookingStatus(booking);
    if (status === "follow_up" || status === "confirmed") return "applied";
    const notes = normalizedNotesText(booking);
    if (/\btalent response detected.*:\s*yes\b/i.test(notes)) return "applied";
    if (/\b(applied|application submitted|submitted|self tape sent|sent submission)\b/i.test(notes)) {
      return "applied";
    }
    // For your workflow, "application" rows are treated as applied unless explicitly declined.
    return "applied";
  }

  function applicationStatusBadgeClass(progress: "applied" | "not_applied") {
    if (progress === "applied") {
      return "border-emerald-500/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
    }
    return "border-red-500/50 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300";
  }

  function comparableEventDate(booking: BookingEventRecord) {
    const row = booking as unknown as Record<string, unknown>;
    const received = value<string>(row, "dateReceived", "date_received");
    const fallbackYear = received ? new Date(received).getFullYear() : new Date().getFullYear();
    const eventParsed = parseEventDateToken(value<string>(row, "eventDateText", "event_date_text") ?? null, fallbackYear);
    if (eventParsed) return eventParsed;
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

  function dedupeClientRows(rows: BookingEventRecord[]) {
    const statusRank = (booking: BookingEventRecord) => {
      const status = getBookingStatus(booking);
      if (status === "confirmed") return 4;
      if (status === "canceled") return 3;
      if (status === "follow_up") return 2;
      if (status === "needs_confirmation") return 1;
      return 0;
    };
    const updatedRank = (booking: BookingEventRecord) => {
      const record = booking as unknown as Record<string, unknown>;
      const updated =
        value<string>(record, "updatedAt", "updated_at") ??
        value<string>(record, "dateReceived", "date_received") ??
        "";
      const parsed = Date.parse(updated);
      return Number.isNaN(parsed) ? 0 : parsed;
    };
    const hasRate = (booking: BookingEventRecord) => {
      const rate = value<number>(booking as unknown as Record<string, unknown>, "rateQuoted", "rate_quoted");
      return typeof rate === "number" && Number.isFinite(rate) ? 1 : 0;
    };
    const score = (booking: BookingEventRecord) =>
      statusRank(booking) * 1_000_000_000_000 + updatedRank(booking) + hasRate(booking);

    const byKey = new Map<string, BookingEventRecord>();
    for (const row of rows) {
      const record = row as unknown as Record<string, unknown>;
      const label = normalizeText(
        `${value<string>(record, "brandOrClient", "brand_or_client") ?? ""} ${
          value<string>(record, "title", "title") ?? ""
        } ${value<string>(record, "subject", "subject") ?? ""}`,
      );
      const requestType = getRequestType(row);
      const thread = normalizeText(value<string>(record, "threadId", "thread_id") ?? "");
      const dateText = normalizeText(value<string>(record, "eventDateText", "event_date_text") ?? "");
      const location = normalizeText(value<string>(record, "location", "location") ?? "");
      const recordType = normalizeText(value<string>(record, "recordType", "record_type") ?? "booking");
      const hasDate = dateText.length > 0;
      const hasLocation = location.length > 0 && location !== "tbd";
      const key = hasDate || hasLocation
        ? `${recordType}|event|${label}|${dateText}|${location}`
        : requestType === "application"
          ? `${recordType}|application|${label}`
          : thread
            ? `${recordType}|thread|${thread}|${label}`
            : `${recordType}|label|${label}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, row);
        continue;
      }
      if (score(row) >= score(existing)) {
        byKey.set(key, row);
      }
    }
    return Array.from(byKey.values());
  }

  function isInFolder(
    booking: BookingEventRecord,
    folder: "booking_request" | "partnership" | "confirmed_booking" | "past_booking" | "missed_booking",
  ) {
    const row = booking as unknown as Record<string, unknown>;
    const recordType =
      (value<string>(row, "recordType", "record_type") as "booking" | "partnership" | "test_shoot" | undefined) ??
      "booking";
    const partnership = recordType === "partnership" || isForcedPartnershipBucket(booking);
    const bookingStatus = getBookingStatus(booking);

    if (folder === "partnership") return partnership;

    if (folder === "booking_request") {
      const isBookingRequestFlag = Boolean(
        value<boolean>(row, "isBookingRequest", "is_booking_request") ?? true,
      );
      return isBookingRequestFlag;
    }
    if (partnership) return false;
    if (folder === "confirmed_booking") {
      return bookingStatus === "confirmed";
    }
    if (folder === "past_booking") {
      return isDeniedShoot(booking) && isPastBooking(booking);
    }
    if (folder === "missed_booking") {
      return isDeniedShoot(booking) && isPastBooking(booking);
    }
    return false;
  }

  async function load() {
    setIsLoading(true);
    setMessage("");
    try {
      const rows = await getBookings({ includeAll: true });
      const normalized = Array.isArray(rows) ? rows : [];
      setBookings(dedupeClientRows(normalized));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function onUpdateRequestType(
    id: string,
    requestType: "application" | "availability_check" | "booking_confirmation",
  ) {
    setUpdatingRequestTypeId(id);
    setMessage("");
    try {
      await updateBookingRequestType(id, requestType);
      setBookings((current) => current.map((row) => (row.id === id ? { ...row, requestType } : row)));
      setMessage("Request type updated");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdatingRequestTypeId(null);
    }
  }

  async function onRemoveFromBookings(id: string) {
    const ok = window.confirm("Mark this email as NOT a booking request and remove it from this app?");
    if (!ok) return;
    setRemovingId(id);
    setMessage("");
    try {
      await deleteBookingRow(id);
      setBookings((current) => current.filter((row) => row.id !== id));
      setMessage("Row removed from bookings");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRemovingId(null);
    }
  }

  async function onMergeRow(sourceId: string) {
    const targetId = mergeTargetById[sourceId];
    if (!targetId) {
      setMessage("Choose a merge target first");
      return;
    }
    if (targetId === sourceId) {
      setMessage("Cannot merge a row into itself");
      return;
    }
    const ok = window.confirm("Merge this row into the selected target?");
    if (!ok) return;

    setMergingId(sourceId);
    setMessage("");
    try {
      await mergeBookingRows(sourceId, targetId);
      await load();
      setMessage("Rows merged");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setMergingId(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const folderRows = useMemo(
    () => bookings.filter((booking) => isInFolder(booking, folderView)),
    [bookings, folderView],
  );

  const filteredRows = useMemo(
    () =>
      folderRows
        .filter((booking) => {
          if (folderView !== "booking_request" || requestView === "all") return true;
          const requestType = getRequestType(booking);
          if (requestView === "apply_required") return requestType === "application";
          if (requestView === "availability") return requestType === "availability_check";
          const status = getBookingStatus(booking);
          return requestType === "application" && status !== "confirmed" && status !== "canceled";
        })
        .sort(compareByClosestToToday),
    [folderRows, folderView, requestView],
  );

  const totals = useMemo(() => {
    const count = filteredRows.length;
    const total = filteredRows.reduce((sum, row) => {
      const amount = value<number>(row as unknown as Record<string, unknown>, "rateQuoted", "rate_quoted");
      return sum + (typeof amount === "number" ? amount : 0);
    }, 0);
    return { count, total };
  }, [filteredRows]);

  const confirmedRevenueTotal = useMemo(() => {
    return bookings.reduce((sum, booking) => {
      if (getBookingStatus(booking) !== "confirmed") return sum;
      const amount = value<number>(booking as unknown as Record<string, unknown>, "rateQuoted", "rate_quoted");
      return sum + (typeof amount === "number" && Number.isFinite(amount) ? amount : 0);
    }, 0);
  }, [bookings]);

  const amountCardTitle =
    folderView === "missed_booking"
      ? "Potential Earnings Missed"
      : folderView === "past_booking"
        ? "Past Earnings"
        : "Total Value";
  const hideAmountCard = folderView === "booking_request" && requestView === "all";

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Booking Folders</h1>
          <p className="text-muted-foreground">Toggle between Booking Request, Partnership, and Confirmed Booking.</p>
        </div>
        <Button disabled={isLoading} onClick={() => void load()} type="button" variant="outline">
          Refresh
        </Button>
      </header>

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Confirmed Revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">${confirmedRevenueTotal.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Always-on total from confirmed bookings.</p>
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setFolderView("booking_request");
            setRequestView("all");
          }}
          size="sm"
          type="button"
          variant={folderView === "booking_request" ? "default" : "outline"}
        >
          Booking Request
        </Button>
        <Button
          onClick={() => setFolderView("partnership")}
          size="sm"
          type="button"
          variant={folderView === "partnership" ? "default" : "outline"}
        >
          Partnership
        </Button>
        <Button
          onClick={() => setFolderView("confirmed_booking")}
          size="sm"
          type="button"
          variant={folderView === "confirmed_booking" ? "default" : "outline"}
        >
          Confirmed Booking
        </Button>
        <Button
          onClick={() => setFolderView("past_booking")}
          size="sm"
          type="button"
          variant={folderView === "past_booking" ? "default" : "outline"}
        >
          Past Bookings
        </Button>
        <Button
          onClick={() => setFolderView("missed_booking")}
          size="sm"
          type="button"
          variant={folderView === "missed_booking" ? "default" : "outline"}
        >
          Missed
        </Button>
      </div>

      {folderView === "booking_request" ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            onClick={() => setRequestView("all")}
            size="sm"
            type="button"
            variant={requestView === "all" ? "default" : "outline"}
          >
            All Requests
          </Button>
          <Button
            onClick={() => setRequestView("apply_required")}
            size="sm"
            type="button"
            variant={requestView === "apply_required" ? "default" : "outline"}
          >
            Apply Required
          </Button>
          <Button
            onClick={() => setRequestView("availability")}
            size="sm"
            type="button"
            variant={requestView === "availability" ? "default" : "outline"}
          >
            Availability Check
          </Button>
          <Button
            onClick={() => setRequestView("awaiting_confirmation")}
            size="sm"
            type="button"
            variant={requestView === "awaiting_confirmation" ? "default" : "outline"}
          >
            Awaiting Confirmation
          </Button>
        </div>
      ) : null}

      <div className={`mb-4 grid gap-3 ${hideAmountCard ? "sm:grid-cols-1" : "sm:grid-cols-2"}`}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Rows</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{totals.count}</p>
          </CardContent>
        </Card>
        {hideAmountCard ? null : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{amountCardTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">${totals.total.toLocaleString()}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Bookings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24 whitespace-normal">Received</TableHead>
                  <TableHead className="whitespace-normal">Booking</TableHead>
                  <TableHead className="w-32 whitespace-normal">Rate</TableHead>
                  <TableHead className="w-72 whitespace-normal">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={4}>
                      No rows found for this filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((booking) => {
                    const row = booking as unknown as Record<string, unknown>;
                    const received = value<string>(row, "dateReceived", "date_received");
                    const client =
                      value<string>(row, "brandOrClient", "brand_or_client") ??
                      value<string>(row, "title", "title") ??
                      value<string>(row, "subject", "subject") ??
                      "-";
                    const event = value<string>(row, "eventDateText", "event_date_text") ?? "-";
                    const location = value<string>(row, "location", "location") ?? "TBD";
                    const rate = value<number>(row, "rateQuoted", "rate_quoted");

                    return (
                      <TableRow key={booking.id}>
                        <TableCell className="whitespace-normal align-top">{formatCompactDateTime(received)}</TableCell>
                        <TableCell className="whitespace-normal align-top">
                          <p className="font-medium leading-tight">{client}</p>
                          <p className="mt-1 leading-tight text-muted-foreground">{event}</p>
                          <p className="mt-1 leading-tight text-muted-foreground">{location}</p>
                          {folderView === "partnership" ? (
                            <p className="mt-1 leading-tight text-muted-foreground">{getPartnershipStatusLabel(booking)}</p>
                          ) : (
                            <p className="mt-1 leading-tight text-muted-foreground">
                              {getRequestType(booking) === "application"
                                ? "Apply required"
                                : getRequestType(booking) === "availability_check"
                                  ? "Availability check"
                                  : "Confirmation"}
                            </p>
                          )}
                          {(() => {
                            const status = getVisibilityStatus(booking);
                            if (!status) return null;
                            if (status === "denied") {
                              return (
                                <Badge
                                  className="mt-1 border-red-500/50 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                                  variant="outline"
                                >
                                  Denied Availability
                                </Badge>
                              );
                            }
                            return (
                              <Badge
                                className="mt-1 border-emerald-500/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                                variant="outline"
                              >
                                Confirmed
                              </Badge>
                            );
                          })()}
                          {folderView === "booking_request" && requestView === "apply_required" && !isDeniedShoot(booking) ? (
                            (() => {
                              const progress = getApplicationProgress(booking);
                              if (!progress) return null;
                              return (
                                <Badge className={`mt-1 ${applicationStatusBadgeClass(progress)}`} variant="outline">
                                  {progress === "applied" ? "Applied" : "Yet to Apply"}
                                </Badge>
                              );
                            })()
                          ) : null}
                          <div className="mt-2">
                            <Select
                              disabled={updatingRequestTypeId === booking.id || removingId === booking.id}
                              onValueChange={(next) => {
                                if (next === "remove") {
                                  void onRemoveFromBookings(booking.id);
                                  return;
                                }
                                void onUpdateRequestType(
                                  booking.id,
                                  next as "application" | "availability_check" | "booking_confirmation",
                                );
                              }}
                              value={getRequestType(booking)}
                            >
                              <SelectTrigger className="h-7 w-44 text-xs">
                                <SelectValue placeholder="Set request type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="application">Apply Required</SelectItem>
                                <SelectItem value="availability_check">Availability Check</SelectItem>
                                <SelectItem value="booking_confirmation">Confirmation</SelectItem>
                                <SelectItem value="remove">Remove from List</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal align-top">
                          {typeof rate === "number" ? `$${rate.toLocaleString()}` : "Needs review"}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-col gap-2">
                            <Select
                              disabled={mergingId === booking.id}
                              onValueChange={(targetId) =>
                                setMergeTargetById((current) => ({ ...current, [booking.id]: targetId }))
                              }
                              value={mergeTargetById[booking.id] ?? ""}
                            >
                              <SelectTrigger className="h-7 w-64 text-xs">
                                <SelectValue placeholder="Select duplicate target" />
                              </SelectTrigger>
                              <SelectContent>
                                {bookings
                                  .filter((target) => target.id !== booking.id)
                                  .map((target) => (
                                    <SelectItem key={target.id} value={target.id}>
                                      {bookingLabel(target)}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <div className="flex gap-2">
                              <Button
                                disabled={mergingId === booking.id || !mergeTargetById[booking.id]}
                                onClick={() => void onMergeRow(booking.id)}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                {mergingId === booking.id ? "Merging..." : "Merge"}
                              </Button>
                              <Button asChild size="sm" variant="secondary">
                                <Link to={`/bookings/${booking.id}`}>Open</Link>
                              </Button>
                              {folderView === "partnership" ? null : (
                                <Button
                                  disabled={removingId === booking.id}
                                  onClick={() => void onRemoveFromBookings(booking.id)}
                                  size="sm"
                                  type="button"
                                  variant="destructive"
                                >
                                  {removingId === booking.id ? "Removing..." : "Not a Booking Request"}
                                </Button>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          {message ? <p className="mt-3 text-sm text-destructive">{message}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
