import type { Booking } from "@/types/booking";

const FALLBACK_API_URL = "http://127.0.0.1:3000";

export function getApiBaseUrl(): string {
  const fromStorage = localStorage.getItem("booking_ops_api_url")?.trim();
  return fromStorage || import.meta.env.VITE_API_URL || FALLBACK_API_URL;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getBookings() {
  return fetchJson<Booking[]>("/bookings");
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

export function gmailSync(query: string) {
  return fetchJson<Booking[]>("/gmail/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
}
