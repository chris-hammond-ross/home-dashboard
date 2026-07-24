import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import dayjs from "dayjs";
import {
  formatCents,
  type EnergyHistoryResponse,
  type EnergyRole,
  type WidgetConfig,
} from "@home-dashboard/shared";
import { request } from "../../lib/http.js";
import { StatTile, SubLine } from "../stat-tile.js";
import { UsageChart, type ChartBucket, type ChartSeries } from "./UsageChart.js";
import {
  bucketLabels,
  resolveRange,
  rolesFromConfig,
  stepAnchor,
  type PickedRange,
  type RangeMode,
} from "./ranges.js";
import type { NodeId } from "./model.js";

/**
 * Drill-down for one node of the power-flow widget: usage over a chosen period,
 * with cost when a tariff is active.
 *
 * The server does the work — it queries Home Assistant's hourly statistics,
 * allocates each hour across sources with the same rule the live diagram uses,
 * prices it, and buckets it. This component picks the range and draws it.
 */

const BAND_COLORS = [
  "var(--chart-band-1)",
  "var(--chart-band-2)",
  "var(--chart-band-3)",
  "var(--chart-band-4)",
];

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const NODE_TITLE: Record<NodeId, string> = {
  solar: "Solar generation",
  grid: "Grid",
  battery: "Battery",
  home: "Home consumption",
};

/** Which stacked series each node shows, in fixed order. */
function seriesFor(node: NodeId): ChartSeries[] {
  switch (node) {
    case "home":
      return [
        { key: "mix.solar", label: "Solar", color: "var(--chart-solar)" },
        { key: "mix.battery", label: "Battery", color: "var(--chart-battery)" },
        { key: "mix.grid", label: "Grid", color: "var(--chart-grid)" },
      ];
    case "grid":
      return [
        { key: "gridImport", label: "Imported", color: "var(--chart-grid)" },
        { key: "gridExport", label: "Exported", color: "var(--chart-export)" },
      ];
    case "battery":
      return [
        { key: "batteryCharge", label: "Charged", color: "var(--chart-charge)" },
        { key: "batteryDischarge", label: "Discharged", color: "var(--chart-battery)" },
      ];
    case "solar":
      return [{ key: "solar", label: "Generated", color: "var(--chart-solar)" }];
  }
}

const kwh = (value: number): string =>
  value >= 100 ? `${value.toFixed(0)} kWh` : `${value.toFixed(1)} kWh`;

/** Signed percentage change, or null when the baseline is ~zero. */
function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0.05) return null;
  return ((current - previous) / previous) * 100;
}

