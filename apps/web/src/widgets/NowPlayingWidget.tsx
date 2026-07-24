import { Group, Progress, Stack, Text } from "@mantine/core";
import { useTopic } from "../lib/socket.js";
import { formatDuration } from "../lib/format.js";
import type { NowPlayingPayload } from "../lib/payloads.js";
import { WidgetCard, type WidgetRenderProps } from "./registry.js";

export function NowPlayingWidget({ config }: WidgetRenderProps) {
	const topic = typeof config.props.topic === "string" ? config.props.topic : "demo/now-playing";
	const playing = useTopic<NowPlayingPayload>(topic);

	return (
		<WidgetCard title={config.title ?? "Now playing"}>
			{playing ? (
				<Stack gap="xs" justify="center" style={{ flex: 1 }}>
					<Text size="xs" c="var(--text-muted)">
						{playing.source} · {playing.state}
					</Text>
					<Text fw={600} lh={1.3} c="var(--text-primary)" lineClamp={2}>
						{playing.title}
					</Text>
					<Text size="sm" c="var(--text-secondary)">
						{playing.show}
					</Text>
					<Progress value={(playing.positionSec / playing.durationSec) * 100} size="xs" />
					<Group justify="space-between">
						<Text
							size="xs"
							c="var(--text-muted)"
							style={{ fontVariantNumeric: "tabular-nums" }}
						>
							{formatDuration(playing.positionSec)}
						</Text>
						<Text
							size="xs"
							c="var(--text-muted)"
							style={{ fontVariantNumeric: "tabular-nums" }}
						>
							{formatDuration(playing.durationSec)}
						</Text>
					</Group>
				</Stack>
			) : (
				<Text c="var(--text-muted)">Nothing playing</Text>
			)}
		</WidgetCard>
	);
}
