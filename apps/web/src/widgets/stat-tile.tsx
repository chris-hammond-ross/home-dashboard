import type { ReactNode } from "react";
import { Stack, Text } from "@mantine/core";

/**
 * KPI stat tile — the house form for a headline number (per the dataviz rules:
 * headline numbers are stat tiles, not charts). Values wear ink tokens; any
 * status colour appears only on the small sub-line, paired with a word.
 *
 * Shared by EnergyWidget and the energy drill-down so a kWh figure looks the
 * same wherever it appears.
 */
export function StatTile({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
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

export function SubLine({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <Text size="sm" c={color ?? "var(--text-secondary)"}>
      {children}
    </Text>
  );
}
