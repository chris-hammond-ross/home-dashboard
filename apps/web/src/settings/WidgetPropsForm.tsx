import { useState } from "react";
import {
  Button,
  Collapse,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  UnstyledButton,
} from "@mantine/core";
import type { PropField } from "../widgets/meta.js";
import { EntityPickerModal } from "./EntityPickerModal.js";
import { importEnergyPrefs, StatisticPickerModal } from "./StatisticPickerModal.js";

interface WidgetPropsFormProps {
  fields: PropField[];
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Reports whether the advanced-JSON textarea currently fails to parse. */
  onJsonError: (hasError: boolean) => void;
}

/**
 * Generic prop editor driven by widget metadata. Props without a descriptor
 * (e.g. `integration`) live in the "Advanced props" JSON textarea and are
 * never dropped on save.
 */
export function WidgetPropsForm({ fields, props, onChange, onJsonError }: WidgetPropsFormProps) {
  const knownKeys = new Set(fields.map((f) => f.key));
  const extra = Object.fromEntries(Object.entries(props).filter(([k]) => !knownKeys.has(k)));

  const [picker, setPicker] = useState<PropField | null>(null);
  const [statPicker, setStatPicker] = useState<PropField | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [jsonOpen, setJsonOpen] = useState(Object.keys(extra).length > 0);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(extra, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const integration = typeof props.integration === "string" ? props.integration : "ha";
  const hasStatisticFields = fields.some((f) => f.kind === "statistic");

  /** Set a prop; empty string / null removes the key so YAML-style defaults apply. */
  const setProp = (key: string, value: unknown) => {
    const next = { ...props };
    if (value === "" || value === null || value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  /** Fill every statistic field at once from HA's Energy dashboard config. */
  const runEnergyImport = () => {
    setImportError(null);
    void importEnergyPrefs(integration).then(({ props: imported, error }) => {
      if (error) return setImportError(error);
      onChange({ ...props, ...imported });
    });
  };

  const applyJson = (text: string) => {
    setJsonText(text);
    try {
      const parsed: unknown = text.trim() === "" ? {} : JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("must be a JSON object");
      }
      const known = Object.fromEntries(Object.entries(props).filter(([k]) => knownKeys.has(k)));
      onChange({ ...known, ...(parsed as Record<string, unknown>) });
      setJsonError(null);
      onJsonError(false);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
      onJsonError(true);
    }
  };

  const stringProp = (key: string): string => {
    const value = props[key];
    return typeof value === "string" ? value : "";
  };

  return (
    <Stack gap="sm">
      {fields.map((field) => {
        const heading = field.section ? (
          <Text
            key={`${field.key}-section`}
            size="xs"
            tt="uppercase"
            fw={600}
            lts="0.08em"
            c="var(--text-muted)"
            mt="sm"
          >
            {field.section}
          </Text>
        ) : null;
        const control = renderField(field);
        return heading ? (
          <Stack key={`${field.key}-group`} gap="sm">
            {heading}
            {control}
          </Stack>
        ) : (
          control
        );
      })}

      {hasStatisticFields ? (
        <Group gap="sm" align="center">
          <Button size="xs" variant="light" onClick={runEnergyImport}>
            Import from HA Energy dashboard
          </Button>
          {importError ? (
            <Text size="xs" c="var(--status-warning)">
              {importError}
            </Text>
          ) : null}
        </Group>
      ) : null}

      <div>
        <UnstyledButton onClick={() => setJsonOpen((v) => !v)}>
          <Text size="xs" c="var(--text-muted)">
            {jsonOpen ? "▾" : "▸"} Advanced props (JSON)
          </Text>
        </UnstyledButton>
        <Collapse in={jsonOpen}>
          <Textarea
            size="sm"
            mt={4}
            autosize
            minRows={3}
            ff="monospace"
            value={jsonText}
            onChange={(e) => applyJson(e.currentTarget.value)}
            error={jsonError}
            description="Extra props merged into this widget (e.g. integration)"
          />
        </Collapse>
      </div>

      <EntityPickerModal
        opened={picker !== null}
        multi={picker?.kind === "entity-list"}
        domains={picker?.domains}
        initial={
          picker?.kind === "entity-list" && Array.isArray(props[picker.key])
            ? (props[picker.key] as string[])
            : []
        }
        onClose={() => setPicker(null)}
        onPick={(ids) => {
          if (!picker) return;
          if (picker.kind === "entity-list") setProp(picker.key, ids);
          else setProp(picker.key, ids[0] ?? null);
        }}
      />

      <StatisticPickerModal
        opened={statPicker !== null}
        integration={integration}
        onClose={() => setStatPicker(null)}
        onPick={(id) => statPicker && setProp(statPicker.key, id)}
        onImportEnergyPrefs={runEnergyImport}
      />
    </Stack>
  );

  function renderField(field: PropField) {
    {
      switch (field.kind) {
        case "text":
        case "topic":
          return (
            <TextInput
              key={field.key}
              size="sm"
              label={field.label}
              placeholder={field.placeholder}
              description={field.help}
              value={stringProp(field.key)}
              onChange={(e) => setProp(field.key, e.currentTarget.value)}
            />
          );
        case "number":
          return (
            <NumberInput
              key={field.key}
              size="sm"
              label={field.label}
              description={field.help}
              value={typeof props[field.key] === "number" ? (props[field.key] as number) : ""}
              onChange={(value) => setProp(field.key, typeof value === "number" ? value : null)}
            />
          );
        case "boolean":
          return (
            <Switch
              key={field.key}
              size="sm"
              label={field.label}
              description={field.help}
              checked={props[field.key] === true}
              onChange={(e) => setProp(field.key, e.currentTarget.checked ? true : null)}
            />
          );
        case "select":
          return (
            <Select
              key={field.key}
              size="sm"
              label={field.label}
              description={field.help}
              data={field.options ?? []}
              value={stringProp(field.key) || null}
              onChange={(value) => setProp(field.key, value)}
              clearable
              placeholder="auto"
            />
          );
        case "entity":
          return (
            <Group key={field.key} gap="xs" align="flex-end" wrap="nowrap">
              <TextInput
                style={{ flex: 1 }}
                size="sm"
                label={field.label}
                description={field.help}
                placeholder="light.living_room"
                value={stringProp(field.key)}
                onChange={(e) => setProp(field.key, e.currentTarget.value)}
                ff="monospace"
              />
              <Button size="sm" variant="default" onClick={() => setPicker(field)}>
                Browse…
              </Button>
            </Group>
          );
        case "entity-list": {
          const ids = Array.isArray(props[field.key])
            ? (props[field.key] as unknown[]).filter((v): v is string => typeof v === "string")
            : [];
          return (
            <Stack key={field.key} gap={4}>
              <Text size="sm" fw={500}>
                {field.label}
              </Text>
              {ids.map((id) => (
                <Group key={id} gap="xs" wrap="nowrap">
                  <Text size="sm" ff="monospace" style={{ flex: 1 }} truncate>
                    {id}
                  </Text>
                  <UnstyledButton
                    onClick={() =>
                      setProp(
                        field.key,
                        ids.filter((x) => x !== id),
                      )
                    }
                    aria-label={`remove ${id}`}
                  >
                    <Text size="sm" c="var(--text-muted)">
                      ✕
                    </Text>
                  </UnstyledButton>
                </Group>
              ))}
              <Button size="xs" variant="default" onClick={() => setPicker(field)} w="fit-content">
                {ids.length ? "Edit entities…" : "Add entities…"}
              </Button>
            </Stack>
          );
        }
        case "statistic":
          return (
            <Group key={field.key} gap="xs" align="flex-end" wrap="nowrap">
              <TextInput
                style={{ flex: 1 }}
                size="sm"
                label={field.label}
                description={field.help}
                placeholder="sensor.grid_energy_import"
                value={stringProp(field.key)}
                onChange={(e) => setProp(field.key, e.currentTarget.value)}
                ff="monospace"
              />
              <Button size="sm" variant="default" onClick={() => setStatPicker(field)}>
                Browse…
              </Button>
            </Group>
          );
        default:
          return null;
      }
    }
  }
}
