import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Group, Text } from "@mantine/core";
import { formatWatts } from "../../lib/format.js";
import { WidgetCard, type WidgetRenderProps } from "../registry.js";
import {
  deriveFlows,
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

const EPS = 1;
const NAMES: Record<NodeId, string> = {
  solar: "Solar",
  grid: "Grid",
  home: "Home",
  battery: "Battery",
};

/** Beam dash speed — same model as the node map's particle speed, per 46px. */
const laneDur = (watts: number) => 46 / ((40 + (watts / 1000) * 26) * 0.3);

interface LaneOpts {
  watts: number;
  kind: FlowKind;
  reverse?: boolean;
}

function Lane({ opts }: { opts: LaneOpts | null }) {
  if (!opts || opts.watts <= EPS) {
    return (
      <div className="pf-lane idle">
        <div className="pf-beam" />
        <span className="pf-lanekw" />
      </div>
    );
  }
  const style = {
    "--c": FLOW_COLOR[opts.kind],
    "--dur": `${laneDur(opts.watts).toFixed(3)}s`,
  } as CSSProperties;
  return (
    <div className={`pf-lane active${opts.reverse ? " reverse" : ""}`} style={style}>
      <div className="pf-beam" />
      <span className="pf-lanekw">
        {formatWatts(opts.watts)} {opts.reverse ? "←" : "→"}
      </span>
    </div>
  );
}

function SourceCard({
  icon,
  name,
  watts,
  chip,
  kind,
  active,
  onOpen,
  children,
}: {
  icon: ReactNode;
  name: string;
  watts: number;
  chip: string;
  kind: FlowKind | null;
  active: boolean;
  /** Present when history is available — turns the card into a button. */
  onOpen?: () => void;
  children?: ReactNode;
}) {
  const color = kind ? FLOW_COLOR[kind] : undefined;
  return (
    <div
      className={onOpen ? "pf-card pf-tappable" : "pf-card"}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `${name} history and cost` : undefined}
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
      <div className="pf-cardhead">
        <span className="pf-cardicon">{icon}</span>
        <span className="pf-cardname">{name}</span>
        <span
          className="pf-led"
          style={{
            color: color ?? "var(--flow-idle)",
            background: active ? "currentColor" : undefined,
          }}
        />
      </div>
      <div className="pf-cardval">{formatWatts(watts)}</div>
      <span
        className="pf-chip"
        style={{ borderColor: color ?? "var(--hairline)", color: color ?? "var(--text-muted)" }}
      >
        {chip}
      </span>
      {children}
    </div>
  );
}

const Svg = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);
const SolarIcon = () => (
  <Svg>
    <circle cx={7} cy={5} r={2.2} />
    <path d="M7 1.2v.9 M7 7.9v.9 M3.4 5h.9 M9.7 5h.9 M4.5 2.5l.6.6 M8.9 6.9l.6.6 M9.5 2.5l-.6.6" />
    <path d="M5 12h13l2 8H3z M9.5 12l-.7 8 M13.5 12l.7 8 M4.1 16h15.8" />
  </Svg>
);
const GridIcon = () => (
  <Svg>
    <path d="M8.2 20 11 3h2l2.8 17" />
    <path d="M6.2 7.5h11.6 M7.4 12.5h9.2" />
    <path d="M8.9 20l5.4-7.5 M14.9 20 9.5 12.5" />
  </Svg>
);
const BatteryIcon = () => (
  <Svg>
    <rect x={2.5} y={7} width={16} height={10} rx={2} />
    <path d="M21.5 10.2v3.6" />
    <path
      d="M11.2 8.8 9 12.5h2.6l-1.6 3.2 3.8-4.4h-2.5l1.7-2.5z"
      fill="currentColor"
      stroke="none"
    />
  </Svg>
);
const HomeIcon = () => (
  <Svg>
    <path d="M3.5 10.5 12 3.5l8.5 7" />
    <path d="M5.8 9.3V20h12.4V9.3" />
    <path d="M10 20v-5.2h4V20" />
  </Svg>
);

function solarLane(view: PowerFlowView): LaneOpts | null {
  return view.solarW > EPS ? { watts: view.solarW, kind: "solar" } : null;
}
function gridLane(view: PowerFlowView): LaneOpts | null {
  if (view.gridExportW > EPS) return { watts: view.gridExportW, kind: "export", reverse: true };
  if (view.gridImportW > EPS) return { watts: view.gridImportW, kind: "grid" };
  return null;
}
function batteryLane(view: PowerFlowView): LaneOpts | null {
  if (view.batteryChargeW > EPS)
    return { watts: view.batteryChargeW, kind: "charge", reverse: true };
  if (view.batteryDischargeW > EPS) return { watts: view.batteryDischargeW, kind: "battery" };
  return null;
}

