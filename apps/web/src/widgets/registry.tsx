import type { ReactNode } from "react";
import { Card, Stack, Text } from "@mantine/core";
import type { WidgetConfig } from "@home-dashboard/shared";
import { ClockWidget } from "./ClockWidget.js";
import { EmberVariant } from "./weather/EmberVariant.js";
import { MeridianVariant } from "./weather/MeridianVariant.js";
import { NocturneVariant } from "./weather/NocturneVariant.js";
import { EnergyWidget } from "./EnergyWidget.js";
import { LightWidget } from "./lights/LightWidget.js";
import { LightGroupWidget } from "./lights/LightGroupWidget.js";
import { CalendarWidget } from "./CalendarWidget.js";
import { NowPlayingWidget } from "./NowPlayingWidget.js";
import { EntityToggleWidget } from "./EntityToggleWidget.js";
import { NodeMapVariant } from "./power-flow/NodeMapVariant.js";
import { SwitchboardVariant } from "./power-flow/SwitchboardVariant.js";

export interface WidgetRenderProps {
  config: WidgetConfig;
}

type WidgetComponent = (props: WidgetRenderProps) => ReactNode;

/** A widget type that ships more than one interchangeable visual variant. */
interface VariantEntry {
  variants: Record<string, WidgetComponent>;
  defaultVariant: string;
}

type RegistryEntry = WidgetComponent | VariantEntry;

/**
 * Widget type → renderer. A value is either a single component, or a
 * `VariantEntry` declaring several named components the user can pick between
 * (config.variant, edited in the settings UI). Adding a variant to a widget is
 * just another key in its `variants` map plus a `meta.ts` entry.
 */
const registry: Record<string, RegistryEntry> = {
  clock: ClockWidget,
  weather: {
    defaultVariant: "nocturne",
    variants: { ember: EmberVariant, meridian: MeridianVariant, nocturne: NocturneVariant },
  },
  energy: EnergyWidget,
  light: LightWidget,
  "light-group": LightGroupWidget,
  calendar: CalendarWidget,
  "now-playing": NowPlayingWidget,
  "entity-toggle": EntityToggleWidget,
  "home-power-flow": {
    defaultVariant: "node-map",
    variants: { "node-map": NodeMapVariant, switchboard: SwitchboardVariant },
  },
};

/** Resolve the component for a config, honoring its chosen (or default) variant. */
function resolve(entry: RegistryEntry | undefined, variant: string | undefined) {
  if (!entry) return undefined;
  if (typeof entry === "function") return entry;
  return entry.variants[variant ?? entry.defaultVariant] ?? entry.variants[entry.defaultVariant];
}

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
  const Component = resolve(registry[config.type], config.variant);
  if (!Component) {
    return (
      <WidgetCard title={config.title ?? config.type}>
        <Text c="var(--text-muted)">Unknown widget type “{config.type}”</Text>
      </WidgetCard>
    );
  }
  return <Component config={config} />;
}
