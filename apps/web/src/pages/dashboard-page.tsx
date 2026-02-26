import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createBooking, getApiBaseUrl, getBookings, gmailHealth, gmailSync } from "@/lib/api";
import type { Booking, BookingStatus } from "@/types/booking";

const EMPTY_FORM: Booking = {
  status: "CONFIRMED",
  client_name: "",
  start_time: "",
  end_time: "",
  rate: 0,
};

export function DashboardPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [form, setForm] = useState<Booking>(EMPTY_FORM);
  const [syncQuery, setSyncQuery] = useState("newer_than:14d");
  const [gmailStatus, setGmailStatus] = useState<"unknown" | "ok" | "down">("unknown");
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");

  const totalRevenue = useMemo(
    () => bookings.reduce((sum, booking) => sum + booking.rate, 0),
    [bookings],
  );

  async function loadBookings() {
    setBookings(await getBookings());
  }

  useEffect(() => {
    void loadBookings().catch((error) => {
      setMessage(`Failed to load bookings: ${String(error)}`);
    });
  }, []);

  async function onCreateBooking(event: React.FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setMessage("");
    try {
      await createBooking(form);
      await loadBookings();
      setForm(EMPTY_FORM);
      setMessage("Booking created");
    } catch (error) {
      setMessage(`Create failed: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function onHealth() {
    setIsBusy(true);
    setMessage("");
    try {
      const data = await gmailHealth();
      setGmailStatus(data.ok ? "ok" : "down");
      setMessage("Gmail client is healthy");
    } catch (error) {
      setGmailStatus("down");
      setMessage(`Gmail health failed: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function onSync() {
    setIsBusy(true);
    setMessage("");
    try {
      const inserted = await gmailSync(syncQuery);
      await loadBookings();
      setMessage(`Gmail sync complete: ${inserted.length} booking(s) added`);
    } catch (error) {
      setMessage(`Gmail sync failed: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-8">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Booking Dashboard</h1>
          <p className="text-muted-foreground">Create, sync, and review your bookings.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={gmailStatus === "ok" ? "default" : "secondary"}>Gmail: {gmailStatus}</Badge>
          <Badge variant="outline">Bookings: {bookings.length}</Badge>
          <Badge variant="outline">Revenue: ${totalRevenue.toLocaleString()}</Badge>
        </div>
      </header>

      <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {bookings.slice(0, 4).map((booking, index) => (
          <Card key={`${booking.client_name}-${booking.start_time}-${index}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{booking.client_name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Status:</span> {booking.status}
              </p>
              <p>
                <span className="text-muted-foreground">Start:</span> {booking.start_time}
              </p>
              <p>
                <span className="text-muted-foreground">End:</span> {booking.end_time}
              </p>
              <p className="font-semibold">${booking.rate.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create Booking</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={onCreateBooking}>
              <div className="grid gap-2">
                <Label htmlFor="status">Status</Label>
                <Input
                  id="status"
                  value={form.status}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, status: event.target.value as BookingStatus }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="client_name">Client Name</Label>
                <Input
                  id="client_name"
                  value={form.client_name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, client_name: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="start_time">Start Time</Label>
                  <Input
                    id="start_time"
                    value={form.start_time}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, start_time: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="end_time">End Time</Label>
                  <Input
                    id="end_time"
                    value={form.end_time}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, end_time: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="rate">Rate</Label>
                <Input
                  id="rate"
                  min="0"
                  type="number"
                  value={String(form.rate)}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, rate: Number(event.target.value) || 0 }))
                  }
                />
              </div>
              <Button disabled={isBusy} type="submit">
                Add Booking
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Gmail Sync</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="query">Query</Label>
              <Input
                id="query"
                value={syncQuery}
                onChange={(event) => setSyncQuery(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={isBusy} onClick={onHealth} type="button" variant="secondary">
                Check Health
              </Button>
              <Button disabled={isBusy} onClick={onSync} type="button">
                Sync Gmail
              </Button>
              <Button disabled={isBusy} onClick={() => void loadBookings()} type="button" variant="outline">
                Refresh
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              API base URL: <code>{getApiBaseUrl()}</code>
            </p>
            {message ? <p className="text-sm">{message}</p> : null}
          </CardContent>
        </Card>
      </section>

      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>All Bookings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground" colSpan={5}>
                        No bookings yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    bookings.map((booking, index) => (
                      <TableRow key={`${booking.client_name}-${booking.start_time}-${index}`}>
                        <TableCell>{booking.status}</TableCell>
                        <TableCell>{booking.client_name}</TableCell>
                        <TableCell>{booking.start_time}</TableCell>
                        <TableCell>{booking.end_time}</TableCell>
                        <TableCell className="text-right">${booking.rate.toLocaleString()}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
