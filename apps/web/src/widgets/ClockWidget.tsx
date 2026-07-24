import { Stack, Text } from "@mantine/core";
import { useNow } from "../lib/useNow.js";
import { formatClock, formatLongDate } from "../lib/format.js";
import { WidgetCard, type WidgetRenderProps } from "./registry.js";

export function ClockWidget({ config }: WidgetRenderProps) {
	const now = useNow(1000);
	return (
		<WidgetCard title={config.title}>
			<Stack gap={0} justify="center" style={{ flex: 1 }}>
				<Text fz={56} fw={300} lh={1.1} c="var(--text-primary)">
					{formatClock(now)}
				</Text>
				<Text fz="lg" c="var(--text-secondary)">
					{formatLongDate(now)}
				</Text>
			</Stack>
		</WidgetCard>
	);
}
