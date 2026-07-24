import { useEffect, useMemo, useState } from "react";
import {
	ActionIcon,
	Alert,
	Badge,
	Button,
	Card,
	Checkbox,
	Group,
	NumberInput,
	Select,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import {
	formatMinutes,
	parseMinutes,
	RATE_KINDS,
	resolveBlock,
	WEEKDAYS,
	type RateBlock,
	type RateKind,
	type Tariff,
	type Weekday,
} from "@home-dashboard/shared";
import {
	createTariff,
	deleteTariff,
	fetchTariffs,
	setActiveTariff,
	updateTariff,
	type StoredTariff,
} from "./api.js";
import { TariffImportWizard } from "./TariffImportWizard.js";
import "./tariff-editor.css";

/**
 * Electricity tariff editor. Tariffs are household data rather than widget
 * props — one plan prices every widget — so they live in their own store with
 * exactly one active at a time, mirroring how screens keep one default.
 *
 * Rates can be imported from the retailer's published CDR data or typed in;
 * either way they end up in the same editable shape.
 */

const BAND_COLORS = [
	"var(--chart-band-1)",
	"var(--chart-band-2)",
	"var(--chart-band-3)",
	"var(--chart-band-4)",
];

const ALL_DAYS: Weekday[] = [...WEEKDAYS];
const WEEKDAY_LABEL: Record<Weekday, string> = {
	MON: "Mon",
	TUE: "Tue",
	WED: "Wed",
	THU: "Thu",
	FRI: "Fri",
	SAT: "Sat",
	SUN: "Sun",
};

const emptyTariff = (): Tariff => ({
	id: "",
	name: "My electricity plan",
	timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
	dailySupplyCents: 0,
	importBlocks: [{ id: "flat", label: "Usage", kind: "flat", centsPerKwh: 30, windows: [] }],
	exportBlocks: [{ id: "fit", label: "Feed-in", kind: "flat", centsPerKwh: 5, windows: [] }],
});

/** Unique-ish block id from a label, so ids stay readable in the API. */
function blockId(label: string, taken: Set<string>): string {
	const base =
		label
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "band";
	let candidate = base;
	for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`;
	return candidate;
}

/**
 * A 24-hour ribbon coloured by which band is in force — the fastest way to see
 * that windows tile the whole day and that nothing overlaps unintentionally.
 * Rendered for a Wednesday; weekend-only bands show on the weekend toggle.
 */
function DayRibbon({
	blocks,
	timezone,
	day,
}: {
	blocks: RateBlock[];
	timezone: string;
	day: 0 | 5;
}) {
	const ramp = useMemo(() => {
		const sorted = [...blocks].sort((a, b) => a.centsPerKwh - b.centsPerKwh);
		return new Map(
			sorted.map((b, i) => [b.id, BAND_COLORS[Math.min(i, BAND_COLORS.length - 1)]!]),
		);
	}, [blocks]);

	// Any Monday works as a reference week; add `day` to land on Sat when asked.
	const base = new Date(Date.UTC(2024, 0, 1));
	const hours = Array.from({ length: 24 }, (_, hour) => {
		const at = new Date(base);
		at.setUTCDate(at.getUTCDate() + day);
		at.setUTCHours(hour, 30, 0, 0);
		const block = resolveBlock(blocks, timezone, at.getTime());
		return { hour, block };
	});

	return (
		<div>
			<div className="te-ribbon">
				{hours.map(({ hour, block }) => (
					<div
						key={hour}
						className="te-ribbon-cell"
						title={block ? `${hour}:00 — ${block.label}` : `${hour}:00 — not priced`}
						style={{
							background: block ? ramp.get(block.id) : "var(--flow-idle)",
						}}
					/>
				))}
			</div>
			<Group justify="space-between" mt={2}>
				<Text size="xs" c="var(--text-muted)">
					12am
				</Text>
				<Text size="xs" c="var(--text-muted)">
					12pm
				</Text>
				<Text size="xs" c="var(--text-muted)">
					12am
				</Text>
			</Group>
		</div>
	);
}

function BlockEditor({
	block,
	onChange,
	onRemove,
}: {
	block: RateBlock;
	onChange: (next: RateBlock) => void;
	onRemove: () => void;
}) {
	const window = block.windows[0];
	const days = new Set(window?.days ?? ALL_DAYS);

	/** A block either has one window or is the catch-all; keep that simple. */
	const setWindow = (patch: Partial<{ startMin: number; endMin: number; days: Weekday[] }>) => {
		const current = window ?? { days: ALL_DAYS, startMin: 0, endMin: 1440 };
		onChange({ ...block, windows: [{ ...current, ...patch }] });
	};

	return (
		<Card withBorder padding="sm" radius="md">
			<Stack gap="xs">
				<Group gap="xs" wrap="nowrap" align="flex-end">
					<TextInput
						size="xs"
						label="Name"
						style={{ flex: 1 }}
						value={block.label}
						onChange={(e) => onChange({ ...block, label: e.currentTarget.value })}
					/>
					<Select
						size="xs"
						w={110}
						label="Kind"
						data={RATE_KINDS as unknown as string[]}
						value={block.kind}
						onChange={(value) =>
							value && onChange({ ...block, kind: value as RateKind })
						}
						allowDeselect={false}
					/>
					<NumberInput
						size="xs"
						w={110}
						label="c/kWh"
						step={0.01}
						decimalScale={2}
						value={block.centsPerKwh}
						onChange={(value) =>
							onChange({
								...block,
								centsPerKwh: typeof value === "number" ? value : 0,
							})
						}
					/>
					<ActionIcon
						size="lg"
						variant="subtle"
						color="gray"
						onClick={onRemove}
						aria-label={`Remove ${block.label}`}
					>
						✕
					</ActionIcon>
				</Group>

				{block.windows.length === 0 ? (
					<Group gap="xs">
						<Text size="xs" c="var(--text-muted)" style={{ flex: 1 }}>
							Applies whenever no other band matches — the catch-all rate.
						</Text>
						<Button
							size="compact-xs"
							variant="default"
							onClick={() => setWindow({ startMin: 0, endMin: 1440, days: ALL_DAYS })}
						>
							Add a time window
						</Button>
					</Group>
				) : (
					<>
						<Group gap="xs" align="flex-end">
							<TextInput
								size="xs"
								w={90}
								label="From"
								placeholder="16:00"
								value={formatMinutes(window!.startMin)}
								onChange={(e) => {
									const parsed = parseMinutes(e.currentTarget.value);
									if (parsed !== null) setWindow({ startMin: parsed });
								}}
							/>
							<TextInput
								size="xs"
								w={90}
								label="To"
								placeholder="21:00"
								value={formatMinutes(window!.endMin)}
								onChange={(e) => {
									const parsed = parseMinutes(e.currentTarget.value);
									if (parsed !== null) setWindow({ endMin: parsed });
								}}
							/>
							<Button
								size="compact-xs"
								variant="subtle"
								color="gray"
								onClick={() => onChange({ ...block, windows: [] })}
							>
								Make this the catch-all
							</Button>
						</Group>
						<Group gap={4}>
							{ALL_DAYS.map((day) => (
								<Checkbox
									key={day}
									size="xs"
									label={WEEKDAY_LABEL[day]}
									checked={days.has(day)}
									onChange={(e) => {
										const next = new Set(days);
										if (e.currentTarget.checked) next.add(day);
										else next.delete(day);
										if (next.size)
											setWindow({
												days: ALL_DAYS.filter((d) => next.has(d)),
											});
									}}
								/>
							))}
						</Group>
						{window!.endMin <= window!.startMin ? (
							<Text size="xs" c="var(--text-muted)">
								Crosses midnight — the days above are the days it starts on.
							</Text>
						) : null}
					</>
				)}
			</Stack>
		</Card>
	);
}

export function TariffEditor() {
	const [tariffs, setTariffs] = useState<StoredTariff[] | null>(null);
	const [draft, setDraft] = useState<Tariff | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string[] | null>(null);
	const [wizard, setWizard] = useState(false);
	const [saving, setSaving] = useState(false);

	const reload = () =>
		fetchTariffs()
			.then((res) => setTariffs(res.tariffs))
			.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));

	useEffect(() => {
		void reload();
	}, []);

	const editBlocks = (which: "importBlocks" | "exportBlocks", next: RateBlock[]) =>
		setDraft((d) => (d ? { ...d, [which]: next } : d));

	const addBlock = (which: "importBlocks" | "exportBlocks") =>
		setDraft((d) => {
			if (!d) return d;
			const taken = new Set(d[which].map((b) => b.id));
			const label = which === "importBlocks" ? "Peak" : "Feed-in";
			return {
				...d,
				[which]: [
					...d[which],
					{
						id: blockId(label, taken),
						label,
						kind: (which === "importBlocks" ? "peak" : "flat") as RateKind,
						centsPerKwh: 0,
						windows:
							which === "importBlocks"
								? [{ days: ALL_DAYS, startMin: 960, endMin: 1260 }]
								: [],
					},
				],
			};
		});

	const save = () => {
		if (!draft) return;
		setSaving(true);
		setError(null);
		const { id: _id, ...body } = draft;
		const promise = editingId
			? updateTariff(editingId, body)
			: createTariff({ ...body, id: undefined });
		promise
			.then(() => {
				setDraft(null);
				setEditingId(null);
				setNotice(null);
				return reload();
			})
			.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
			.finally(() => setSaving(false));
	};

	return (
		<Stack gap="lg">
			<Group justify="space-between" align="flex-start">
				<div>
					<Title order={3}>Energy tariff</Title>
					<Text size="sm" c="var(--text-muted)">
						The active plan prices every energy figure on the dashboard.
					</Text>
				</div>
				{!draft ? (
					<Group gap="sm">
						<Button variant="default" size="sm" onClick={() => setWizard(true)}>
							Import from retailer…
						</Button>
						<Button
							size="sm"
							onClick={() => {
								setDraft(emptyTariff());
								setEditingId(null);
							}}
						>
							New tariff
						</Button>
					</Group>
				) : null}
			</Group>

			{error ? (
				<Alert color="red" variant="light">
					{error}
				</Alert>
			) : null}

			{notice?.length ? (
				<Alert
					color="yellow"
					variant="light"
					title="Imported with caveats"
					withCloseButton
					onClose={() => setNotice(null)}
				>
					<Stack gap={2}>
						{notice.map((n) => (
							<Text key={n} size="sm">
								{n}
							</Text>
						))}
					</Stack>
				</Alert>
			) : null}

			{!draft && tariffs ? (
				<Stack gap="xs">
					{tariffs.length === 0 ? (
						<Card padding="lg">
							<Text size="sm" c="var(--text-muted)">
								No tariff yet. Import your plan’s published rates, or create one and
								enter them by hand — either way the power-flow widget starts showing
								cost.
							</Text>
						</Card>
					) : null}
					{tariffs.map((tariff) => (
						<Card key={tariff.id} padding="sm" radius="md">
							<Group justify="space-between" wrap="nowrap">
								<div style={{ minWidth: 0 }}>
									<Group gap="xs">
										<Text fw={500} truncate>
											{tariff.name}
										</Text>
										{tariff.active ? (
											<Badge size="xs" variant="light">
												active
											</Badge>
										) : null}
									</Group>
									<Text size="xs" c="var(--text-muted)">
										{tariff.importBlocks.length} usage band
										{tariff.importBlocks.length === 1 ? "" : "s"} ·{" "}
										{tariff.dailySupplyCents.toFixed(1)}c/day supply ·{" "}
										{tariff.timezone}
										{tariff.source
											? ` · imported from ${tariff.source.brandName ?? "CDR"}`
											: ""}
									</Text>
								</div>
								<Group gap="xs" wrap="nowrap">
									{!tariff.active ? (
										<Button
											size="xs"
											variant="light"
											onClick={() =>
												void setActiveTariff(tariff.id).then(reload)
											}
										>
											Make active
										</Button>
									) : null}
									<Button
										size="xs"
										variant="default"
										onClick={() => {
											setDraft(tariff);
											setEditingId(tariff.id);
										}}
									>
										Edit
									</Button>
									<Button
										size="xs"
										variant="subtle"
										color="red"
										onClick={() => void deleteTariff(tariff.id).then(reload)}
									>
										Delete
									</Button>
								</Group>
							</Group>
						</Card>
					))}
				</Stack>
			) : null}

			{draft ? (
				<Stack gap="md">
					<Group gap="sm" align="flex-end">
						<TextInput
							size="sm"
							label="Plan name"
							style={{ flex: 1 }}
							value={draft.name}
							onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
						/>
						<TextInput
							size="sm"
							w={220}
							label="Time zone"
							description="Windows are in this zone"
							value={draft.timezone}
							onChange={(e) =>
								setDraft({ ...draft, timezone: e.currentTarget.value })
							}
						/>
						<NumberInput
							size="sm"
							w={170}
							label="Daily supply charge"
							suffix=" c/day"
							step={0.01}
							decimalScale={2}
							value={draft.dailySupplyCents}
							onChange={(value) =>
								setDraft({
									...draft,
									dailySupplyCents: typeof value === "number" ? value : 0,
								})
							}
						/>
					</Group>

					<Stack gap={4}>
						<Text size="xs" tt="uppercase" fw={600} lts="0.08em" c="var(--text-muted)">
							Weekday
						</Text>
						<DayRibbon blocks={draft.importBlocks} timezone={draft.timezone} day={0} />
						<Text
							size="xs"
							tt="uppercase"
							fw={600}
							lts="0.08em"
							c="var(--text-muted)"
							mt="xs"
						>
							Saturday
						</Text>
						<DayRibbon blocks={draft.importBlocks} timezone={draft.timezone} day={5} />
						{draft.importBlocks.every((b) => b.windows.length > 0) ? (
							<Text size="xs" c="var(--text-muted)">
								Grey means no band covers that hour — add a catch-all so every hour
								is priced.
							</Text>
						) : null}
					</Stack>

					<Stack gap="xs">
						<Group justify="space-between">
							<Text
								size="xs"
								tt="uppercase"
								fw={600}
								lts="0.08em"
								c="var(--text-muted)"
							>
								Usage rates
							</Text>
							<Button
								size="compact-xs"
								variant="default"
								onClick={() => addBlock("importBlocks")}
							>
								Add band
							</Button>
						</Group>
						{draft.importBlocks.map((block, i) => (
							<BlockEditor
								key={block.id}
								block={block}
								onChange={(next) =>
									editBlocks(
										"importBlocks",
										draft.importBlocks.map((b, j) => (i === j ? next : b)),
									)
								}
								onRemove={() =>
									editBlocks(
										"importBlocks",
										draft.importBlocks.filter((_, j) => j !== i),
									)
								}
							/>
						))}
					</Stack>

					<Stack gap="xs">
						<Group justify="space-between">
							<Text
								size="xs"
								tt="uppercase"
								fw={600}
								lts="0.08em"
								c="var(--text-muted)"
							>
								Feed-in tariff
							</Text>
							<Button
								size="compact-xs"
								variant="default"
								onClick={() => addBlock("exportBlocks")}
							>
								Add band
							</Button>
						</Group>
						{draft.exportBlocks.map((block, i) => (
							<BlockEditor
								key={block.id}
								block={block}
								onChange={(next) =>
									editBlocks(
										"exportBlocks",
										draft.exportBlocks.map((b, j) => (i === j ? next : b)),
									)
								}
								onRemove={() =>
									editBlocks(
										"exportBlocks",
										draft.exportBlocks.filter((_, j) => j !== i),
									)
								}
							/>
						))}
					</Stack>

					<Group justify="flex-end">
						<Button
							variant="default"
							size="sm"
							onClick={() => {
								setDraft(null);
								setEditingId(null);
								setNotice(null);
							}}
						>
							Cancel
						</Button>
						<Button size="sm" onClick={save} loading={saving}>
							{editingId ? "Save changes" : "Create tariff"}
						</Button>
					</Group>
				</Stack>
			) : null}

			<TariffImportWizard
				opened={wizard}
				onClose={() => setWizard(false)}
				onImported={(tariff, warnings) => {
					setDraft(tariff);
					setEditingId(null);
					setNotice(warnings.length ? warnings : null);
				}}
			/>
		</Stack>
	);
}
