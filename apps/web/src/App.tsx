import { BookOpenText, CalendarDays, CircleDollarSign, Home, Settings2 } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BookingDetailsPage } from "@/pages/booking-details-page";
import { BookingsPage } from "@/pages/bookings-page";
import { CalendarPage } from "@/pages/calendar-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { HomePage } from "@/pages/home-page";
import { SettingsPage } from "@/pages/settings-page";

export function App() {
  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top,_rgba(14,116,144,0.16),_transparent_45%)]">
      <header className="border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-8">
          <h1 className="text-lg font-semibold">Booking Ops</h1>
          <nav className="flex gap-2">
            <Button asChild variant="ghost">
              <NavLink to="/">
                <Home className="h-4 w-4" />
                Home
              </NavLink>
            </Button>
            <Button asChild variant="ghost">
              <NavLink to="/bookings">
                <BookOpenText className="h-4 w-4" />
                Bookings
              </NavLink>
            </Button>
            <Button asChild variant="ghost">
              <NavLink to="/earnings">
                <CircleDollarSign className="h-4 w-4" />
                Earnings
              </NavLink>
            </Button>
            <Button asChild variant="ghost">
              <NavLink to="/calendar">
                <CalendarDays className="h-4 w-4" />
                Calendar
              </NavLink>
            </Button>
            <Button asChild variant="ghost">
              <NavLink to="/settings">
                <Settings2 className="h-4 w-4" />
                Settings
              </NavLink>
            </Button>
          </nav>
        </div>
      </header>
      <Routes>
        <Route element={<HomePage />} path="/" />
        <Route element={<DashboardPage />} path="/earnings" />
        <Route element={<CalendarPage />} path="/calendar" />
        <Route element={<BookingsPage />} path="/bookings" />
        <Route element={<BookingDetailsPage />} path="/bookings/:id" />
        <Route element={<SettingsPage />} path="/settings" />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </div>
  );
}
