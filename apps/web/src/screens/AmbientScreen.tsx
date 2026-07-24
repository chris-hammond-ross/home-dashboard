import { Stack, Text } from "@mantine/core";
import type { AmbientConfig } from "@home-dashboard/shared";
import { useTopic } from "../lib/socket.js";
import { useNow } from "../lib/useNow.js";
import { formatClock, formatEventTime, formatLongDate } from "../lib/format.js";
import { CONDITION_GLYPHS, type CalendarPayload, type WeatherPayload } from "../lib/payloads.js";

function greeting(hour: number): string {
	if (hour < 5) return "Good night";
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}

/**
 * The always-on ambient (lock) layer: big clock, date, a weather line, and the
 * next event. Any touch wakes the dashboard. Phase 2 turns the info slot into
 * time-of-day scenes (morning report, evening summary, ...).
 */
export function AmbientScreen({ ambient, onWake }: { ambient: AmbientConfig; onWake: () => void }) {
	const now = useNow(1000);
	const weather = useTopic<WeatherPayload>(ambient.weatherTopic);
	const calendar = useTopic<CalendarPayload>(ambient.calendarTopic);
	const nextEvent = calendar?.events[0];

	// Nudge the clock a few px each hour to spread panel wear.
	const hour = now.getHours();
	const shiftX = (hour % 5) * 2 - 4;
	const shiftY = (hour % 3) * 3 - 3;

	return (
		<div
			onPointerDown={onWake}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 100,
				background:
					"radial-gradient(120% 90% at 50% 0%, #15171c 0%, var(--page-plane) 65%)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				cursor: "pointer",
				animation: "hd-fade-in 500ms ease both",
			}}
		>
			<Stack
				align="center"
				gap="sm"
				style={{ transform: `translate(${shiftX}px, ${shiftY}px)` }}
			>
				<Text fz="xl" c="var(--text-muted)">
					{greeting(hour)}
				</Text>
				<Text fz="clamp(5rem, 16vw, 11rem)" fw={200} lh={1} c="var(--text-primary)">
					{formatClock(now)}
				</Text>
				<Text fz="1.5rem" c="var(--text-secondary)">
					{formatLongDate(now)}
				</Text>
				{weather ? (
					<Text fz="1.25rem" c="var(--text-secondary)" mt="md">
						{Math.round(weather.tempC)}° {CONDITION_GLYPHS[weather.condition] ?? ""}{" "}
						<Text span fz="1.25rem" c="var(--text-muted)" tt="capitalize">
							{weather.condition.replace("-", " ")}
						</Text>
					</Text>
				) : null}
				{nextEvent ? (
					<Text fz="md" c="var(--text-muted)">
						Next · {nextEvent.title} ·{" "}
						{formatEventTime(nextEvent.start, nextEvent.allDay)}
					</Text>
				) : null}
			</Stack>
			<Text
				size="sm"
				c="var(--text-muted)"
				style={{ position: "absolute", bottom: 40, left: 0, right: 0, textAlign: "center" }}
			>
				Touch to wake
			</Text>
		</div>
	);
}