export function EnergyDetailModal({
  node,
  config,
  opened,
  onClose,
}: {
  node: NodeId;
  config: WidgetConfig;
  opened: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<RangeMode>("day");
  const [anchor, setAnchor] = useState(() => dayjs());
  const [custom, setCustom] = useState<PickedRange>([null, null]);
  const [metric, setMetric] = useState<"energy" | "cost">("energy");
  const [data, setData] = useState<EnergyHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const roles = useMemo(() => rolesFromConfig(config), [config]);
  const configured = Object.keys(roles).length > 0;
  const range = useMemo(() => resolveRange(mode, anchor, custom), [mode, anchor, custom]);
  const integration =
    typeof config.props.integration === "string" ? config.props.integration : "ha";

  useEffect(() => {
    if (!opened || !range || !configured) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    request<EnergyHistoryResponse>("/api/energy/history", {
      method: "POST",
      body: JSON.stringify({
        integration,
        roles,
        start: range.start,
        end: range.end,
        bucket: range.bucket,
      }),
    })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [opened, range, roles, configured, integration]);

  // Cheapest band gets the lightest step: the ramp reads as a price scale.
  const bands = useMemo(() => {
    const byBand = data?.cost?.byBand ?? [];
    return [...byBand]
      .sort((a, b) => a.centsPerKwh - b.centsPerKwh)
      .map((band, i) => ({
        ...band,
        color: BAND_COLORS[Math.min(i, BAND_COLORS.length - 1)]!,
      }));
  }, [data]);

  const showCostChart = metric === "cost" && bands.length > 0;

  const series: ChartSeries[] = showCostChart
    ? bands.map((band) => ({ key: band.blockId, label: band.label, color: band.color }))
    : seriesFor(node);

  const buckets: ChartBucket[] = useMemo(() => {
    if (!data || !range) return [];
    return data.buckets.map((bucket) => {
      const labels = bucketLabels(bucket.start, range.bucket);
      const values: Record<string, number> = {};
      if (showCostChart) {
        for (const band of bands)
          values[band.blockId] = (bucket.centsByBand[band.blockId] ?? 0) / 100;
      } else {
        values["mix.solar"] = bucket.mix.solar;
        values["mix.battery"] = bucket.mix.battery;
        values["mix.grid"] = bucket.mix.grid;
        for (const [role, value] of Object.entries(bucket.kwh)) values[role] = value;
      }
      return { ...labels, values };
    });
  }, [data, range, showCostChart, bands]);

  const totals = data?.totals;
  const previous = data?.previous;

  /** The headline number for this node, and its period-on-period delta. */
  const headline = useMemo(() => {
    if (!totals) return null;
    const pick = (role: EnergyRole) => ({
      current: totals.kwh[role],
      prev: previous?.kwh[role] ?? 0,
    });
    switch (node) {
      case "home":
        return { label: "Consumed", ...pick("home") };
      case "solar":
        return { label: "Generated", ...pick("solar") };
      case "grid":
        return { label: "Imported", ...pick("gridImport") };
      case "battery":
        return { label: "Discharged", ...pick("batteryDischarge") };
    }
  }, [totals, previous, node]);

  const delta = headline ? deltaPct(headline.current, headline.prev) : null;
  const costDelta =
    data?.cost && data.cost.previousNetCents !== null
      ? deltaPct(data.cost.netCents, data.cost.previousNetCents)
      : null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`${NODE_TITLE[node]} — ${range?.title ?? "select a range"}`}
      size="xl"
      centered
      styles={{ title: { fontWeight: 600 } }}
    >
      <Stack gap="md">
        <Group gap="sm" wrap="wrap">
          <SegmentedControl
            size="sm"
            value={mode}
            onChange={(value) => {
              setMode(value as RangeMode);
              setAnchor(dayjs());
            }}
            data={[
              { label: "Day", value: "day" },
              { label: "Week", value: "week" },
              { label: "Month", value: "month" },
              { label: "Year", value: "year" },
              { label: "Custom", value: "custom" },
            ]}
          />
          {mode === "custom" ? (
            <DatePickerInput
              type="range"
              size="sm"
              w={260}
              placeholder="Pick a start and end date"
              value={custom}
              onChange={setCustom}
              maxDate={dayjs().format("YYYY-MM-DD")}
              clearable
            />
          ) : (
            <Group gap={4}>
              <Button
                size="sm"
                variant="default"
                onClick={() => setAnchor((a) => stepAnchor(mode, a, -1))}
                aria-label="Previous period"
              >
                ‹
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => setAnchor((a) => stepAnchor(mode, a, 1))}
                aria-label="Next period"
                // Nothing to see in the future; the bars would all be empty.
                disabled={!range || dayjs(range.end).isAfter(dayjs())}
              >
                ›
              </Button>
            </Group>
          )}
          {bands.length > 0 ? (
            <SegmentedControl
              size="sm"
              value={metric}
              onChange={(value) => setMetric(value as "energy" | "cost")}
              data={[
                { label: "Energy", value: "energy" },
                { label: "Cost", value: "cost" },
              ]}
            />
          ) : null}
        </Group>

        {!configured ? (
          <Alert color="yellow" variant="light">
            No energy sources are configured for this widget. Add power or energy entities in
            Settings → the power-flow widget, then reopen this panel.
          </Alert>
        ) : null}

        {error ? (
          <Alert color="red" variant="light">
            Could not load history: {error}
          </Alert>
        ) : null}

        {loading && !data ? (
          <Center h={280}>
            <Loader />
          </Center>
        ) : null}

        {data && totals ? (
          <>
            <SimpleGrid cols={{ base: 2, sm: data.cost ? 4 : 2 }} spacing="lg">
              {headline ? (
                <StatTile
                  label={headline.label}
                  value={kwh(headline.current)}
                  sub={
                    delta === null ? (
                      <SubLine>vs {range?.previousLabel}: no data</SubLine>
                    ) : (
                      <SubLine>
                        {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(0)}% vs{" "}
                        {range?.previousLabel}
                      </SubLine>
                    )
                  }
                />
              ) : null}
              {node === "home" && totals.kwh.home > 0 ? (
                <StatTile
                  label="Self-sufficiency"
                  value={`${Math.round(((totals.mix.solar + totals.mix.battery) / totals.kwh.home) * 100)}%`}
                  sub={<SubLine>from solar &amp; battery</SubLine>}
                />
              ) : null}
              {node === "grid" ? (
                <StatTile
                  label="Exported"
                  value={kwh(totals.kwh.gridExport)}
                  sub={
                    data.cost ? (
                      <SubLine>{formatCents(data.cost.exportCents)} credit</SubLine>
                    ) : undefined
                  }
                />
              ) : null}
              {node === "solar" ? (
                <StatTile
                  label="Self-consumed"
                  value={kwh(totals.mix.solar)}
                  sub={
                    totals.kwh.solar > 0 ? (
                      <SubLine>
                        {Math.round((totals.mix.solar / totals.kwh.solar) * 100)}% of generation
                      </SubLine>
                    ) : undefined
                  }
                />
              ) : null}
              {node === "battery" ? (
                <StatTile label="Charged" value={kwh(totals.kwh.batteryCharge)} />
              ) : null}
              {data.cost ? (
                <>
                  <StatTile
                    label="Cost"
                    value={formatCents(data.cost.netCents)}
                    sub={
                      costDelta === null ? (
                        <SubLine>{data.tariff?.name}</SubLine>
                      ) : (
                        <SubLine>
                          {costDelta >= 0 ? "↑" : "↓"} {Math.abs(costDelta).toFixed(0)}% vs{" "}
                          {range?.previousLabel}
                        </SubLine>
                      )
                    }
                  />
                  <StatTile
                    label="Supply charge"
                    value={formatCents(data.cost.supplyCents)}
                    sub={<SubLine>included in cost</SubLine>}
                  />
                </>
              ) : null}
            </SimpleGrid>

            <UsageChart
              buckets={buckets}
              series={series}
              unit={showCostChart ? "$" : "kWh"}
              height={showCostChart ? 260 : 300}
            />

            {data.cost && bands.length > 0 ? (
              <>
                <Divider />
                <Stack gap={6}>
                  <Text size="xs" tt="uppercase" fw={600} lts="0.08em" c="var(--text-muted)">
                    Cost breakdown
                  </Text>
                  {bands.map((band) => (
                    <Group key={band.blockId} justify="space-between" wrap="nowrap">
                      <Group gap={8} wrap="nowrap">
                        <span className="uc-dot" style={{ background: band.color }} />
                        <Text size="sm" c="var(--text-secondary)">
                          {band.label}
                        </Text>
                        <Text size="xs" c="var(--text-muted)">
                          {band.centsPerKwh.toFixed(2)}c/kWh · {kwh(band.kwh)}
                        </Text>
                      </Group>
                      <Text size="sm" c="var(--text-primary)" className="uc-tick">
                        {formatCents(band.cents)}
                      </Text>
                    </Group>
                  ))}
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" c="var(--text-secondary)">
                      Daily supply charge
                    </Text>
                    <Text size="sm" c="var(--text-primary)" className="uc-tick">
                      {formatCents(data.cost.supplyCents)}
                    </Text>
                  </Group>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" c="var(--text-secondary)">
                      Feed-in credit
                    </Text>
                    <Text size="sm" c="var(--text-primary)" className="uc-tick">
                      −{formatCents(data.cost.exportCents)}
                    </Text>
                  </Group>
                  <Divider variant="dotted" />
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" fw={600} c="var(--text-primary)">
                      Total
                    </Text>
                    <Text size="sm" fw={600} c="var(--text-primary)" className="uc-tick">
                      {formatCents(data.cost.netCents)}
                    </Text>
                  </Group>
                </Stack>
              </>
            ) : null}

            {!data.cost ? (
              <Text size="xs" c="var(--text-muted)">
                No tariff is active — add one in Settings → Energy tariff to see costs here.
              </Text>
            ) : null}

            {data.estimated ? (
              <Text size="xs" c="var(--text-muted)">
                Estimated: some figures are integrated from power sensors rather than metered
                energy. Set the kWh statistics in the widget’s settings for exact numbers.
              </Text>
            ) : null}

            {data.missing.length ? (
              <Text size="xs" c="var(--text-muted)">
                No history for: {data.missing.join(", ")}. Home Assistant may not have recorded
                these long enough yet.
              </Text>
            ) : null}

            {/* Ranges are cut in this browser's zone but bucketed and priced in
                the tariff's, so a mismatch shows up as a stray part-bucket at
                each end. Same house, same zone normally — say so when not. */}
            {data.tariff && data.tariff.timezone !== browserZone ? (
              <Text size="xs" c="var(--status-warning)">
                Your tariff is set to {data.tariff.timezone} but this device is in {browserZone}.
                Day boundaries will be slightly off — set them to match in Settings → Energy tariff.
              </Text>
            ) : null}
          </>
        ) : null}
      </Stack>
    </Modal>
  );
}
