import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Text } from "@mantine/core";
import { formatWatts } from "../../lib/format.js";
import { WidgetCard, type WidgetRenderProps } from "../registry.js";
import {
	deriveFlows,
	flowSignature,
	formatSpendRate,
	FLOW_COLOR,
	useLiveCost,
	usePowerFlow,
	type FlowKind,
	type NodeId,
	type PowerFlowView,
} from "./model.js";
import { EnergyDetailModal } from "./EnergyDetailModal.js";
import "./power-flow.css";

const SVGNS = "http://www.w3.org/2000/svg";
const IDLE = "var(--flow-idle)";
const EPS = 1; // watts below which a source/sink counts as idle

interface NodeGeom {
	x: number;
	y: number;
	r: number;
	label: string;
}

const NODES: Record<NodeId, NodeGeom> = {
	solar: { x: 380, y: 105, r: 56, label: "Solar" },
	grid: { x: 135, y: 300, r: 56, label: "Grid" },
	home: { x: 615, y: 300, r: 58, label: "Home" },
	battery: { x: 380, y: 478, r: 56, label: "Battery" },
};

/** Each flow path is drawn in its direction of travel (start → end). */
const PATHS: Record<string, string> = {
	"solar-home": "M 420 145 C 480 190, 525 215, 560 245",
	"solar-grid": "M 340 145 C 280 190, 225 225, 178 257",
	"solar-battery": "M 380 166 L 380 417",
	"grid-home": "M 196 300 L 528 300",
	"grid-battery": "M 175 340 C 235 402, 280 428, 337 440",
	"battery-home": "M 420 438 C 478 402, 520 378, 560 353",
};

const ICON_PATHS: Record<NodeId, string> = {
	solar: "M6 .6v1.1 M6 7.3v1.1 M2.2 4.5h1.1 M8.7 4.5h1.1 M3.3 1.8l.8.8 M7.9 6.4l.8.8 M8.7 1.8l-.8.8 M4.5 11.5h13l2.2 8h-17.4z M9 11.5l-.8 8 M13 11.5l.8 8 M3.6 15.5h15.8",
	grid: "M8.2 20 11 2h2L15.8 20 M6.2 7h11.6 M7.4 12.5h9.2 M8.9 20l5.4-7.5 M14.9 20 9.5 12.5",
	home: "M3.5 10.5 12 3.5l8.5 7 M5.8 9.3V20h12.4V9.3 M10 20v-5.2h4V20",
	battery: "M20.4 10.2v3.6",
};

type NodeState = { active: false } | { active: true; kind: FlowKind; watts: number; chip: string };

function nodeState(view: PowerFlowView, id: NodeId): NodeState {
	switch (id) {
		case "solar":
			return view.solarW > EPS
				? { active: true, kind: "solar", watts: view.solarW, chip: "Generating" }
				: { active: false };
		case "grid":
			if (view.gridExportW > EPS)
				return { active: true, kind: "export", watts: view.gridExportW, chip: "Exporting" };
			if (view.gridImportW > EPS)
				return { active: true, kind: "grid", watts: view.gridImportW, chip: "Importing" };
			return { active: false };
		case "battery":
			if (view.batteryChargeW > EPS)
				return {
					active: true,
					kind: "charge",
					watts: view.batteryChargeW,
					chip: "Charging",
				};
			if (view.batteryDischargeW > EPS)
				return {
					active: true,
					kind: "battery",
					watts: view.batteryDischargeW,
					chip: "Discharging",
				};
			return { active: false };
		case "home":
			return { active: true, kind: "solar", watts: view.loadW, chip: "Consuming" };
	}
}

