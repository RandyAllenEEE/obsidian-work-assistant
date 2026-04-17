import moment from "moment";
import WordCountStats from "../wordCountStats";

jest.mock("obsidian", () => {
  class Component {
    registerEvent() {
      // noop
    }
    registerInterval() {
      // noop
    }
  }
  class MarkdownView {}
  const debounce = jest.fn(<T extends (...args: any[]) => any>(fn: T) => fn);
  class TFile {}
  return { Component, MarkdownView, debounce, TFile };
});

jest.mock("../io/statsMdStore", () => ({
  DEFAULT_DAILY_STATS_SETTINGS: { dayCounts: {}, todaysWordCount: {}, pomoCounts: {} },
  StatsMdStore: class {
    constructor(_app: unknown, _getter: unknown) {
      // noop
    }
    load = jest.fn(async () => ({
      settings: { dayCounts: {}, todaysWordCount: {}, pomoCounts: {} },
      todaysAggregate: { total: 0, byFile: {} },
    }));
    save = jest.fn(async (settings: any) => ({
      settings,
      todaysAggregate: { total: 0, byFile: {} },
    }));
    cleanup = jest.fn();
    getTodaysWordCountAggregate = jest.fn((data: Record<string, { initial: number; current: number }>) => {
      let total = 0;
      const byFile: Record<string, { displayDelta: number }> = {};
      Object.entries(data).forEach(([k, v]) => {
        const d = v.current - v.initial;
        total += d;
        byFile[k] = { displayDelta: d };
      });
      return { total, byFile };
    });
  },
}));

