import { Group, Stack, Text } from "@mantine/core";
import { useTopic } from "../lib/socket.js";
import { CONDITION_GLYPHS, type WeatherPayload } from "../lib/payloads.js";
import { WidgetCard, type WidgetRenderProps } from "./registry.js";

export function WeatherWidget({ config }: WidgetRenderProps) {
  const topic = typeof config.props.topic === "string" ? config.props.topic : "demo/weather";
  const weather = useTopic<WeatherPayload>(topic);

  return (
    <WidgetCard title={config.title ?? "Weather"}>
      {weather ? (
        <Stack gap="xs" justify="center" style={{ flex: 1 }}>
          <Group gap="sm" align="baseline">
            <Text fz={48} fw={300} lh={1} c="var(--text-primary)">
              {Math.round(weather.tempC)}°
            </Text>
            <Text fz={28} lh={1}>
              {CONDITION_GLYPHS[weather.condition] ?? ""}
            </Text>
          </Group>
          <Text c="var(--text-secondary)" tt="capitalize">
            {weather.condition.replace("-", " ")} · feels {Math.round(weather.feelsLikeC)}°
          </Text>
          <Text size="sm" c="var(--text-muted)">
            H {Math.round(weather.highC)}° · L {Math.round(weather.lowC)}° · {weather.humidity}%
            humidity · {weather.windKmh} km/h
          </Text>
        </Stack>
      ) : (
        <Text c="var(--text-muted)">Waiting for data…</Text>
      )}
    </WidgetCard>
  );
}
