import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const KEY_STORAGE = "booking_ops_access_key";
const UNLOCK_STORAGE = "booking_ops_unlocked";
const DEFAULT_KEY = "booking-ops";

function safeGetItem(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage errors for local-only UX
  }
}

function safeRemoveItem(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage errors for local-only UX
  }
}

export function getSavedAccessKey() {
  return safeGetItem(KEY_STORAGE)?.trim() || DEFAULT_KEY;
}

export function setSavedAccessKey(value: string) {
  safeSetItem(KEY_STORAGE, value.trim() || DEFAULT_KEY);
}

export function clearUnlockState() {
  safeRemoveItem(UNLOCK_STORAGE);
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [unlocked, setUnlocked] = useState(safeGetItem(UNLOCK_STORAGE) === "true");
  const expectedKey = useMemo(() => getSavedAccessKey(), []);

  if (unlocked) return <>{children}</>;

  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.16),_transparent_45%),linear-gradient(to_bottom,_transparent,_rgba(15,23,42,0.06))] p-4">
      <Card className="w-full max-w-md border-emerald-200/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Lock className="h-5 w-5" />
            Workspace Access
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Enter your local access key to unlock Booking Ops.
          </p>
          <div className="grid gap-2">
            <Label htmlFor="access_key">Access Key</Label>
            <Input
              id="access_key"
              type="password"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button
            className="w-full"
            onClick={() => {
              if (input.trim() !== expectedKey) {
                setError("Invalid access key");
                return;
              }
              safeSetItem(UNLOCK_STORAGE, "true");
              setUnlocked(true);
            }}
            type="button"
          >
            Unlock
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
