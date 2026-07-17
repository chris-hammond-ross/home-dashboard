import { Group, Stack, Text } from "@mantine/core";
import { useTopic } from "../lib/socket.js";
import { formatEventTime } from "../lib/format.js";
import type { CalendarPayload } from "../lib/payloads.js";
import { WidgetCard, type WidgetRenderProps } from "./registry.js";

/** Fixed categorical assignment — color follows the calendar, never its position. */
const CALENDAR_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
];
const colorByCalendar = new Map<string, string>();

function calendarColor(name: string): string {
  let color = colorByCalendar.get(name);
  if (!color) {
    color = CALENDAR_COLORS[colorByCalendar.size % CALENDAR_COLORS.length]!;
    colorByCalendar.set(name, color);
  }
  return color;
}

export function CalendarWidget({ config }: WidgetRenderProps) {
  const topic = typeof config.props.topic === "string" ? config.props.topic : "demo/calendar";
  const payload = useTopic<CalendarPayload>(topic);
  const events = (payload?.events ?? []).slice(0, 6);

  return (
    <WidgetCard title={config.title ?? "Up next"}>
      {events.length ? (
        <Stack gap="sm" style={{ flex: 1 }}>
          {events.map((event, i) => (
            <Group key={i} gap="sm" wrap="nowrap" align="stretch">
              <div
                style={{
                  width: 3,
                  borderRadius: 2,
                  background: calendarColor(event.calendar),
                  flexShrink: 0,
                }}
              />
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text c="var(--text-primary)" truncate>
                  {event.title}
                </Text>
                <Text size="sm" c="var(--text-secondary)">
                  {formatEventTime(event.start, event.allDay)}
                  <Text span size="sm" c="var(--text-muted)">
                    {" "}
                    · {event.calendar}
                  </Text>
                </Text>
              </Stack>
            </Group>
          ))}
        </Stack>
      ) : (
        <Text c="var(--text-muted)">Nothing coming up</Text>
      )}
    </WidgetCard>
  );
}
