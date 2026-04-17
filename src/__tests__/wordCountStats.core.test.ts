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
          immediateInitOnOpen: true,
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
          immediateInitOnOpen: true,
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
          immediateInitOnOpen: true,
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
          immediateInitOnOpen: true,
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
});
