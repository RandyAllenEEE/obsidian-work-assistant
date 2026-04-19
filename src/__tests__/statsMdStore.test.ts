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
        getAbstractFileByPath: jest.fn((path: string) => {
          // Try exact match first
          if (markdownFiles.has(path)) return markdownFiles.get(path);
          // Then try with .md suffix if path doesn't have it
          if (!path.endsWith(".md")) {
            const withMd = path + ".md";
            if (markdownFiles.has(withMd)) return markdownFiles.get(withMd);
          }
          // Then try without .md suffix
          if (path.endsWith(".md")) {
            const withoutMd = path.slice(0, -3);
            if (markdownFiles.has(withoutMd)) return markdownFiles.get(withoutMd);
          }
          return null;
        }),
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
    expect(content).toContain("[[Daily/note]]");
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
    expect(content).toContain("| [[Daily/note]] | 0 | 0 | 30 | 0 |");
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

  test("load includes broken links row counts in dayCounts reconstruction (Bug 1 fix)", async () => {
    const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
    const existing = [
      "# Work Assistant Stats",
      "",
      `| Note | Initial | Current | ${yesterday} |`,
      "| --- | --- | --- | --- |",
      "| 🍅 POMO |  |  | 0 |",
      "| 失效链接 |  |  | -50 |",
      "| [[Daily/note.md]] | 100 | 80 | -20 |",
      "",
    ].join("\n");
    const env = createEnv({ "stats.md": existing });
    env.addFile("Daily/note.md");
    const store = new StatsMdStore(env.app, () => "stats.md");

    const snapshot = await store.load();
    // -20 from note row + -50 from broken links row = -70
    expect(snapshot.settings.dayCounts[yesterday]).toBe(-70);
  });

  test("load merges broken links accumulator with existing broken links row counts", async () => {
    const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
    const today = moment().format("YYYY-MM-DD");
    // stats.md has existing broken links row with -30 for yesterday and 0 for today
    // and note [[Deleted.md]] whose file doesn't exist (simulating external delete)
    const existing = [
      "# Work Assistant Stats",
      "",
      `| Note | Initial | Current | ${yesterday} | ${today} |`,
      "| --- | --- | --- | --- | --- |",
      "| 🍅 POMO |  |  | 0 | 0 |",
      "| 失效链接 |  |  | -30 | 0 |",
      "| [[Deleted.md]] | 50 | 30 | -20 | 0 |",
      "",
    ].join("\n");
    const env = createEnv({ "stats.md": existing });
    // Deleted.md doesn't exist in vault - simulates external deletion
    const store = new StatsMdStore(env.app, () => "stats.md");

    const snapshot = await store.load();
    // dayCounts[yesterday] = note (-20) + broken links (-30) = -50
    expect(snapshot.settings.dayCounts[yesterday]).toBe(-50);
    // dayCounts[today] = note (0) + broken links (0) = 0 (today's broken links row value is 0)
    expect(snapshot.settings.dayCounts[today]).toBe(0);
    // Externally deleted file's netChange added to today's brokenLinksAccumulator
    expect(store.getTodaysBrokenLinksCount()).toBe(-20);
  });

  test("buildTemplate discards new note with no prior record instead of routing to broken links (Bug 2 fix)", async () => {
    // Scenario: stats.md has NO record for a file, but todaysWordCount has a stale entry
    // This can happen when a new file was initialized but never saved, then doesn't exist
    const today = moment().format("YYYY-MM-DD");
    const existing = [
      "# Work Assistant Stats",
      "",
      `| Note | Initial | Current | ${today} |`,
      "| --- | --- | --- | --- |",
      "| 🍅 POMO |  |  | 0 |",
      "| [[Daily/existing.md]] | 50 | 60 | 10 |",
      "",
    ].join("\n");
    const env = createEnv({ "stats.md": existing });
    env.addFile("Daily/existing.md");
    // "Daily/new.md" does NOT exist in vault
    const store = new StatsMdStore(env.app, () => "stats.md") as any;

    // Pre-populate filePathToRowId so "Daily/existing.md" is known
    store.filePathToRowId.set("Daily/existing", "row-existing");

    // Simulate todaysWordCount with a stale entry for non-existent file that was never in stats.md
    // netChange = 100 - 100 = 0, but even if it were non-zero, no knownRowId means skip accumulator
    const accumulatorBefore = store.brokenLinksAccumulator.countsByDate[today] ?? 0;

    await store.save({
      dayCounts: {},
      todaysWordCount: {
        "Daily/new": { initial: 100, current: 100 }, // no change, no prior record
      },
      pomoCounts: {},
    });

    // The stale entry should be deleted without adding to accumulator
    expect(store.brokenLinksAccumulator.countsByDate[today] ?? 0).toBe(accumulatorBefore);
  });

  test("buildTemplate routes externally deleted file WITH prior record to broken links accumulator", async () => {
    const today = moment().format("YYYY-MM-DD");
    const existing = [
      "# Work Assistant Stats",
      "",
      `| Note | Initial | Current | ${today} |`,
      "| --- | --- | --- | --- |",
      "| 🍅 POMO |  |  | 0 |",
      "| [[Daily/deleted.md]] | 100 | 150 | 50 |",
      "",
    ].join("\n");
    const env = createEnv({ "stats.md": existing });
    // deleted.md does NOT exist in vault (was externally deleted)
    const store = new StatsMdStore(env.app, () => "stats.md") as any;

    // Pre-populate filePathToRowId so "Daily/deleted" IS known
    store.filePathToRowId.set("Daily/deleted", "row-deleted");

    // todaysWordCount has the file with netChange = 150 - 100 = 50
    await store.save({
      dayCounts: {},
      todaysWordCount: {
        "Daily/deleted": { initial: 100, current: 150 },
      },
      pomoCounts: {},
    });

    // Since knownRowId exists and netChange !== 0, it SHOULD go to accumulator
    expect(store.brokenLinksAccumulator.countsByDate[today] ?? 0).toBe(50);
  });

  test("save correctly reconstructs empty new note row (initial=0, current=0) after buildTemplate", async () => {
    // Scenario: a new empty note is opened and initialized (todaysWordCount has initial=0, current=0),
    // buildTemplate creates a new row, then normalizeParsedModel should reconstruct it
    const today = moment().format("YYYY-MM-DD");
    const existing = [
      "# Work Assistant Stats",
      "",
      `| Note | Initial | Current | ${today} |`,
      "| --- | --- | --- | --- |",
      "| 🍅 POMO |  |  | 0 |",
      "",
    ].join("\n");
    const env = createEnv({ "stats.md": existing });
    env.addFile("Daily/empty.md");
    const store = new StatsMdStore(env.app, () => "stats.md");

    // save with an empty new note (initial=0, current=0 is valid for empty notes)
    const snapshot = await store.save({
      dayCounts: {},
      todaysWordCount: {
        "Daily/empty": { initial: 0, current: 0 }, // empty note, just initialized
      },
      pomoCounts: {},
    });

    // After save + normalizeParsedModel, the empty note should appear in todaysWordCount
    expect(snapshot.settings.todaysWordCount["Daily/empty"]).toEqual({
      initial: 0,
      current: 0,
    });
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

  test("save correctly reconstructs new note row in todaysWordCount after buildTemplate", async () => {
    // Scenario: a new note is opened and initialized (todaysWordCount has it),
    // buildTemplate creates a new row, then normalizeParsedModel should reconstruct it
    const today = moment().format("YYYY-MM-DD");
    const existing = [
      "# Work Assistant Stats",
      "",
      `| Note | Initial | Current | ${today} |`,
      "| --- | --- | --- | --- |",
      "| 🍅 POMO |  |  | 0 |",
      "",
    ].join("\n");
    const env = createEnv({ "stats.md": existing });
    env.addFile("Daily/new.md");
    const store = new StatsMdStore(env.app, () => "stats.md");

    // save with a new note that doesn't yet exist in stats.md
    const snapshot = await store.save({
      dayCounts: {},
      todaysWordCount: {
        "Daily/new": { initial: 50, current: 50 }, // new note, just initialized
      },
      pomoCounts: {},
    });

    // After save + normalizeParsedModel, the new note should appear in todaysWordCount
    expect(snapshot.settings.todaysWordCount["Daily/new"]).toEqual({
      initial: 50,
      current: 50,
    });
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
