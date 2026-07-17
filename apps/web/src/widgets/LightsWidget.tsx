import { Button, Group, ScrollArea, Stack, Switch, Text } from "@mantine/core";
import { socket, useTopic } from "../lib/socket.js";
import type { LightsPayload } from "../lib/payloads.js";
import { WidgetCard, type WidgetRenderProps } from "./registry.js";

export function LightsWidget({ config }: WidgetRenderProps) {
  const integration =
    typeof config.props.integration === "string" ? config.props.integration : "demo";
  const topic =
    typeof config.props.topic === "string" ? config.props.topic : `${integration}/lights`;
  const payload = useTopic<LightsPayload>(topic);
  const lights = payload?.lights ?? [];
  const onCount = lights.filter((l) => l.on).length;

  return (
    <WidgetCard title={config.title ?? "Lights"}>
      <Group justify="space-between">
        <Text size="sm" c="var(--text-secondary)">
          {onCount} on
        </Text>
        <Button
          variant="subtle"
          size="compact-sm"
          disabled={onCount === 0}
          onClick={() => void socket.action(integration, "light.all-off")}
        >
          All off
        </Button>
      </Group>
      <ScrollArea style={{ flex: 1 }} type="never">
        <Stack gap={4}>
          {lights.map((light) => (
            <Group
              key={light.id}
              justify="space-between"
              wrap="nowrap"
              mih={48}
              px="xs"
              style={{ borderRadius: 12, cursor: "pointer" }}
              onClick={() => void socket.action(integration, "light.toggle", { id: light.id })}
            >
              <Stack gap={0}>
                <Text c="var(--text-primary)">{light.name}</Text>
                <Text size="xs" c="var(--text-muted)">
                  {light.room}
                </Text>
              </Stack>
              <Switch checked={light.on} size="md" readOnly style={{ pointerEvents: "none" }} />
            </Group>
          ))}
        </Stack>
      </ScrollArea>
    </WidgetCard>
  );
}
