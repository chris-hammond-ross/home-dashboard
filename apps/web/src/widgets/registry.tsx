import type { ReactNode } from "react";
import { Card, Stack, Text } from "@mantine/core";
import type { WidgetConfig } from "@home-dashboard/shared";
import { ClockWidget } from "./ClockWidget.js";
import { WeatherWidget } from "./WeatherWidget.js";
import { EnergyWidget } from "./EnergyWidget.js";
import { LightsWidget } from "./LightsWidget.js";
import { CalendarWidget } from "./CalendarWidget.js";
import { NowPlayingWidget } from "./NowPlayingWidget.js";
import { EntityToggleWidget } from "./EntityToggleWidget.js";

export interface WidgetRenderProps {
  config: WidgetConfig;
}

type WidgetComponent = (props: WidgetRenderProps) => ReactNode;

const registry: Record<string, WidgetComponent> = {
  clock: ClockWidget,
  weather: WeatherWidget,
  energy: EnergyWidget,
  lights: LightsWidget,
  calendar: CalendarWidget,
  "now-playing": NowPlayingWidget,
  "entity-toggle": EntityToggleWidget,
};

/** Shared card chrome: fills its grid cell, optional mini-label title. */
export function WidgetCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Card h="100%" style={{ overflow: "hidden" }}>
      <Stack gap="xs" h="100%">
        {title ? (
          <Text size="xs" tt="uppercase" fw={600} lts="0.08em" c="var(--text-muted)">
            {title}
          </Text>
        ) : null}
        {children}
      </Stack>
    </Card>
  );
}

export function WidgetRenderer({ config }: WidgetRenderProps) {
  const Component = registry[config.type];
  if (!Component) {
    return (
      <WidgetCard title={config.title ?? config.type}>
        <Text c="var(--text-muted)">Unknown widget type “{config.type}”</Text>
      </WidgetCard>
    );
  }
  return <Component config={config} />;
}