function Node({ id, view, onOpen }: { id: NodeId; view: PowerFlowView; onOpen?: () => void }) {
	const n = NODES[id];
	const st = nodeState(view, id);
	const isHome = id === "home";
	const ringColor = isHome ? "var(--hairline)" : st.active ? FLOW_COLOR[st.kind] : IDLE;
	const chipColor = st.active && !isHome ? FLOW_COLOR[st.kind] : "var(--text-muted)";
	const value = id === "solar" ? view.solarW : st.active ? st.watts : 0;

	return (
		<g
			opacity={isHome || st.active ? 1 : 0.5}
			className={onOpen ? "pf-node" : undefined}
			role={onOpen ? "button" : undefined}
			tabIndex={onOpen ? 0 : undefined}
			aria-label={onOpen ? `${n.label} history and cost` : undefined}
			onClick={onOpen}
			onKeyDown={
				onOpen
					? (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onOpen();
							}
						}
					: undefined
			}
		>
			{/* The visible circle is ~112px across, but a transparent disc makes the
          whole node — icon, label, value, chip — one comfortable tap target. */}
			{onOpen ? <circle cx={n.x} cy={n.y} r={n.r + 26} fill="transparent" /> : null}
			<circle
				cx={n.x}
				cy={n.y}
				r={n.r}
				fill="var(--surface-1)"
				stroke={ringColor}
				strokeWidth={2}
			/>
			{st.active && !isHome ? (
				<circle
					cx={n.x}
					cy={n.y}
					r={n.r}
					fill="none"
					stroke={ringColor}
					strokeWidth={7}
					opacity={0.16}
				/>
			) : null}

			<g
				transform={`translate(${n.x - (id === "battery" ? 30 : 16)},${n.y - 40}) scale(${id === "battery" ? 1.25 : 1.35})`}
				stroke="var(--text-primary)"
				strokeWidth={1.7}
				strokeLinecap="round"
				strokeLinejoin="round"
				fill="none"
			>
				{id === "solar" ? <circle cx={6} cy={4.5} r={2.4} /> : null}
				{id === "battery" ? <rect x={3} y={7} width={15} height={10} rx={2} /> : null}
				{id === "battery" ? (
					<path
						d="M11.4 8.6 9.2 12.4h2.5l-1.5 3.4 3.6-4.6h-2.4l1.7-2.6z"
						fill="var(--text-primary)"
						stroke="none"
					/>
				) : null}
				<path d={ICON_PATHS[id]} />
			</g>

			{id === "battery" && view.socPct != null ? (
				<text
					x={n.x + 22}
					y={n.y - 20}
					fontSize={12}
					className="pf-val"
					fill="var(--text-muted)"
				>
					{Math.round(view.socPct)}%
				</text>
			) : null}

			<text x={n.x} y={n.y + 8} textAnchor="middle" fontSize={13} fill="var(--text-muted)">
				{n.label}
			</text>
			<text
				x={n.x}
				y={n.y + 32}
				textAnchor="middle"
				fontSize={17}
				className="pf-val"
				fill="var(--text-primary)"
			>
				{formatWatts(value)}
			</text>

			<g>
				<rect
					x={n.x - 44}
					y={n.y + n.r + 8}
					width={88}
					height={18}
					rx={9}
					fill="var(--page-plane)"
					stroke={chipColor}
					strokeWidth={1}
					opacity={0.9}
				/>
				<text
					x={n.x}
					y={n.y + n.r + 20}
					textAnchor="middle"
					fontSize={11}
					fontWeight={500}
					fill={chipColor}
				>
					{st.active
						? st.chip
						: id === "grid"
							? "Standby"
							: id === "battery"
								? "Idle"
								: "Offline"}
				</text>
			</g>
		</g>
	);
}

/** Consumption ring around the Home node, split by feeding source. */
function Donut({ flows }: { flows: ReturnType<typeof deriveFlows> }) {
	const n = NODES.home;
	const R = 74;
	const C = 2 * Math.PI * R;
	const feeds = flows.filter((f) => f.to === "home");
	const load = feeds.reduce((s, f) => s + f.watts, 0);
	if (load <= 0) return null;
	const gap = feeds.length > 1 ? 5 : 0;
	let acc = 0;
	return (
		<g>
			<circle
				cx={n.x}
				cy={n.y}
				r={R}
				fill="none"
				stroke="var(--flow-idle)"
				strokeWidth={6}
				opacity={0.4}
			/>
			{feeds.map((f, i) => {
				const seg = (f.watts / load) * C - gap;
				const el = (
					<circle
						key={i}
						cx={n.x}
						cy={n.y}
						r={R}
						fill="none"
						stroke={FLOW_COLOR[f.kind]}
						strokeWidth={6}
						strokeLinecap="round"
						strokeDasharray={`${Math.max(seg, 2)} ${C}`}
						strokeDashoffset={-acc}
						transform={`rotate(-90 ${n.x} ${n.y})`}
					/>
				);
				acc += seg + gap;
				return el;
			})}
		</g>
	);
}

