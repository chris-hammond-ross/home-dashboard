import type { ReactNode } from "react";
import { SimpleGrid, Stack, Text } from "@mantine/core";
import { useTopic } from "../lib/socket.js";
import { formatWatts } from "../lib/format.js";
import type { EnergyPayload } from "../lib/payloads.js";
import { WidgetCard, type WidgetRenderProps } from "./registry.js";

/**
 * KPI row of stat tiles (per the dataviz guidance: headline numbers are stat
 * tiles, not charts). Values wear ink; status color appears only on small
 * icon+label sub-lines.
 */
function StatTile({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <Stack gap={2}>
      <Text size="xs" tt="uppercase" fw={600} lts="0.08em" c="var(--text-muted)">
        {label}
      </Text>
      <Text fz={28} fw={600} lh={1.15} c="var(--text-primary)">
        {value}
      </Text>
      {sub}
    </Stack>
  );
}

function SubLine({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <Text size="sm" c={color ?? "var(--text-secondary)"}>
      {children}
    </Text>
  );
}

export function EnergyWidget({ config }: WidgetRenderProps) {
  const topic = typeof config.props.topic === "string" ? config.props.topic : "demo/energy";
  const energy = useTopic<EnergyPayload>(topic);

  return (
    <WidgetCard title={config.title ?? "Energy"}>
      {energy ? (
        <SimpleGrid cols={2} spacing="lg" verticalSpacing="md" style={{ flex: 1 }}>
          <StatTile
            label="Solar"
            value={formatWatts(energy.solarW)}
            sub={<SubLine>{energy.solarW > 0 ? "generating" : "idle"}</SubLine>}
          />
          <StatTile label="Home load" value={formatWatts(energy.loadW)} />
          <StatTile
            label="Battery"
            value={`${Math.round(energy.batteryPct)}%`}
            sub={
              energy.batteryPct < 15 ? (
                <SubLine color="var(--status-critical)">⚠ low</SubLine>
              ) : energy.batteryW > 50 ? (
                <SubLine color="var(--status-good)">↑ charging</SubLine>
              ) : energy.batteryW < -50 ? (
                <SubLine>↓ discharging</SubLine>
              ) : (
                <SubLine>idle</SubLine>
              )
            }
          />
          <StatTile
            label="Grid"
            value={formatWatts(Math.abs(energy.gridW))}
            sub={
              energy.gridW < -25 ? (
                <SubLine color="var(--status-good)">↗ exporting</SubLine>
              ) : energy.gridW > 25 ? (
                <SubLine>↘ importing</SubLine>
              ) : (
                <SubLine>balanced</SubLine>
              )
            }
          />
        </SimpleGrid>
      ) : (
        <Text c="var(--text-muted)">Waiting for data…</Text>
      )}
    </WidgetCard>
  );
}
