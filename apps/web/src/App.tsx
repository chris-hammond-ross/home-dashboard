import { useEffect, useRef, useState } from "react";
import { Button, Center, Loader, SegmentedControl, Text } from "@mantine/core";
import type { FrontendBootstrap, ScreenConfig } from "@home-dashboard/shared";
import { socket, useConnected, useTopic } from "./lib/socket.js";
import { useHashRoute } from "./lib/useHashRoute.js";
import { DashboardScreen } from "./screens/DashboardScreen.js";
import { AmbientScreen } from "./screens/AmbientScreen.js";
import { SettingsScreen } from "./settings/SettingsScreen.js";

const LAST_VIEW_KEY = "hd.lastView";

interface LastView {
  screenId: string;
  at: number;
}

function readLastView(): LastView | null {
  try {
    const raw = localStorage.getItem(LAST_VIEW_KEY);
    return raw ? (JSON.parse(raw) as LastView) : null;
  } catch {
    return null;
  }
}

function writeLastView(view: LastView): void {
  localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(view));
}

function defaultScreenId(screens: ScreenConfig[]): string | null {
  return (screens.find((s) => s.default) ?? screens[0])?.id ?? null;
}

/** The resume rule: restore the last view only if it's recent enough. */
function resolveScreen(bootstrap: FrontendBootstrap): string | null {
  const stored = readLastView();
  const fresh =
    stored !== null &&
    Date.now() - stored.at <= bootstrap.ambient.resumeWindowMinutes * 60_000 &&
    bootstrap.screens.some((s) => s.id === stored.screenId);
  return fresh && stored ? stored.screenId : defaultScreenId(bootstrap.screens);
}

export function App() {
  const route = useHashRoute();
  if (route.startsWith("#/settings")) return <SettingsScreen />;
  return <KioskApp />;
}

function KioskApp() {
  const [bootstrap, setBootstrap] = useState<FrontendBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ambient, setAmbient] = useState(false);
  const [screenId, setScreenId] = useState<string | null>(null);
  const connected = useConnected();
  const liveScreens = useTopic<ScreenConfig[]>("core/screens");

  const lastActivity = useRef(Date.now());
  const ambientRef = useRef(ambient);
  ambientRef.current = ambient;
  const screenRef = useRef(screenId);
  screenRef.current = screenId;

  useEffect(() => {
    socket.start();
    fetch("/api/screens")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<FrontendBootstrap>;
      })
      .then((data) => {
        setScreenId(resolveScreen(data));
        setBootstrap(data);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Live screen edits from the settings UI (retained core/screens topic).
  useEffect(() => {
    if (!liveScreens) return;
    setBootstrap((prev) => (prev ? { ...prev, screens: liveScreens } : prev));
    setScreenId((current) => {
      if (current && liveScreens.some((s) => s.id === current)) return current;
      return defaultScreenId(liveScreens);
    });
  }, [liveScreens]);

  // Track interaction: reset the idle timer, and remember the current view
  // (only while the dashboard is visible — a wake touch must not count).
  useEffect(() => {
    if (!bootstrap) return;
    const mark = () => {
      lastActivity.current = Date.now();
      if (!ambientRef.current && screenRef.current) {
        writeLastView({ screenId: screenRef.current, at: lastActivity.current });
      }
    };
    window.addEventListener("pointerdown", mark, { capture: true });
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current >= bootstrap.ambient.idleSeconds * 1000) {
        setAmbient(true);
      }
    }, 5000);
    return () => {
      window.removeEventListener("pointerdown", mark, { capture: true });
      clearInterval(timer);
    };
  }, [bootstrap]);

  if (error) {
    return (
      <Center h="100%">
        <Text c="var(--status-critical)">⚠ Failed to load dashboard config: {error}</Text>
      </Center>
    );
  }
  if (!bootstrap) {
    return (
      <Center h="100%">
        <Loader />
      </Center>
    );
  }

  const screens = bootstrap.screens;
  if (screens.length === 0) {
    return (
      <Center h="100%">
        <div style={{ textAlign: "center" }}>
          <Text c="var(--text-secondary)" mb="md">
            No screens configured.
          </Text>
          <Button component="a" href="#/settings" variant="light">
            Open Settings
          </Button>
        </div>
      </Center>
    );
  }
  const active = screens.find((s) => s.id === screenId) ?? screens[0]!;

  const wake = () => {
    setScreenId(resolveScreen(bootstrap));
    lastActivity.current = Date.now();
    setAmbient(false);
  };

  const selectScreen = (id: string) => {
    setScreenId(id);
    lastActivity.current = Date.now();
    writeLastView({ screenId: id, at: lastActivity.current });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DashboardScreen screen={active} />
      </div>
      {screens.length > 1 ? (
        <div style={{ padding: "0 12px 12px" }}>
          <SegmentedControl
            fullWidth
            size="lg"
            value={active.id}
            onChange={selectScreen}
            data={screens.map((s) => ({ label: s.name, value: s.id }))}
          />
        </div>
      ) : null}
      {!connected ? (
        <div
          style={{
            position: "fixed",
            top: 12,
            right: 12,
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--surface-1)",
            border: "1px solid var(--hairline)",
            borderRadius: 999,
            padding: "6px 14px",
          }}
        >
          <span style={{ color: "var(--status-warning)", fontSize: 12 }}>●</span>
          <Text size="sm" c="var(--text-secondary)">
            reconnecting…
          </Text>
        </div>
      ) : null}
      {ambient ? <AmbientScreen ambient={bootstrap.ambient} onWake={wake} /> : null}
    </div>
  );
}
