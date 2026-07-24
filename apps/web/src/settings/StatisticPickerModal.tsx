import { useEffect, useMemo, useState } from "react";
import {
	Alert,
	Button,
	Center,
	Group,
	Loader,
	Modal,
	ScrollArea,
	Stack,
	Text,
	TextInput,
	UnstyledButton,
} from "@mantine/core";
import { socket } from "../lib/socket.js";

/**
 * Picker for a Home Assistant long-term statistic — the same shape as
 * EntityPickerModal, but backed by `recorder/list_statistic_ids` rather than
 * the entity list, because history lives in the recorder and not every
 * statistic is a live entity.
 */

export interface StatisticInfo {
	id: string;
	name: string;
	unit: string;
	unitClass: string | null;
	hasSum: boolean;
	hasMean: boolean;
}

interface StatisticPickerModalProps {
	opened: boolean;
	integration?: string;
	onClose: () => void;
	onPick: (id: string) => void;
	/** Offered when the widget can fill several fields at once from HA's prefs. */
	onImportEnergyPrefs?: () => void;
}

export function StatisticPickerModal({
	opened,
	integration = "ha",
	onClose,
	onPick,
	onImportEnergyPrefs,
}: StatisticPickerModalProps) {
	const [stats, setStats] = useState<StatisticInfo[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState("");

	useEffect(() => {
		if (!opened) return;
		setStats(null);
		setError(null);
		setSearch("");
		// statistic_type "sum" is what a kWh meter records; mean-only statistics
		// are power/temperature and can't answer "how much energy".
		void socket
			.action(integration, "list-statistic-ids", { statisticType: "sum" })
			.then((res) => {
				if (res.ok) setStats(res.result as StatisticInfo[]);
				else setError(res.error ?? "failed to list statistics");
			});
	}, [opened, integration]);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return (stats ?? []).filter(
			(s) => !q || s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
		);
	}, [stats, search]);

	return (
		<Modal
			opened={opened}
			onClose={onClose}
			title="Browse energy statistics"
			size="lg"
			centered
		>
			<Stack gap="sm">
				{onImportEnergyPrefs ? (
					<Alert variant="light" color="blue">
						<Group justify="space-between" wrap="nowrap" gap="sm">
							<Text size="sm">
								Home Assistant’s Energy dashboard already knows your grid, solar and
								battery meters.
							</Text>
							<Button
								size="xs"
								variant="light"
								style={{ flexShrink: 0 }}
								onClick={() => {
									onImportEnergyPrefs();
									onClose();
								}}
							>
								Import all
							</Button>
						</Group>
					</Alert>
				) : null}

				<TextInput
					size="sm"
					placeholder="Search by name or statistic id…"
					value={search}
					onChange={(e) => setSearch(e.currentTarget.value)}
					data-autofocus
				/>

				{error ? (
					<Alert color="red" variant="light">
						{error}
					</Alert>
				) : null}
				{!stats && !error ? (
					<Center h={160}>
						<Loader size="sm" />
					</Center>
				) : null}
				{stats && filtered.length === 0 ? (
					<Text size="sm" c="var(--text-muted)" ta="center" py="lg">
						No energy statistics found. Home Assistant records these for sensors with a
						<Text span ff="monospace" size="sm">
							{" "}
							state_class
						</Text>{" "}
						of total or total_increasing.
					</Text>
				) : null}
				{stats && filtered.length > 0 ? (
					<ScrollArea.Autosize mah={380} type="auto">
						<Stack gap={2}>
							{filtered.map((stat) => (
								<UnstyledButton
									key={stat.id}
									onClick={() => {
										onPick(stat.id);
										onClose();
									}}
									style={{ borderRadius: 8 }}
								>
									<Group justify="space-between" wrap="nowrap" px="xs" py={6}>
										<div style={{ minWidth: 0 }}>
											<Text size="sm" truncate>
												{stat.name}
											</Text>
											<Text
												size="xs"
												c="var(--text-muted)"
												truncate
												ff="monospace"
											>
												{stat.id}
											</Text>
										</div>
										<Text
											size="xs"
											c="var(--text-muted)"
											style={{ flexShrink: 0 }}
										>
											{stat.unit}
										</Text>
									</Group>
								</UnstyledButton>
							))}
						</Stack>
					</ScrollArea.Autosize>
				) : null}
			</Stack>
		</Modal>
	);
}

/**
 * HA energy-dashboard source, as `energy/get_prefs` returns it. Current HA uses
 * flat stat_energy_from/to on a grid source; `flow_from`/`flow_to` arrays are
 * the pre-migration shape, still read here in case an old install never
 * migrated.
 */
interface EnergySourcePref {
	type?: string;
	stat_energy_from?: string | null;
	stat_energy_to?: string | null;
	flow_from?: { stat_energy_from?: string | null }[];
	flow_to?: { stat_energy_to?: string | null }[];
}

/**
 * Map HA's Energy dashboard preferences onto our widget props. One click
 * instead of six statistic pickers, and it is exactly the config HA already
 * validated — so if the Energy dashboard works, this does too.
 */
export async function importEnergyPrefs(
	integration: string,
): Promise<{ props: Record<string, string>; error?: string }> {
	const res = await socket.action(integration, "energy-prefs");
	if (!res.ok) return { props: {}, error: res.error ?? "failed to read energy preferences" };
	const sources = (res.result as { energy_sources?: EnergySourcePref[] })?.energy_sources ?? [];
	const props: Record<string, string> = {};
	for (const source of sources) {
		if (source.type === "grid") {
			const from = source.stat_energy_from ?? source.flow_from?.[0]?.stat_energy_from;
			const to = source.stat_energy_to ?? source.flow_to?.[0]?.stat_energy_to;
			if (from) props.gridImportEnergyStat = from;
			if (to) props.gridExportEnergyStat = to;
		} else if (source.type === "solar" && source.stat_energy_from) {
			props.solarEnergyStat = source.stat_energy_from;
		} else if (source.type === "battery") {
			// "from" the battery is discharge into the house; "to" is charging.
			if (source.stat_energy_from) props.batteryDischargeEnergyStat = source.stat_energy_from;
			if (source.stat_energy_to) props.batteryChargeEnergyStat = source.stat_energy_to;
		}
	}
	if (Object.keys(props).length === 0) {
		return { props, error: "Home Assistant's Energy dashboard has no sources configured yet" };
	}
	return { props };
}
