import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  List,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { formatMinutes, type Tariff } from "@home-dashboard/shared";
import { fetchPlans, fetchPlanTariff, fetchRetailers, type PlanSummary } from "./api.js";

/**
 * Import a tariff from the retailer's own published rates.
 *
 * Australian retailers must publish Product Reference Data under the Consumer
 * Data Right, and the AER mirrors all of it publicly — so the real peak /
 * shoulder / off-peak rates, their time windows, the daily supply charge and
 * the feed-in tariff can be pulled in rather than typed off a bill. The server
 * proxies and caches the lookup; nothing here talks to the internet directly.
 *
 * Every step is optional: the editor behind this dialog always accepts manual
 * entry, and an imported plan stays fully editable.
 */
export function TariffImportWizard({
  opened,
  onClose,
  onImported,
}: {
  opened: boolean;
  onClose: () => void;
  onImported: (tariff: Tariff, warnings: string[]) => void;
}) {
  const [retailers, setRetailers] = useState<{ value: string; label: string }[] | null>(null);
  const [retailer, setRetailer] = useState<string | null>(null);
  const [postcode, setPostcode] = useState("");
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ tariff: Tariff; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened || retailers) return;
    setError(null);
    fetchRetailers()
      .then((res) =>
        setRetailers(
          res.retailers
            // Mantine's Select throws on an option with no value, which would
            // take out the whole dialog rather than drop one bad row.
            .filter((r) => r.id && r.name)
            .map((r) => ({ value: r.id, label: r.name })),
        ),
      )
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [opened, retailers]);

  const loadPlans = () => {
    if (!retailer) return;
    setBusy(true);
    setError(null);
    setPlans(null);
    setPlanId(null);
    setPreview(null);
    fetchPlans(retailer, postcode.trim() || undefined)
      .then((res) => setPlans(res.plans))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const loadPreview = (id: string) => {
    if (!retailer) return;
    setPlanId(id);
    setBusy(true);
    setError(null);
    setPreview(null);
    fetchPlanTariff(retailer, id)
      .then(setPreview)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const reset = () => {
    setPlans(null);
    setPlanId(null);
    setPreview(null);
    setError(null);
  };

  return (
    <Modal
      opened={opened}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import rates from your retailer"
      size="lg"
      centered
    >
      <Stack gap="sm">
        <Text size="sm" c="var(--text-secondary)">
          Rates come from the Australian Energy Regulator’s public Consumer Data Right feed — the
          same data behind Energy Made Easy. Pick your retailer and postcode to narrow the list to
          plans available at your address.
        </Text>

        <Group gap="sm" align="flex-end">
          <Select
            style={{ flex: 1 }}
            size="sm"
            label="Retailer"
            placeholder={retailers ? "Search retailers…" : "Loading…"}
            data={retailers ?? []}
            value={retailer}
            onChange={(value) => {
              setRetailer(value);
              reset();
            }}
            searchable
            disabled={!retailers}
          />
          <TextInput
            size="sm"
            w={120}
            label="Postcode"
            placeholder="5000"
            value={postcode}
            maxLength={4}
            onChange={(e) => setPostcode(e.currentTarget.value.replace(/\D/g, ""))}
          />
          <Button size="sm" onClick={loadPlans} disabled={!retailer || busy}>
            Find plans
          </Button>
        </Group>

        {error ? (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        ) : null}

        {busy ? <Loader size="sm" /> : null}

        {plans && plans.length === 0 ? (
          <Alert color="yellow" variant="light">
            No residential electricity plans found for that retailer and postcode. Check the
            postcode, or close this and enter your rates by hand.
          </Alert>
        ) : null}

        {plans && plans.length > 0 ? (
          <Select
            size="sm"
            label={`Plan (${plans.length} available)`}
            placeholder="Search your plan by name…"
            data={plans.map((p) => ({ value: p.planId, label: p.displayName }))}
            value={planId}
            onChange={(value) => value && loadPreview(value)}
            searchable
            limit={100}
            description="The plan name is on your bill, or in your retailer's online account."
          />
        ) : null}

        {preview ? (
          <>
            <Stack gap={4}>
              <Text size="xs" tt="uppercase" fw={600} lts="0.08em" c="var(--text-muted)">
                Imported rates
              </Text>
              {preview.tariff.importBlocks.map((block) => (
                <Group key={block.id} justify="space-between" wrap="nowrap">
                  <Text size="sm" c="var(--text-secondary)">
                    {block.label}
                    {block.windows.length ? (
                      <Text span size="xs" c="var(--text-muted)">
                        {" "}
                        ·{" "}
                        {block.windows
                          .map((w) => `${formatMinutes(w.startMin)}–${formatMinutes(w.endMin)}`)
                          .join(", ")}
                      </Text>
                    ) : (
                      <Text span size="xs" c="var(--text-muted)">
                        {" "}
                        · all other times
                      </Text>
                    )}
                  </Text>
                  <Text size="sm" c="var(--text-primary)">
                    {block.centsPerKwh.toFixed(2)}c
                  </Text>
                </Group>
              ))}
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" c="var(--text-secondary)">
                  Daily supply charge
                </Text>
                <Text size="sm" c="var(--text-primary)">
                  {preview.tariff.dailySupplyCents.toFixed(2)}c
                </Text>
              </Group>
              {preview.tariff.exportBlocks.map((block) => (
                <Group key={block.id} justify="space-between" wrap="nowrap">
                  <Text size="sm" c="var(--text-secondary)">
                    Feed-in · {block.label}
                  </Text>
                  <Text size="sm" c="var(--text-primary)">
                    {block.centsPerKwh.toFixed(2)}c
                  </Text>
                </Group>
              ))}
            </Stack>

            {preview.warnings.length ? (
              <Alert color="yellow" variant="light" title="Worth checking">
                <List size="sm" spacing={4}>
                  {preview.warnings.map((warning) => (
                    <List.Item key={warning}>{warning}</List.Item>
                  ))}
                </List>
              </Alert>
            ) : null}

            <Group justify="flex-end">
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onImported(preview.tariff, preview.warnings);
                  reset();
                  onClose();
                }}
              >
                Use these rates
              </Button>
            </Group>
          </>
        ) : null}
      </Stack>
    </Modal>
  );
}
