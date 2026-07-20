import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Center,
  Checkbox,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { socket } from "../lib/socket.js";

export interface EntityInfo {
  id: string;
  friendlyName: string;
  domain: string;
  state: string;
}

interface EntityPickerModalProps {
  opened: boolean;
  /** Checkbox multi-select instead of click-to-pick. */
  multi?: boolean;
  /** Restrict the list to these domains (picker still shows a domain filter). */
  domains?: string[];
  /** Pre-checked ids in multi mode. */
  initial?: string[];
  onClose: () => void;
  onPick: (ids: string[]) => void;
}

export function EntityPickerModal({
  opened,
  multi = false,
  domains,
  initial = [],
  onClose,
  onPick,
}: EntityPickerModalProps) {
  const [entities, setEntities] = useState<EntityInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!opened) return;
    setEntities(null);
    setError(null);
    setSearch("");
    setDomainFilter(null);
    setChecked(new Set(initial));
    void socket.action("ha", "list-entities").then((res) => {
      if (res.ok) setEntities(res.result as EntityInfo[]);
      else setError(res.error ?? "failed to list entities");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const scoped = useMemo(
    () => (entities ?? []).filter((e) => !domains?.length || domains.includes(e.domain)),
    [entities, domains],
  );
  const domainOptions = useMemo(() => [...new Set(scoped.map((e) => e.domain))].sort(), [scoped]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter(
      (e) =>
        (!domainFilter || e.domain === domainFilter) &&
        (!q || e.id.toLowerCase().includes(q) || e.friendlyName.toLowerCase().includes(q)),
    );
  }, [scoped, domainFilter, search]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Browse Home Assistant entities"
      size="lg"
      centered
    >
      <Stack gap="sm">
        <Group gap="sm">
          <TextInput
            style={{ flex: 1 }}
            size="sm"
            placeholder="Search by name or entity id…"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            data-autofocus
          />
          <Select
            size="sm"
            w={160}
            placeholder="All domains"
            data={domainOptions}
            value={domainFilter}
            onChange={setDomainFilter}
            clearable
          />
        </Group>
        {error ? (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        ) : null}
        {!entities && !error ? (
          <Center h={160}>
            <Loader size="sm" />
          </Center>
        ) : null}
        {entities && filtered.length === 0 ? (
          <Text size="sm" c="var(--text-muted)" ta="center" py="lg">
            No entities found — is Home Assistant connected?
          </Text>
        ) : null}
        {entities && filtered.length > 0 ? (
          <ScrollArea.Autosize mah={380} type="auto">
            <Stack gap={2}>
              {filtered.map((entity) => {
                const row = (
                  <Group justify="space-between" wrap="nowrap" px="xs" py={6}>
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" truncate>
                        {entity.friendlyName}
                      </Text>
                      <Text size="xs" c="var(--text-muted)" truncate ff="monospace">
                        {entity.id}
                      </Text>
                    </div>
                    <Text size="xs" c="var(--text-muted)" style={{ flexShrink: 0 }}>
                      {entity.state}
                    </Text>
                  </Group>
                );
                return multi ? (
                  <Checkbox.Card
                    key={entity.id}
                    checked={checked.has(entity.id)}
                    onClick={() => toggle(entity.id)}
                    style={{ border: "none" }}
                  >
                    <Group wrap="nowrap" gap="xs">
                      <Checkbox.Indicator ml="xs" />
                      <div style={{ flex: 1, minWidth: 0 }}>{row}</div>
                    </Group>
                  </Checkbox.Card>
                ) : (
                  <UnstyledButton
                    key={entity.id}
                    onClick={() => {
                      onPick([entity.id]);
                      onClose();
                    }}
                    style={{ borderRadius: 8 }}
                  >
                    {row}
                  </UnstyledButton>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        ) : null}
        {multi ? (
          <Group justify="flex-end" gap="sm">
            <Button variant="default" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={checked.size === 0}
              onClick={() => {
                onPick([...checked]);
                onClose();
              }}
            >
              Use {checked.size} {checked.size === 1 ? "entity" : "entities"}
            </Button>
          </Group>
        ) : null}
      </Stack>
    </Modal>
  );
}