export function NodeMapVariant({ config }: WidgetRenderProps) {
	const view = usePowerFlow(config);
	const flows = useMemo(() => deriveFlows(view), [view]);
	const sig = flowSignature(flows);
	const cost = useLiveCost(view);
	const [detail, setDetail] = useState<NodeId | null>(null);
	const showCost = config.props.showCost !== false;
	const history = config.props.history !== false;

	const reduced = useMemo(
		() =>
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches,
		[],
	);

	const trackRefs = useRef<Map<string, SVGPathElement>>(new Map());
	const particlesRef = useRef<SVGGElement>(null);

	useEffect(() => {
		if (reduced) return;
		const group = particlesRef.current;
		if (!group) return;

		interface Dot {
			off: number;
			core: SVGCircleElement;
			halo: SVGCircleElement;
		}
		interface Track {
			path: SVGPathElement;
			len: number;
			dots: Dot[];
			speed: number;
		}

		const tracks: Track[] = [];
		for (const f of flows) {
			const path = trackRefs.current.get(`${f.from}-${f.to}`);
			if (!path) continue;
			const len = path.getTotalLength();
			const kw = f.watts / 1000;
			const count = Math.min(7, Math.max(2, Math.round(1 + kw)));
			const color = FLOW_COLOR[f.kind];
			const dots: Dot[] = [];
			for (let i = 0; i < count; i++) {
				const halo = document.createElementNS(SVGNS, "circle");
				halo.setAttribute("r", "6.5");
				halo.setAttribute("fill", color);
				halo.setAttribute("opacity", "0.22");
				const core = document.createElementNS(SVGNS, "circle");
				core.setAttribute("r", "3");
				core.setAttribute("fill", color);
				group.append(halo, core);
				dots.push({ off: (len / count) * i, core, halo });
			}
			tracks.push({ path, len, dots, speed: (40 + kw * 26) * 0.3 });
		}

		let raf = 0;
		let last = performance.now();
		const tick = (now: number) => {
			const dt = Math.min(0.05, (now - last) / 1000);
			last = now;
			for (const t of tracks) {
				for (const d of t.dots) {
					d.off = (d.off + t.speed * dt) % t.len;
					const p = t.path.getPointAtLength(d.off);
					d.core.setAttribute("cx", String(p.x));
					d.core.setAttribute("cy", String(p.y));
					d.halo.setAttribute("cx", String(p.x));
					d.halo.setAttribute("cy", String(p.y));
				}
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(raf);
			group.replaceChildren();
		};
		// flows content is captured by `sig`; identity churn shouldn't restart the loop.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sig, reduced]);

	const visible: NodeId[] = ["grid", "home"];
	if (view.hasSolar) visible.unshift("solar");
	if (view.hasBattery) visible.push("battery");

	return (
		<WidgetCard title={config.title ?? "Power flow"}>
			{showCost && cost ? (
				<Group gap={8} wrap="nowrap">
					<Text size="sm" c="var(--text-secondary)">
						{cost.bandLabel} {cost.centsPerKwh.toFixed(1)}c
					</Text>
					<Text size="sm" c="var(--text-primary)" className="pf-val">
						{formatSpendRate(cost.centsPerHour)}
					</Text>
				</Group>
			) : null}
			{!view.configured ? (
				<Text c="var(--text-muted)">
					Add sensor entities in settings to see power flow.
				</Text>
			) : view.waiting ? (
				<Text c="var(--text-muted)">Waiting for data…</Text>
			) : (
				<div className="pf-stage" style={{ flex: 1, minHeight: 0 }}>
					<svg
						viewBox="0 0 760 560"
						preserveAspectRatio="xMidYMid meet"
						style={{ width: "100%", height: "100%", display: "block" }}
						aria-label="Home energy flow diagram"
					>
						<g>
							{flows.map((f) => (
								<path
									key={`${f.from}-${f.to}`}
									ref={(el) => {
										if (el) trackRefs.current.set(`${f.from}-${f.to}`, el);
										else trackRefs.current.delete(`${f.from}-${f.to}`);
									}}
									d={PATHS[`${f.from}-${f.to}`]}
									fill="none"
									stroke={FLOW_COLOR[f.kind]}
									strokeWidth={2}
									opacity={0.22}
									strokeDasharray={reduced ? "6 6" : undefined}
								/>
							))}
						</g>
						<g ref={particlesRef} />
						<Donut flows={flows} />
						{visible.map((id) => (
							<Node
								key={id}
								id={id}
								view={view}
								onOpen={history ? () => setDetail(id) : undefined}
							/>
						))}
					</svg>
				</div>
			)}
			{detail ? (
				<EnergyDetailModal
					node={detail}
					config={config}
					opened
					onClose={() => setDetail(null)}
				/>
			) : null}
		</WidgetCard>
	);
}
