import { MarkdownView } from "obsidian";
import type { EventRef } from "obsidian";
import { mount, unmount } from "svelte";

import type { PeriodicNotesCache } from "../cache";
import type CalendarPlugin from "../../main";
import Timeline from "./Timeline.svelte";

type MountedTimeline = ReturnType<typeof mount>;

export default class TimelineManager {
  private readonly components = new Map<HTMLElement, MountedTimeline>();
  private readonly eventRefs: EventRef[] = [];
  private active = true;

  constructor(readonly plugin: CalendarPlugin, readonly cache: PeriodicNotesCache) {
    this.plugin.app.workspace.onLayoutReady(() => {
      if (!this.active) return;
      this.eventRefs.push(
        this.plugin.app.workspace.on("layout-change", this.onLayoutChange)
      );
      this.onLayoutChange();
    });
  }

  public cleanup(): void {
    if (!this.active) return;
    this.active = false;
    this.eventRefs.splice(0).forEach((eventRef) =>
      this.plugin.app.workspace.offref(eventRef)
    );
    for (const component of this.components.values()) {
      void unmount(component);
    }
    this.components.clear();
  }

  private onLayoutChange = (): void => {
    if (!this.active) return;

    const openViews = new Map<HTMLElement, MarkdownView>();
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        openViews.set(leaf.view.containerEl, leaf.view);
      }
    });

    for (const [container, component] of [...this.components]) {
      if (openViews.has(container)) continue;
      void unmount(component);
      this.components.delete(container);
    }

    for (const [container, view] of openViews) {
      if (this.components.has(container)) continue;
      const component = mount(Timeline, {
        target: container,
        props: {
          plugin: this.plugin,
          cache: this.cache,
          view,
        },
      });
      this.components.set(container, component);
    }
  };
}
