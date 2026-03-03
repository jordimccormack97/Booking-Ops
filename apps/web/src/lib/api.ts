import type { Booking } from "@/types/booking";

const FALLBACK_API_URL = "http://127.0.0.1:3000";
const API_URL_STORAGE = "booking_ops_api_url";

function safeGetLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getApiBaseUrl(): string {
  const fromStorage = safeGetLocalStorage("booking_ops_api_url")?.trim();
  return fromStorage || import.meta.env.VITE_API_URL || FALLBACK_API_URL;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const configuredBase = getApiBaseUrl();
  const configuredUrl = `${configuredBase}${path}`;
  let response: Response;
  try {
    response = await fetch(configuredUrl, init);
  } catch (error) {
    const isMixedContentBlocked =
      typeof window !== "undefined" &&
      window.location.protocol === "https:" &&
      configuredBase.startsWith("http://");
    if (isMixedContentBlocked) {
      throw new Error(
        `Blocked by browser mixed-content policy. Open the web app on http://localhost (not https), or use an https API URL. Current API URL: ${configuredBase}`,
      );
    }
    const canFallback = configuredBase !== FALLBACK_API_URL;
    if (!canFallback) throw error;
    try {
      response = await fetch(`${FALLBACK_API_URL}${path}`, init);
    } catch (fallbackError) {
      throw new Error(
        `Failed to reach API at ${configuredBase} or fallback ${FALLBACK_API_URL}. ${
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        }`,
      );
    }
    try {
      localStorage.setItem(API_URL_STORAGE, FALLBACK_API_URL);
    } catch {
      // ignore storage errors
    }
  }
  if (!response.ok) {
    const text = await response.text();
    let parsed: { error?: string; message?: string } | null = null;
    try {
      parsed = JSON.parse(text) as { error?: string; message?: string };
    } catch {
      parsed = null;
    }
    throw new Error(parsed?.error || parsed?.message || text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type BookingEventRecord = {
  id: string;
  source?: "directionsusa";
  messageId?: string;
  threadId?: string | null;
  subject?: string | null;
  fromEmail?: string | null;
  dateReceived?: string | null;
  isBookingRequest?: boolean;
  title?: string | null;
  brandOrClient?: string | null;
  eventDateText?: string | null;
  startTimeText?: string | null;
  endTimeText?: string | null;
  timezone?: string | null;
  minimumHours?: number | null;
  location?: string | null;
  rateQuoted?: number | null;
  currency?: "USD" | null;
  rateType?: "half_day" | "full_day" | "hourly" | "flat" | null;
  recordType?: "booking" | "partnership" | "test_shoot";
  requestType?: "application" | "availability_check" | "booking_confirmation";
  bookingStatus?: "request" | "needs_confirmation" | "confirmed" | "follow_up" | "canceled";
  confidence?: number;
  calendarStatus?: "not_requested" | "on_calendar" | "needs_auth" | "needs_details";
  googleEventId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  status?: string;
  client_name?: string;
  start_time?: string;
  end_time?: string;
  rate?: number;
};

export function getBookings(options?: { includeAll?: boolean }) {
  const params = new URLSearchParams();
  if (options?.includeAll) params.set("includeAll", "true");
  const query = params.toString();
  return fetchJson<BookingEventRecord[]>(`/bookings${query ? `?${query}` : ""}`);
}

export function getBookingById(id: string) {
  return fetchJson<BookingEventRecord>(`/bookings/${encodeURIComponent(id)}`);
}

export function deleteBookingRow(id: string) {
  return fetchJson<{ deleted: boolean; id: string }>(`/bookings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function updateBookingStatus(
  id: string,
  bookingStatus: "request" | "needs_confirmation" | "confirmed" | "follow_up" | "canceled",
) {
  return fetchJson<{ booking: BookingEventRecord }>(`/bookings/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingStatus }),
  });
}

export function updateBookingRequestType(
  id: string,
  requestType: "application" | "availability_check" | "booking_confirmation",
) {
  return fetchJson<{ booking: BookingEventRecord }>(`/bookings/${encodeURIComponent(id)}/request-type`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType }),
  });
}

export function mergeBookingRows(sourceId: string, targetId: string) {
  return fetchJson<{
    merged: boolean;
    removedBookingId: string;
    targetBookingId: string;
    booking: BookingEventRecord;
  }>("/bookings/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, targetId }),
  });
}

export type BookingExpense = {
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

export type BookingExpenseAudit = {
  id: string;
  bookingId: string;
  expenseId: string | null;
  action: "created" | "deleted";
  changedFields: Record<string, unknown>;
  performedBy: string | null;
  createdAt: string;
};

export function getBookingExpenses(bookingId: string) {
  return fetchJson<{ expenses: BookingExpense[]; audit: BookingExpenseAudit[] }>(
    `/bookings/${encodeURIComponent(bookingId)}/expenses`,
  );
}

export function createBookingExpense(
  bookingId: string,
  input: {
    expenseDate: string;
    category: string;
    amount: number;
    vendor?: string;
    notes?: string;
    receiptUrl?: string;
  },
) {
  return fetchJson<{ expense: BookingExpense }>(`/bookings/${encodeURIComponent(bookingId)}/expenses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteBookingExpense(bookingId: string, expenseId: string) {
  return fetchJson<{ deleted: boolean; expenseId: string }>(
    `/bookings/${encodeURIComponent(bookingId)}/expenses/${encodeURIComponent(expenseId)}`,
    { method: "DELETE" },
  );
}

export function createBooking(booking: Booking) {
  return fetchJson<Booking>("/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(booking),
  });
}

export function gmailHealth() {
  return fetchJson<{ ok: boolean }>("/gmail/health");
}

export function gmailProfile() {
  return fetchJson<{ email: string | null; connected: boolean; error?: string | null }>("/gmail/profile");
}

export function gmailSync(query: string) {
  return fetchJson<{
    added: number;
    skipped: number;
    errors: number;
    skippedReasons?: {
      existingMessage: number;
      existingThread: number;
      parseFailed: number;
    };
  }>("/gmail/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

export type ExtractedRate = {
  id: string;
  source: "directionsusa";
  messageId: string;
  threadId: string | null;
  subject: string | null;
  fromEmail: string | null;
  dateReceived: string | null;
  brandOrClient: string | null;
  jobType: "shoot" | "fitting" | "travel" | "other" | null;
  eventDateText: string | null;
  startTimeText: string | null;
  endTimeText: string | null;
  location: string | null;
  rateQuoted: number | null;
  currency: "USD" | null;
  rateType: "half_day" | "full_day" | "hourly" | "flat" | null;
  usageTerms: string[];
  notes: string[];
  confidence: number;
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
};

export function getRates(filters?: {
  domain?: string;
  needsReview?: boolean;
  dateFrom?: string;
  dateTo?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.domain) params.set("domain", filters.domain);
  if (typeof filters?.needsReview === "boolean") {
    params.set("needsReview", String(filters.needsReview));
  }
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  const query = params.toString();
  return fetchJson<ExtractedRate[]>(`/rates${query ? `?${query}` : ""}`);
}

export function gmailSyncDirectionsusa() {
  return fetchJson<{
    added: number;
    skipped: number;
    errors: number;
    skippedReasons?: {
      existingMessage: number;
      existingThread: number;
      parseFailed: number;
    };
    debugRows?: unknown[];
  }>(
    "/gmail/sync",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "newer_than:365d (from:directionsusa.com OR from:@directionsusa.com)",
        force: true,
      }),
    },
  );
}

export function getTestShoots() {
  return fetchJson<BookingEventRecord[]>("/test-shoots");
}
