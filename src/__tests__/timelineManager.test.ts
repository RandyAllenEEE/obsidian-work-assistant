const mountSpy = jest.fn(() => ({ component: true }));
const unmountSpy = jest.fn(async () => undefined);

jest.mock("svelte", () => ({
  mount: mountSpy,
  unmount: unmountSpy,
}));

jest.mock("../periodic/timeline/Timeline.svelte", () => ({}));

jest.mock("obsidian", () => {
  class MarkdownView {
    containerEl: HTMLElement;
    file = null;
    leaf = {};
    constructor(containerEl: HTMLElement) {
      this.containerEl = containerEl;
    }
  }
  return { MarkdownView };
});

import TimelineManager from "../periodic/timeline/manager";

describe("TimelineManager lifecycle", () => {
  beforeEach(() => {
    mountSpy.mockClear();
    unmountSpy.mockClear();
  });

  test("mounts per Markdown view and releases listeners and components", () => {
    const { MarkdownView } = jest.requireMock("obsidian") as {
      MarkdownView: new (container: HTMLElement) => unknown;
    };
    const container = {} as HTMLElement;
    let leaves = [{ view: new MarkdownView(container) }];
    let layoutChange: (() => void) | undefined;
    const eventRef = { id: "layout" };
    const workspace = {
      onLayoutReady: jest.fn((callback: () => void) => callback()),
      on: jest.fn((_event: string, callback: () => void) => {
        layoutChange = callback;
        return eventRef;
      }),
      offref: jest.fn(),
      iterateAllLeaves: jest.fn((callback: (leaf: unknown) => void) => leaves.forEach(callback)),
    };
    const plugin = { app: { workspace } } as any;
    const manager = new TimelineManager(plugin, {} as any);

    expect(mountSpy).toHaveBeenCalledTimes(1);
    leaves = [];
    layoutChange?.();
    expect(unmountSpy).toHaveBeenCalledTimes(1);

    manager.cleanup();
    expect(workspace.offref).toHaveBeenCalledWith(eventRef);
  });
});
