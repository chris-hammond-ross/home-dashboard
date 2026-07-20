import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import type { ScreenConfig } from "@home-dashboard/shared";
import { createScreen, deleteScreen, reorderScreens, setDefaultScreen } from "./api.js";

interface ScreenListProps {
  screens: ScreenConfig[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/** Screen list with reorder / default / delete; mutations round-trip through
 *  the REST API and come back via the live core/screens topic. */
export function ScreenList({ screens, selectedId, onSelect }: ScreenListProps) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScreenConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (op: () => Promise<unknown>) => {
    setError(null);
    try {
      await op();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const ids = screens.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void run(() => reorderScreens(ids));
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    await run(async () => {
      const created = await createScreen(name);
      setNewName("");
      onSelect(created.id);
    });
    setCreating(false);
  };

  return (
    <Stack gap="sm">
      {error ? (
        <Alert color="red" variant="light" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Stack gap={6}>
        {screens.map((screen, index) => (
          <Card
            key={screen.id}
            padding="xs"
            radius="md"
            withBorder
            style={{
              borderColor: screen.id === selectedId ? "var(--mantine-color-brand-6)" : undefined,
              cursor: "pointer",
            }}
            onClick={() => onSelect(screen.id)}
          >
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <div style={{ minWidth: 0 }}>
                <Group gap={6} wrap="nowrap">
                  <Text size="sm" fw={600} truncate>
                    {screen.name}
                  </Text>
                  {screen.default ? (
                    <Badge size="xs" variant="light">
                      default
                    </Badge>
                  ) : null}
                  {screen.generated ? (
                    <Badge size="xs" variant="light" color="gray">
                      generated
                    </Badge>
                  ) : null}
                </Group>
                <Text size="xs" c="var(--text-muted)">
                  {screen.widgets.length} widget{screen.widgets.length === 1 ? "" : "s"}
                </Text>
              </div>
              <Group gap={2} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label="move up"
                >
                  ↑
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={index === screens.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label="move down"
                >
                  ↓
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={screen.default}
                  onClick={() => void run(() => setDefaultScreen(screen.id))}
                  aria-label="make default"
                  title="Make default"
                >
                  ★
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  onClick={() => setDeleteTarget(screen)}
                  aria-label="delete"
                >
                  ✕
                </Button>
              </Group>
            </Group>
          </Card>
        ))}
      </Stack>

      <Group gap="xs" wrap="nowrap">
        <TextInput
          style={{ flex: 1 }}
          size="sm"
          placeholder="New screen name"
          value={newName}
          onChange={(e) => setNewName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        <Button
          size="sm"
          loading={creating}
          disabled={!newName.trim()}
          onClick={() => void create()}
        >
          Create
        </Button>
      </Group>

      <Modal
        opened={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete screen"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Delete{" "}
            <Text span fw={600}>
              {deleteTarget?.name}
            </Text>{" "}
            and its {deleteTarget?.widgets.length} widget
            {deleteTarget?.widgets.length === 1 ? "" : "s"}? This cannot be undone.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              size="sm"
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (!target) return;
                void run(async () => {
                  await deleteScreen(target.id);
                  if (selectedId === target.id) onSelect(null);
                });
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
