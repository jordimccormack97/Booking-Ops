import { useState } from "react";
import { Shield } from "lucide-react";
import { clearUnlockState, getSavedAccessKey, setSavedAccessKey } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  applyTheme,
  getSavedColorTheme,
  getSavedThemeMode,
  setColorTheme as persistColorTheme,
  setThemeMode as persistThemeMode,
  type ColorTheme,
  type ThemeMode,
} from "@/lib/theme";

const API_URL_STORAGE = "booking_ops_api_url";
const LOCAL_API_URL = "http://127.0.0.1:3000";

function safeGetApiUrl() {
  try {
    return localStorage.getItem(API_URL_STORAGE) ?? "";
  } catch {
    return "";
  }
}

function safeSetApiUrl(value: string) {
  try {
    localStorage.setItem(API_URL_STORAGE, value);
  } catch {
    // ignore storage errors in local settings page
  }
}

function safeRemoveApiUrl() {
  try {
    localStorage.removeItem(API_URL_STORAGE);
  } catch {
    // ignore storage errors in local settings page
  }
}

export function SettingsPage() {
  const [apiUrl, setApiUrl] = useState(safeGetApiUrl());
  const [accessKey, setAccessKey] = useState(getSavedAccessKey());
  const [themeMode, setThemeMode] = useState<ThemeMode>(getSavedThemeMode());
  const [colorTheme, setColorTheme] = useState<ColorTheme>(getSavedColorTheme());
  const [message, setMessage] = useState("");

  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Settings</h1>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label>Mode</Label>
                <p className="text-xs text-muted-foreground">Switch between light and dark mode.</p>
              </div>
              <Button
                onClick={() => {
                  const next = themeMode === "dark" ? "light" : "dark";
                  setThemeMode(next);
                  persistThemeMode(next);
                  applyTheme(next, colorTheme);
                  setMessage(`Appearance set to ${next} mode`);
                }}
                type="button"
                variant="outline"
              >
                {themeMode === "dark" ? "Dark" : "Light"}
              </Button>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="color_theme">Theme</Label>
              <Select
                onValueChange={(value) => {
                  const next = value as ColorTheme;
                  setColorTheme(next);
                  persistColorTheme(next);
                  applyTheme(themeMode, next);
                  setMessage(`Theme set to ${next}`);
                }}
                value={colorTheme}
              >
                <SelectTrigger className="w-full" id="color_theme">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slate">Slate</SelectItem>
                  <SelectItem value="ocean">Ocean</SelectItem>
                  <SelectItem value="sunset">Sunset</SelectItem>
                  <SelectItem value="forest">Forest</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

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
                  safeSetApiUrl(apiUrl.trim());
                } else {
                  safeRemoveApiUrl();
                }
                setMessage("API URL saved");
              }}
              type="button"
            >
              Save API URL
            </Button>
            <Button
              onClick={() => {
                setApiUrl(LOCAL_API_URL);
                safeSetApiUrl(LOCAL_API_URL);
                setMessage("API URL reset to local default");
              }}
              type="button"
              variant="outline"
            >
              Use Local API
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
