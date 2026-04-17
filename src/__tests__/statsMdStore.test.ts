import moment from "moment";
import { StatsMdStore } from "../io/statsMdStore";

jest.mock("obsidian", () => {
  class MockTFile {
    path: string;
    extension: string;
    basename: string;
    stat: { mtime: number };

    constructor(path: string, mtime = Date.now()) {
      this.path = path;
      const parts = path.split("/");
      const name = parts[parts.length - 1];
      const dot = name.lastIndexOf(".");
      this.extension = dot >= 0 ? name.slice(dot + 1) : "";
      this.basename = dot >= 0 ? name.slice(0, dot) : name;
      this.stat = { mtime };
    }
  }
  return { TFile: MockTFile };
});

describe("StatsMdStore", () => {
  beforeAll(() => {
    (global as any).window = { moment };
  });

  function createEnv(initialFiles: Record<string, string> = {}) {
    const fileMap = new Map<string, string>(Object.entries(initialFiles));
    const markdownFiles = new Map<string, any>();

    const app = {
      vault: {
        adapter: {
          exists: jest.fn(async (path: string) => fileMap.has(path)),
          read: jest.fn(async (path: string) => fileMap.get(path) ?? ""),
          write: jest.fn(async (path: string, content: string) => {
            fileMap.set(path, content);
          }),
          mkdir: jest.fn(async () => undefined),
        },
        on: jest.fn(),
        getAbstractFileByPath: jest.fn((path: string) => markdownFiles.get(path) ?? null),
        off: jest.fn(),
      },
    } as any;

    return {
      app,
      fileMap,
      addFile: (path: string, mtime?: number) => {
        const { TFile } = jest.requireMock("obsidian") as any;
        markdownFiles.set(path, new TFile(path, mtime));
      },
    };
  }

  test("load creates stats file with default template when missing", async () => {
    const env = createEnv();
    const store = new StatsMdStore(env.app, () => "stats.md");
    const today = moment().format("YYYY-MM-DD");

    const snapshot = await store.load();
    expect(snapshot.settings.dayCounts).toEqual({});
    expect(env.fileMap.has("stats.md")).toBe(true);
    expect(env.fileMap.get("stats.md")).toContain("# Work Assistant Stats");
    expect(env.fileMap.get("stats.md")).toContain(`| Note | Initial | Current | ${today} |`);
  });

  test("save writes markdown table and returns snapshot", async () => {
    const env = createEnv();
    env.addFile("Daily/note.md");
    const store = new StatsMdStore(env.app, () => "stats.md");

    const today = moment().format("YYYY-MM-DD");
    const snapshot = await store.save({
      dayCounts: { [today]: 10 },
      todaysWordCount: {
        "Daily/note.md": { initial: 100, current: 110 },
      },
      pomoCounts: { [today]: 2 },
    });

    const content = env.fileMap.get("stats.md") ?? "";
    expect(content).toContain("| Note | Initial | Current");
    expect(content).toContain("🍅 POMO");
    expect(content).toContain("[[Daily/note.md]]");
    expect(snapshot.settings.pomoCounts[today]).toBe(2);
  });

  test("save preserves negative delta in aggregate", async () => {
    const env = createEnv();
    env.addFile("Daily/note.md");
    const store = new StatsMdStore(env.app, () => "stats.md");
    const today = moment().format("YYYY-MM-DD");

    const snapshot = await store.save({
      dayCounts: {},
      todaysWordCount: {
        "Daily/note.md": { initial: 120, current: 100 },
      },
      pomoCounts: {},
    });

    expect(snapshot.todaysAggregate.total).toBe(-20);
    expect(snapshot.todaysAggregate.byFile["Daily/note.md"].displayDelta).toBe(-20);
    expect(snapshot.settings.dayCounts[today]).toBe(-20);
  });

  test("save creates parent directory when needed", async () => {
    const env = createEnv();
    const store = new StatsMdStore(env.app, () => "nested/stats.md");

    await store.save({ dayCounts: {}, todaysWordCount: {}, pomoCounts: {} });

    expect(env.app.vault.adapter.mkdir).toHaveBeenCalledWith("nested");
    expect(env.fileMap.has("nested/stats.md")).toBe(true);
  });

  test("first save of a new day initializes all existing note cells to zero", async () => {
    const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
    const today = moment().format("YYYY-MM-DD");
    const existing = [
      "# Work Assistant Stats",
      "",
      "| Note | Initial | Current | " + yesterday + " |",
      "| --- | --- | --- | --- |",
      "| 🍅 POMO |  |  | 0 |",
      "| [[Daily/note.md]] | 100 | 130 | 30 |",
      "",
    ].join("\n");

    const env = createEnv({ "stats.md": existing });
    env.addFile("Daily/note.md");
    const store = new StatsMdStore(env.app, () => "stats.md");

    await store.save({
      dayCounts: { [today]: 0 },
      todaysWordCount: {},
      pomoCounts: { [today]: 0, [yesterday]: 0 },
    });

    const content = env.fileMap.get("stats.md") ?? "";
    expect(content).toContain(`| Note | Initial | Current | ${yesterday} | ${today} |`);
    expect(content).toContain("| [[Daily/note.md]] | 0 | 0 | 30 | 0 |");
  });

  test("load keeps signed negative totals from existing history rows", async () => {
    const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
    const existing = [
      "# Work Assistant Stats",
      "",
      `| Note | Initial | Current | ${yesterday} |`,
      "| --- | --- | --- | --- |",
      "| 🍅 POMO |  |  | 0 |",
      "| [[Daily/a.md]] | 100 | 80 | -20 |",
      "| [[Daily/b.md]] | 50 | 55 | 5 |",
      "",
    ].join("\n");
    const env = createEnv({ "stats.md": existing });
    env.addFile("Daily/a.md");
    env.addFile("Daily/b.md");
    const store = new StatsMdStore(env.app, () => "stats.md");

    const snapshot = await store.load();
    expect(snapshot.settings.dayCounts[yesterday]).toBe(-15);
  });

  test("constructor registers rename handler and cleanup unregisters it once", () => {
    const env = createEnv();
    const store = new StatsMdStore(env.app, () => "stats.md");

    expect(env.app.vault.on).toHaveBeenCalledWith("rename", expect.any(Function));
    store.cleanup();
    store.cleanup();

    expect(env.app.vault.off).toHaveBeenCalledTimes(1);
    expect(env.app.vault.off).toHaveBeenCalledWith("rename", expect.any(Function));
  });

  test("rename handler remaps row id from old path to new path", () => {
    const env = createEnv();
    const store = new StatsMdStore(env.app, () => "stats.md") as any;
    const { TFile } = jest.requireMock("obsidian") as any;
    const renamedFile = new TFile("Daily/new.md");
    store.filePathToRowId.set("Daily/old.md", "row-1");

    store.handleRename(renamedFile, "Daily/old.md");
    expect(store.filePathToRowId.get("Daily/old.md")).toBeUndefined();
    expect(store.filePathToRowId.get("Daily/new.md")).toBe("row-1");
  });
});