export function SwitchboardVariant({ config }: WidgetRenderProps) {
  const view = usePowerFlow(config);
  const flows = useMemo(() => deriveFlows(view), [view]);
  const cost = useLiveCost(view);
  const [detail, setDetail] = useState<NodeId | null>(null);
  const showCost = config.props.showCost !== false;
  const history = config.props.history !== false;
  const open = (id: NodeId) => (history ? () => setDetail(id) : undefined);

  const feeds = flows.filter((f) => f.to === "home");
  const dominant = feeds.slice().sort((a, b) => b.watts - a.watts)[0];
  const homeLane: LaneOpts | null =
    view.loadW > EPS && dominant ? { watts: view.loadW, kind: dominant.kind } : null;

  const gExport = view.gridExportW > EPS;
  const bCharge = view.batteryChargeW > EPS;

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
        <Text c="var(--text-muted)">Add sensor entities in settings to see power flow.</Text>
      ) : view.waiting ? (
        <Text c="var(--text-muted)">Waiting for data…</Text>
      ) : (
        <div className="pf-boardwrap" style={{ flex: 1, minHeight: 0 }}>
          <div className="pf-board">
            <div className="pf-channels">
              {view.hasSolar ? (
                <div className="pf-channel">
                  <SourceCard
                    icon={<SolarIcon />}
                    name="Solar"
                    watts={view.solarW}
                    chip={view.solarW > EPS ? "Generating" : "Offline"}
                    kind={view.solarW > EPS ? "solar" : null}
                    active={view.solarW > EPS}
                    onOpen={open("solar")}
                  />
                  <Lane opts={solarLane(view)} />
                </div>
              ) : null}

              <div className="pf-channel">
                <SourceCard
                  icon={<GridIcon />}
                  name="Grid"
                  watts={gExport ? view.gridExportW : view.gridImportW}
                  chip={gExport ? "Exporting" : view.gridImportW > EPS ? "Importing" : "Standby"}
                  kind={gExport ? "export" : view.gridImportW > EPS ? "grid" : null}
                  active={gExport || view.gridImportW > EPS}
                  onOpen={open("grid")}
                />
                <Lane opts={gridLane(view)} />
              </div>

              {view.hasBattery ? (
                <div className="pf-channel">
                  <SourceCard
                    icon={<BatteryIcon />}
                    name="Battery"
                    watts={bCharge ? view.batteryChargeW : view.batteryDischargeW}
                    chip={
                      bCharge ? "Charging" : view.batteryDischargeW > EPS ? "Discharging" : "Idle"
                    }
                    kind={bCharge ? "charge" : view.batteryDischargeW > EPS ? "battery" : null}
                    active={bCharge || view.batteryDischargeW > EPS}
                    onOpen={open("battery")}
                  >
                    {view.socPct != null ? (
                      <div className="pf-socwrap">
                        <div className="pf-socbar">
                          <div className="pf-socfill" style={{ width: `${view.socPct}%` }} />
                        </div>
                        <div className="pf-soclabel">{Math.round(view.socPct)}% charged</div>
                      </div>
                    ) : null}
                  </SourceCard>
                  <Lane opts={batteryLane(view)} />
                </div>
              ) : null}
            </div>

            <div
              className="pf-bus"
              style={{
                ["--busglow" as string]: dominant ? FLOW_COLOR[dominant.kind] : "var(--flow-idle)",
              }}
            />

            <div className="pf-homelane">
              <Lane opts={homeLane} />
            </div>

            <div
              className={history ? "pf-home pf-tappable" : "pf-home"}
              role={history ? "button" : undefined}
              tabIndex={history ? 0 : undefined}
              aria-label={history ? "Home consumption history and cost" : undefined}
              onClick={open("home")}
              onKeyDown={
                history
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetail("home");
                      }
                    }
                  : undefined
              }
            >
              <div className="pf-cardhead">
                <span className="pf-cardicon pf-home-icon">
                  <HomeIcon />
                </span>
                <span className="pf-cardname pf-home-name">Home</span>
              </div>
              <div className="pf-homeval">{formatWatts(view.loadW)}</div>
              <div className="pf-eyebrow">Powered by</div>
              <div className="pf-mix">
                {feeds.map((f, i) => (
                  <i
                    key={i}
                    style={{
                      width: `${(f.watts / view.loadW) * 100}%`,
                      background: FLOW_COLOR[f.kind],
                    }}
                  />
                ))}
              </div>
              <div className="pf-mixrows">
                {feeds.map((f, i) => (
                  <div key={i} className="pf-mixrow">
                    <span className="pf-dot" style={{ background: FLOW_COLOR[f.kind] }} />
                    {NAMES[f.from]}
                    <b>{formatWatts(f.watts)}</b>
                  </div>
                ))}
              </div>
              {gExport || bCharge ? (
                <div className="pf-busnotes">
                  {gExport ? (
                    <div style={{ color: FLOW_COLOR.export }}>
                      ↗ Exporting {formatWatts(view.gridExportW)} to grid
                    </div>
                  ) : null}
                  {bCharge ? (
                    <div style={{ color: FLOW_COLOR.charge }}>
                      ⇣ Battery charging at {formatWatts(view.batteryChargeW)}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
      {detail ? (
        <EnergyDetailModal node={detail} config={config} opened onClose={() => setDetail(null)} />
      ) : null}
    </WidgetCard>
  );
}
