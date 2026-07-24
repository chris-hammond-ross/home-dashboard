import { useEffect, useState } from "react";
import { Alert, Button, Card, Center, Flex, Group, Loader, Tabs, Text, Title } from "@mantine/core";
import type { ScreenConfig } from "@home-dashboard/shared";
import { socket, useTopic } from "../lib/socket.js";
import { useHashRoute } from "../lib/useHashRoute.js";
import { fetchBootstrap } from "./api.js";
import { ScreenList } from "./ScreenList.js";
import { ScreenEditor } from "./ScreenEditor.js";
import { TariffEditor } from "./TariffEditor.js";

/**
 * #/settings — screen & widget editor, plus #/settings/tariff for the
 * electricity plan (desktop-first). Screens arrive over the live core/screens
 * topic; a one-shot REST fetch covers the moment before the socket delivers the
 * retained payload.
 */
export function SettingsScreen() {
  const [fetched, setFetched] = useState<ScreenConfig[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const live = useTopic<ScreenConfig[]>("core/screens");
  const route = useHashRoute();
  const tab = route.startsWith("#/settings/tariff") ? "tariff" : "screens";

  useEffect(() => {
    socket.start();
    fetchBootstrap()
      .then((bootstrap) => setFetched(bootstrap.screens))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const screens = live ?? fetched;

  // Selection can go stale when a screen is deleted (possibly elsewhere).
  useEffect(() => {
    if (selectedId && screens && !screens.some((s) => s.id === selectedId)) {
      setSelectedId(null);
    }
  }, [screens, selectedId]);

  const selected = screens?.find((s) => s.id === selectedId) ?? null;

  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <Group justify="space-between" mb="lg" align="flex-start">
          <div>
            <Title order={2}>Settings</Title>
            <Text size="sm" c="var(--text-muted)">
              Changes go live on the dashboard as you save
            </Text>
          </div>
          <Button component="a" href="#/" variant="default" size="sm">
            ← Back to dashboard
          </Button>
        </Group>

        <Tabs
          value={tab}
          onChange={(value) => {
            window.location.hash = value === "tariff" ? "#/settings/tariff" : "#/settings";
          }}
          mb="lg"
        >
          <Tabs.List>
            <Tabs.Tab value="screens">Screens &amp; widgets</Tabs.Tab>
            <Tabs.Tab value="tariff">Energy tariff</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        {tab === "tariff" ? <TariffEditor /> : null}

        {tab === "screens" ? (
          <>
            {error ? (
              <Alert color="red" variant="light" mb="md">
                Failed to load screens: {error}
              </Alert>
            ) : null}

            {!screens && !error ? (
              <Center h={240}>
                <Loader />
              </Center>
            ) : null}

            {screens ? (
              <Flex gap="lg" align="flex-start" wrap="wrap">
                <div style={{ width: 320, flexShrink: 0 }}>
                  <ScreenList screens={screens} selectedId={selectedId} onSelect={setSelectedId} />
                </div>
                <div style={{ flex: 1, minWidth: 360 }}>
                  {selected ? (
                    <ScreenEditor key={selected.id} screen={selected} />
                  ) : (
                    <Card>
                      <Text size="sm" c="var(--text-muted)">
                        Select a screen to edit, or create a new one.
                      </Text>
                    </Card>
                  )}
                </div>
              </Flex>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
