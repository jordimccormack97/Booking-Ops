import { useState } from "react";
import { Shield } from "lucide-react";
import { clearUnlockState, getSavedAccessKey, setSavedAccessKey } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const API_URL_STORAGE = "booking_ops_api_url";

export function SettingsPage() {
  const [apiUrl, setApiUrl] = useState(localStorage.getItem(API_URL_STORAGE) ?? "");
  const [accessKey, setAccessKey] = useState(getSavedAccessKey());
  const [message, setMessage] = useState("");

  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Settings</h1>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>API Connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="api_url">API URL</Label>
              <Input
                id="api_url"
                placeholder="http://127.0.0.1:3000"
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
              />
            </div>
            <Button
              onClick={() => {
                if (apiUrl.trim()) {
                  localStorage.setItem(API_URL_STORAGE, apiUrl.trim());
                } else {
                  localStorage.removeItem(API_URL_STORAGE);
                }
                setMessage("API URL saved");
              }}
              type="button"
            >
              Save API URL
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Access Gate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="access_key">Access Key</Label>
              <Input
                id="access_key"
                type="password"
                value={accessKey}
                onChange={(event) => setAccessKey(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setSavedAccessKey(accessKey);
                  setMessage("Access key updated");
                }}
                type="button"
              >
                Save Access Key
              </Button>
              <Button
                onClick={() => {
                  clearUnlockState();
                  location.reload();
                }}
                type="button"
                variant="outline"
              >
                Lock App
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {message ? <p className="mt-4 text-sm text-muted-foreground">{message}</p> : null}
    </main>
  );
}
