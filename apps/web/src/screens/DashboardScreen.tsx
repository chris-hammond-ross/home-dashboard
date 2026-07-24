import type { ScreenConfig } from "@home-dashboard/shared";
import { WidgetRenderer } from "../widgets/registry.js";

export function DashboardScreen({ screen }: { screen: ScreenConfig }) {
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: `repeat(${screen.columns}, 1fr)`,
				gridAutoRows: "minmax(150px, auto)",
				gap: 12,
				padding: 12,
				height: "100%",
				overflowY: "auto",
				alignContent: "start",
			}}
		>
			{screen.widgets.map((widget, i) => (
				<div
					key={i}
					style={{
						gridColumn: `span ${Math.min(widget.cols, screen.columns)}`,
						gridRow: `span ${widget.rows}`,
						minWidth: 0,
					}}
				>
					<WidgetRenderer config={widget} />
				</div>
			))}
		</div>
	);
}
