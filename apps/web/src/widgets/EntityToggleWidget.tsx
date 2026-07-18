import { Group, Stack, Switch, Text } from "@mantine/core";
import { socket, useTopic } from "../lib/socket.js";
import { WidgetCard, type WidgetRenderProps } from "./registry.js";

interface EntityPayload {
  entityId: string;
  state: string;
  attributes: Record<string, unknown>;
  lastChanged: string;
  lastUpdated: string;
}

/**
 * Two-way toggle for a single Home Assistant entity (light, switch, fan, …).
 * State comes from the entity's topic — so changes made anywhere (wall switch,
 * HA app, automation) show up here live. Tapping calls homeassistant.toggle.
 *
 * props: { entity: "light.study_lamp", integration?: "ha", label?: "Study lamp" }
 */
export function EntityToggleWidget({ config }: WidgetRenderProps) {
  const integration =
    typeof config.props.integration === "string" ? config.props.integration : "ha";
  const entity = typeof config.props.entity === "string" ? config.props.entity : undefined;
  const payload = useTopic<EntityPayload>(entity ? `${integration}/entity/${entity}` : undefined);

  if (!entity) {
    return (
      <WidgetCard title={config.title}>
        <Text c="var(--text-muted)">entity-toggle needs an “entity” prop</Text>
      </WidgetCard>
    );
  }

  const state = payload?.state;
  const on = state === "on";
  const unavailable = state === undefined || state === "unavailable" || state === "unknown";
  const friendlyName = payload?.attributes.friendly_name;
  const name =
    (typeof config.props.label === "string" && config.props.label) ||
    (typeof friendlyName === "string" ? friendlyName : entity);
  const statusText =
    state === undefined ? "waiting for Home Assistant…" : unavailable ? state : on ? "on" : "off";

  const toggle = () => {
    if (unavailable) return;
    void socket.action(integration, "toggle", { entity_id: entity });
  };

  return (
    <WidgetCard title={config.title}>
      <Group
        justify="space-between"
        wrap="nowrap"
        mih={56}
        px="xs"
        style={{ flex: 1, borderRadius: 12, cursor: unavailable ? "default" : "pointer" }}
        onClick={toggle}
      >
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text c="var(--text-primary)" truncate>
            {name}
          </Text>
          <Text size="xs" c="var(--text-muted)">
            {statusText}
          </Text>
        </Stack>
        <Switch
          checked={on}
          disabled={unavailable}
          size="lg"
          readOnly
          style={{ pointerEvents: "none" }}
        />
      </Group>
    </WidgetCard>
  );
}
