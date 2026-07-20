import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Divider,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import type { ScreenConfig, WidgetConfig } from "@home-dashboard/shared";
import { widgetMeta, widgetMetaByType } from "../widgets/meta.js";
import { updateScreen } from "./api.js";
import { WidgetPropsForm } from "./WidgetPropsForm.js";

/** Stable identity for widget rows while editing (array position is not one). */
interface DraftWidget {
  uid: number;
  widget: WidgetConfig;
}

let nextUid = 1;
const toRows = (widgets: WidgetConfig[]): DraftWidget[] =>
  widgets.map((widget) => ({ uid: nextUid++, widget }));

const coerceSpan = (value: number | string): number =>
  Math.max(1, typeof value === "number" ? value : parseInt(value, 10) || 1);

/** Edits one screen against a local draft; parent remounts via key={screen.id}. */
export function ScreenEditor({ screen }: { screen: ScreenConfig }) {
  const [baseline, setBaseline] = useState(screen);
  const [name, setName] = useState(screen.name);
  const [columns, setColumns] = useState(screen.columns);
  const [rows, setRows] = useState(() => toRows(screen.widgets));
  const [jsonErrors, setJsonErrors] = useState<ReadonlySet<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reset = (next: ScreenConfig) => {
    setBaseline(next);
    setName(next.name);
    setColumns(next.columns);
    setRows(toRows(next.widgets));
    setJsonErrors(new Set());
    setSaveError(null);
  };

  const draft: ScreenConfig = {
    ...baseline,
    name,
    columns,
    widgets: rows.map((r) => r.widget),
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const serverChanged = JSON.stringify(screen) !== JSON.stringify(baseline);

  // Follow live server updates while the draft is untouched; if the user is
  // mid-edit, keep the draft and just surface a note.
  useEffect(() => {
    if (serverChanged && !dirty) reset(screen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const updateRow = (uid: number, widget: WidgetConfig) =>
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, widget } : r)));

  const moveRow = (uid: number, delta: -1 | 1) =>
    setRows((prev) => {
      const index = prev.findIndex((r) => r.uid === uid);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  const removeRow = (uid: number) => {
    setRows((prev) => prev.filter((r) => r.uid !== uid));
    setJsonErrors((prev) => {
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
  };

  const addWidget = (type: string | null) => {
    if (!type) return;
    const meta = widgetMetaByType[type];
    if (!meta) return;
    setRows((prev) => [
      ...prev,
      {
        uid: nextUid++,
        widget: {
          type,
          cols: meta.defaultSpans.cols,
          rows: meta.defaultSpans.rows,
          props: {},
        },
      },
    ]);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateScreen(baseline.id, {
        name,
        columns,
        default: baseline.default,
        generated: baseline.generated,
        widgets: rows.map((r) => r.widget),
      });
      reset(updated);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <Stack gap="md">
        <Group gap="sm" align="flex-end">
          <TextInput
            style={{ flex: 1 }}
            size="sm"
            label="Screen name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <NumberInput
            w={110}
            size="sm"
            label="Columns"
            min={1}
            max={12}
            value={columns}
            onChange={(value) => setColumns(Math.min(12, coerceSpan(value)))}
          />
        </Group>
        <Text size="xs" c="var(--text-muted)" ff="monospace">
          id: {baseline.id}
          {baseline.generated ? " · generated (saving adopts it as yours)" : ""}
        </Text>

        <Divider label={`Widgets (${rows.length})`} labelPosition="left" />

        {rows.length === 0 ? (
          <Text size="sm" c="var(--text-muted)">
            No widgets yet — add one below.
          </Text>
        ) : null}
        {rows.map((row, index) => (
          <WidgetRow
            key={row.uid}
            row={row}
            first={index === 0}
            last={index === rows.length - 1}
            onChange={(widget) => updateRow(row.uid, widget)}
            onMove={(delta) => moveRow(row.uid, delta)}
            onRemove={() => removeRow(row.uid)}
            onJsonError={(hasError) =>
              setJsonErrors((prev) => {
                const next = new Set(prev);
                if (hasError) next.add(row.uid);
                else next.delete(row.uid);
                return next;
              })
            }
          />
        ))}

        <Select
          size="sm"
          placeholder="+ Add widget…"
          data={widgetMeta.map((m) => ({ value: m.type, label: `${m.label} — ${m.description}` }))}
          value={null}
          onChange={addWidget}
          searchable
        />

        {saveError ? (
          <Alert color="red" variant="light">
            {saveError}
          </Alert>
        ) : null}

        <Group
          justify="space-between"
          style={{ position: "sticky", bottom: 0, background: "var(--surface-1)", paddingTop: 8 }}
        >
          <Group gap="xs">
            {dirty ? (
              <Badge color="yellow" variant="light">
                unsaved changes
              </Badge>
            ) : null}
            {dirty && serverChanged ? (
              <Text size="xs" c="var(--status-warning)">
                this screen changed on the server — saving overwrites it
              </Text>
            ) : null}
          </Group>
          <Group gap="sm">
            <Button
              size="sm"
              variant="default"
              disabled={!dirty || saving}
              onClick={() => reset(baseline)}
            >
              Revert
            </Button>
            <Button
              size="sm"
              disabled={!dirty || saving || jsonErrors.size > 0 || name.trim() === ""}
              loading={saving}
              onClick={() => void save()}
            >
              Save
            </Button>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}

function WidgetRow({
  row,
  first,
  last,
  onChange,
  onMove,
  onRemove,
  onJsonError,
}: {
  row: DraftWidget;
  first: boolean;
  last: boolean;
  onChange: (widget: WidgetConfig) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onJsonError: (hasError: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const { widget } = row;
  const meta = widgetMetaByType[widget.type];

  return (
    <Card padding="sm" radius="md" withBorder>
      <Group gap="xs" wrap="nowrap" align="flex-end">
        <UnstyledButton
          onClick={() => setOpen((v) => !v)}
          style={{ flexShrink: 0, paddingBottom: 6 }}
        >
          <Text size="sm" fw={600}>
            {open ? "▾" : "▸"} {meta?.label ?? widget.type}
          </Text>
        </UnstyledButton>
        <TextInput
          style={{ flex: 1 }}
          size="xs"
          label="Title"
          placeholder="none"
          value={widget.title ?? ""}
          onChange={(e) => onChange({ ...widget, title: e.currentTarget.value || undefined })}
        />
        <NumberInput
          w={70}
          size="xs"
          label="Cols"
          min={1}
          value={widget.cols}
          onChange={(value) => onChange({ ...widget, cols: coerceSpan(value) })}
        />
        <NumberInput
          w={70}
          size="xs"
          label="Rows"
          min={1}
          value={widget.rows}
          onChange={(value) => onChange({ ...widget, rows: coerceSpan(value) })}
        />
        <Group gap={4} wrap="nowrap" style={{ paddingBottom: 2 }}>
          <Button size="compact-xs" variant="subtle" disabled={first} onClick={() => onMove(-1)}>
            ↑
          </Button>
          <Button size="compact-xs" variant="subtle" disabled={last} onClick={() => onMove(1)}>
            ↓
          </Button>
          <Button size="compact-xs" variant="subtle" color="red" onClick={onRemove}>
            ✕
          </Button>
        </Group>
      </Group>
      <Collapse in={open}>
        <Divider my="sm" />
        <WidgetPropsForm
          fields={meta?.fields ?? []}
          props={widget.props}
          onChange={(props) => onChange({ ...widget, props })}
          onJsonError={onJsonError}
        />
      </Collapse>
    </Card>
  );
}
