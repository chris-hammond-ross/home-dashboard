import type { ScreenConfig } from "@home-dashboard/shared";
import type { TopicHub } from "./hub.js";
import type { PluginHost } from "./plugins.js";
import type { ScreenStore } from "./db/screen-store.js";

/**
 * Entity ids referenced anywhere in the given screens: any widget prop named
 * `entity` (string) or `entities` (string[]), regardless of widget type.
 * Integrations use these hints to publish entities beyond their allowlist.
 */
export function extractEntityIds(screens: ScreenConfig[]): string[] {
  const ids = new Set<string>();
  for (const screen of screens) {
    for (const widget of screen.widgets) {
      const { entity, entities } = widget.props;
      if (typeof entity === "string" && entity) ids.add(entity);
      if (Array.isArray(entities)) {
        for (const id of entities) if (typeof id === "string" && id) ids.add(id);
      }
    }
  }
  return [...ids].sort();
}

/**
 * Screen mutations = store write + broadcast: the full ordered screens array
 * goes out on the retained `core/screens` topic (the wall panel updates live),
 * and every integration that registered an `entity-hints` action is told which
 * entities the screens now reference.
 */
export class ScreenService {
  constructor(
    private store: ScreenStore,
    private hub: TopicHub,
    private plugins: PluginHost,
  ) {}

  list(): ScreenConfig[] {
    return this.store.list();
  }

  create(input: ScreenConfig): ScreenConfig {
    const created = this.store.create(input);
    this.broadcast();
    return created;
  }

  update(id: string, input: Omit<ScreenConfig, "id">): ScreenConfig {
    const updated = this.store.update(id, input);
    this.broadcast();
    return updated;
  }

  delete(id: string): void {
    this.store.delete(id);
    this.broadcast();
  }

  reorder(ids: string[]): void {
    this.store.reorder(ids);
    this.broadcast();
  }

  setDefault(id: string): void {
    this.store.setDefault(id);
    this.broadcast();
  }

  replaceGenerated(screens: ScreenConfig[]): {
    added: string[];
    replacedCount: number;
    skipped: string[];
  } {
    const result = this.store.replaceGenerated(screens);
    this.broadcast();
    return result;
  }

  uniquifyId(base: string): string {
    return this.store.uniquifyId(base);
  }

  /** Also called once at startup so `core/screens` is retained from boot. */
  broadcast(): void {
    const screens = this.store.list();
    this.hub.publish("core/screens", screens);
    void this.plugins.runActionEverywhere("entity-hints", {
      entities: extractEntityIds(screens),
    });
  }
}