describe("WordCountStats core logic", () => {
  beforeAll(() => {
    (global as any).window = { moment, setInterval };
  });

  function createStats(overrides: Partial<any> = {}) {
    const plugin = {
      options: {
        wordCount: {
          statsMdPath: "stats.md",
          shockThreshold: 1000,
          debounceDelay: 2000,
          autoSaveInterval: 30000,
        },
      },
      ...overrides,
    } as any;
    const app = {
      workspace: {
        on: jest.fn(),
        getActiveFile: jest.fn(() => null),
        trigger: jest.fn(),
        getActiveViewOfType: jest.fn(() => null),
      },
      vault: {
        on: jest.fn(),
        read: jest.fn(async () => ""),
      },
    } as any;
    return new WordCountStats(plugin, app) as any;
  }

  test("countWords handles latin and CJK mixed text", () => {
    const stats = createStats();
    // hello(1) world(1) + 你好(2 chars) + abc(1) => 5
    expect(stats.countWords("hello world 你好 abc")).toBe(5);
  });

  test("computeHash returns deterministic result", () => {
    const stats = createStats();
    expect(stats.computeHash("abc")).toBe(stats.computeHash("abc"));
    expect(stats.computeHash("abc")).not.toBe(stats.computeHash("abcd"));
  });

  test("getShockThreshold returns Infinity for -1", () => {
    const stats = createStats({
      options: {
        wordCount: {
          statsMdPath: "stats.md",
          shockThreshold: -1,
          debounceDelay: 2000,
          autoSaveInterval: 30000,
        },
      },
    });
    expect(stats.getShockThreshold()).toBe(Infinity);
  });

  test("getShockThreshold falls back for invalid value", () => {
    const stats = createStats({
      options: {
        wordCount: {
          statsMdPath: "stats.md",
          shockThreshold: 0,
          debounceDelay: 2000,
          autoSaveInterval: 30000,
        },
      },
    });
    expect(stats.getShockThreshold()).toBe(1000);
  });

  test("fallbackUpdateWordCount writes contentHash and wordCount", () => {
    const stats = createStats();
    const updateSpy = jest.spyOn(stats, "updateStore").mockImplementation(() => undefined);
    stats.fallbackUpdateWordCount("hello 你好", "Daily/a.md");
    const cache = stats.wordCountCache.get("Daily/a.md");
    expect(cache).toBeDefined();
    expect(cache.contentHash).toBe(stats.computeHash("hello 你好"));
    expect(cache.wordCount).toBe(stats.countWords("hello 你好"));
    expect(updateSpy).toHaveBeenCalledWith("Daily/a.md", cache.wordCount);
  });

  test("initialize uses validated debounce and autosave values", async () => {
    const stats = createStats({
      options: {
        wordCount: {
          statsMdPath: "stats.md",
          shockThreshold: 1000,
          debounceDelay: -10,
          autoSaveInterval: 0,
        },
      },
    });

    const intervalSpy = jest.spyOn(window, "setInterval").mockImplementation(() => 1 as any);
    const debounceMock = (jest.requireMock("obsidian").debounce as jest.Mock);
    debounceMock.mockClear();

    await stats.initialize();

    expect(debounceMock).toHaveBeenCalledTimes(2);
    expect(debounceMock).toHaveBeenNthCalledWith(1, expect.any(Function), 2000, false);
    expect(debounceMock).toHaveBeenNthCalledWith(2, expect.any(Function), 2000, true);
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);

    intervalSpy.mockRestore();
  });

  test("loadSettings clears stale todaysWordCount on cold start day change", async () => {
    const stats = createStats();
    const today = moment().format("YYYY-MM-DD");
    const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
    const staleWordCount = {
      "Daily/old.md": { initial: 80, current: 120 },
    };

    stats.statsStore.load.mockResolvedValueOnce({
      settings: {
        dayCounts: { [yesterday]: 40 },
        todaysWordCount: staleWordCount,
        pomoCounts: {},
      },
      todaysAggregate: {
        total: 40,
        byFile: { "Daily/old.md": { displayDelta: 40 } },
      },
    });

    await stats.loadSettings();
    await Promise.resolve();

    expect(stats.settings.todaysWordCount).toEqual({});
    expect(stats.settings.dayCounts[today]).toBe(0);
  });

  test("initializeActiveFileWordCount seeds baseline for active note", async () => {
    const stats = createStats();
    stats.app.workspace.getActiveFile.mockReturnValue({
      path: "Daily/today.md",
      extension: "md",
    });
    stats.app.vault.read.mockResolvedValueOnce("hello world");

    await stats.initializeActiveFileWordCount();

    expect(stats.settings.todaysWordCount["Daily/today.md"]).toEqual({
      initial: 2,
      current: 2,
    });
  });

  test("transitionToNewDay initializes currently active note baseline", async () => {
    const stats = createStats();
    const today = moment().format("YYYY-MM-DD");
    const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
    stats.today = yesterday;
    stats.settings.todaysWordCount = { "Daily/old.md": { initial: 10, current: 20 } };
    stats.settings.dayCounts = { [yesterday]: 10 };
    stats.app.workspace.getActiveFile.mockReturnValue({
      path: "Daily/active.md",
      extension: "md",
    });
    stats.app.vault.read.mockResolvedValueOnce("hello");

    await stats.transitionToNewDay(today);

    expect(stats.settings.todaysWordCount).toEqual({
      "Daily/active.md": { initial: 1, current: 1 },
    });
    expect(stats.today).toBe(today);
  });

  test("saveSettings coalesces concurrent requests and persists latest state", async () => {
    const stats = createStats();
    let resolveFirstSave: ((value: any) => void) | null = null;
    const firstSavePromise = new Promise((resolve) => {
      resolveFirstSave = resolve;
    });
    const captured: any[] = [];
    const saveMock = stats.statsStore.save as jest.Mock;
    saveMock.mockImplementationOnce(async (settings: any) => {
      captured.push(JSON.parse(JSON.stringify(settings)));
      await firstSavePromise;
      return {
        settings,
        todaysAggregate: { total: 0, byFile: {} },
      };
    });

    stats.settings.todaysWordCount = { "Daily/a.md": { initial: 1, current: 2 } };
    stats.dirty = true;
    const runningSave = stats.saveSettings();
    await Promise.resolve();
    stats.settings.todaysWordCount["Daily/a.md"] = { initial: 1, current: 3 };
    stats.dirty = true;
    void stats.saveSettings();

    expect(saveMock).toHaveBeenCalledTimes(1);
    resolveFirstSave?.(null);
    await runningSave;
    expect(stats.dirty).toBe(false);
    expect(captured[0].todaysWordCount["Daily/a.md"].current).toBe(2);
  });

  test("initialize seeds active file baseline without requiring leaf change", async () => {
    const stats = createStats();
    const today = moment().format("YYYY-MM-DD");
    stats.statsStore.load.mockResolvedValueOnce({
      settings: { dayCounts: { [today]: 0 }, todaysWordCount: {}, pomoCounts: {} },
      todaysAggregate: { total: 0, byFile: {} },
    });
    stats.app.workspace.getActiveFile.mockReturnValue({
      path: "Daily/startup.md",
      extension: "md",
    });
    stats.app.vault.read.mockResolvedValue("hello world");

    await stats.initialize();
    await Promise.resolve();

    expect(stats.settings.todaysWordCount["Daily/startup.md"]).toEqual({
      initial: 2,
      current: 2,
    });
  });

  test("loadSettings rebaselines active file when today exists but baseline is stale", async () => {
    const stats = createStats({
      options: {
        wordCount: {
          statsMdPath: "stats.md",
          shockThreshold: 10,
          debounceDelay: 2000,
          autoSaveInterval: 30000,
        },
      },
    });
    const today = moment().format("YYYY-MM-DD");
    stats.statsStore.load.mockResolvedValueOnce({
      settings: {
        dayCounts: { [today]: 2 },
        todaysWordCount: {
          "Daily/active.md": { initial: 100, current: 100 },
        },
        pomoCounts: {},
      },
      todaysAggregate: {
        total: 0,
        byFile: { "Daily/active.md": { displayDelta: 0 } },
      },
    });
    stats.app.workspace.getActiveFile.mockReturnValue({
      path: "Daily/active.md",
      extension: "md",
    });
    stats.app.vault.read.mockResolvedValueOnce("hello");

    await stats.loadSettings();
    await Promise.resolve();

    expect(stats.settings.todaysWordCount["Daily/active.md"]).toEqual({
      initial: 1,
      current: 1,
    });
  });

  test("refreshStatusBar clamps negative totals to zero for display", () => {
    const stats = createStats();
    const setText = jest.fn();
    stats.statusBarEl = { setText, remove: jest.fn() };
    stats.app.workspace.getActiveFile.mockReturnValue({
      path: "Daily/active.md",
      extension: "md",
    });
    stats.todaysAggregate = {
      total: -20,
      byFile: { "Daily/active.md": { displayDelta: -5 } },
    };

    stats.refreshStatusBar();
    const rendered = setText.mock.calls[0][0];
    expect(rendered).toContain("0");
    expect(rendered.includes("-")).toBe(false);
  });

  test("handleWorkerMessage ignores stale nonce and accepts latest nonce only", () => {
    const stats = createStats();
    const updateSpy = jest.spyOn(stats, "updateStore").mockImplementation(() => undefined);

    stats.latestNonceByPath.set("Daily/a.md", 2);
    stats.pathByNonce.set(1, "Daily/a.md");
    stats.handleWorkerMessage(1, 5, "hash1");
    expect(updateSpy).not.toHaveBeenCalled();
    expect(stats.pathByNonce.has(1)).toBe(false);

    stats.latestNonceByPath.set("Daily/a.md", 2);
    stats.pathByNonce.set(2, "Daily/a.md");
    stats.handleWorkerMessage(2, 6, "hash2");
    expect(updateSpy).toHaveBeenCalledWith("Daily/a.md", 6);
    expect(stats.latestNonceByPath.has("Daily/a.md")).toBe(false);
    expect(stats.pathByNonce.has(2)).toBe(false);
  });

  test("terminateWorker clears nonce routing maps", () => {
    const stats = createStats();
    stats.worker = { terminate: jest.fn() };
    stats.latestNonceByPath.set("Daily/a.md", 1);
    stats.pathByNonce.set(1, "Daily/a.md");

    stats.terminateWorker();

    expect(stats.worker).toBeNull();
    expect(stats.latestNonceByPath.size).toBe(0);
    expect(stats.pathByNonce.size).toBe(0);
  });

  test("updateStore buffers updates while day transition is active", () => {
    const stats = createStats();
    const updateCountsSpy = jest.spyOn(stats, "updateCounts").mockImplementation(() => undefined);
    stats.debouncedSave = jest.fn();
    stats.isDayTransitioning = true;

    stats.updateStore("Daily/buffered.md", 10);
    expect(stats.settings.todaysWordCount["Daily/buffered.md"]).toBeUndefined();
    expect(stats.bufferedUpdatesDuringTransition.get("Daily/buffered.md")).toBe(10);

    stats.isDayTransitioning = false;
    stats.replayBufferedUpdatesAfterTransition();
    expect(updateCountsSpy).toHaveBeenCalled();
    expect(stats.settings.todaysWordCount["Daily/buffered.md"]).toEqual({ initial: 10, current: 10 });
  });
});
