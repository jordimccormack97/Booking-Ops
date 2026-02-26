import { CalendarDays, Settings2 } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { DashboardPage } from "@/pages/dashboard-page";
import { SettingsPage } from "@/pages/settings-page";

export function App() {
  return (
    <AuthGate>
      <div className="min-h-dvh bg-[radial-gradient(circle_at_top,_rgba(14,116,144,0.16),_transparent_45%)]">
        <header className="border-b bg-background/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-8">
            <h1 className="text-lg font-semibold">Booking Ops</h1>
            <nav className="flex gap-2">
              <Button asChild variant="ghost">
                <NavLink to="/">
                  <CalendarDays className="h-4 w-4" />
                  Dashboard
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
          <Route element={<DashboardPage />} path="/" />
          <Route element={<SettingsPage />} path="/settings" />
          <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </div>
    </AuthGate>
  );
}
