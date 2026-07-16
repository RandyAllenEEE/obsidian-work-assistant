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
        getMarkdownFiles: jest.fn(() => [...markdownFiles.values()]),
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
      removeFile: (path: string) => markdownFiles.delete(path),
      renameFile: (oldPath: string, newPath: string) => {
        const file = markdownFiles.get(oldPath);
        if (!file) return;
        markdownFiles.delete(oldPath);
        file.path = newPath;
        markdownFiles.set(newPath, file);
      },
    };
  }

  test("load creates stats file with default template when missing", async () => {
    const env = createEnv();
    const store = new StatsMdStore(env.app, () => "stats.md");
    const today = moment().format("YYYY-MM-DD");

    const snapshot = await store.load();
    expect(snapshot.settings.dayCounts).toEqual({ [today]: 0 });
    expect(env.fileMap.has("stats.md")).toBe(true);
    expect(env.fileMap.get("stats.md")).toContain("# Work Assistant Stats");
    expect(env.fileMap.get("stats.md")).toContain(`| Note | Initial | Current | ${today} |`);
  });

  test("load rejects malformed existing stats without overwriting it", async () => {
    const malformed = "# Work Assistant Stats\n\nThis table was interrupted";
    const env = createEnv({ "stats.md": malformed });
    const store = new StatsMdStore(env.app, () => "stats.md");

    await expect(store.load()).rejects.toThrow();
    expect(env.app.vault.adapter.write).not.toHaveBeenCalled();
    expect(env.fileMap.get("stats.md")).toBe(malformed);
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

  test("save keeps today first and sorts all remaining date columns descending", async () => {
    const today = moment().format("YYYY-MM-DD");
    const future = moment().add(1, "day").format("YYYY-MM-DD");
    const older = moment().subtract(2, "day").format("YYYY-MM-DD");
    const existing = [
      "# Work Assistant Stats",
      "",
      `| Note | Initial | Current | ${older} | ${future} | ${today} |`,
      "| --- | --- | --- | --- | --- | --- |",
      "| 🍅 POMO |  |  | 1 | 2 | 3 |",
      "| 失效链接 |  |  | 4 | 5 | 6 |",
      "",
    ].join("\n");
    const env = createEnv({ "stats.md": existing });
    const store = new StatsMdStore(env.app, () => "stats.md");

    await store.load();
    await store.save();

    expect(env.fileMap.get("stats.md")).toContain(
      `| Note | Initial | Current | ${today} | ${future} | ${older} |`
    );
    expect(env.fileMap.get("stats.md")).toContain("| 🍅 POMO |  |  | 3 | 2 | 1 |");
    expect(env.fileMap.get("stats.md")).toContain("| 失效链接 |  |  | 6 | 5 | 4 |");
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
    expect(snapshot.todaysAggregate.byFile["Daily/note"].displayDelta).toBe(-20);
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
    expect(content).toContain(`| Note | Initial | Current | ${today} | ${yesterday} |`);
    expect(content).toContain("| [[Daily/note.md]] | 0 | 0 | 0 | 30 |");
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

  test("load archives an externally deleted row without inventing a deletion-day delta", async () => {
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
    // Existing history is reclassified on its original date; deletion itself adds nothing today.
    expect(store.getTodaysBrokenLinksCount()).toBe(0);
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

  test("store leaves Vault event ownership to WordCountStats", () => {
    const env = createEnv();
    const store = new StatsMdStore(env.app, () => "stats.md");

    expect(env.app.vault.on).not.toHaveBeenCalled();
    store.cleanup();
    store.cleanup();
    expect(env.app.vault.off).not.toHaveBeenCalled();
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

  test("rename preserves history and updates the persisted link", async () => {
    const today = moment().format("YYYY-MM-DD");
    const existing = [
      "# Work Assistant Stats",
      "",
      `| Note | Initial | Current | ${today} |`,
      "| --- | --- | --- | --- |",
      "| 🍅 POMO |  |  | 0 |",
      "| 失效链接 |  |  | 0 |",
      "| [[Daily/old]] | 10 | 15 | 5 |",
      "",
    ].join("\n");
    const env = createEnv({ "stats.md": existing });
    env.addFile("Daily/old.md");
    const store = new StatsMdStore(env.app, () => "stats.md");
    await store.load();

    env.renameFile("Daily/old.md", "Daily/new.md");
    expect(store.handleRename("Daily/old.md", "Daily/new.md")).toBe(true);
    await store.save();

    const content = env.fileMap.get("stats.md") ?? "";
    expect(content).toContain("| [[Daily/new]] | 10 | 15 | 5 |");
    expect(content).not.toContain("[[Daily/old]]");
  });

  test("delete moves every historical cell to broken links exactly once", async () => {
    const today = moment().format("YYYY-MM-DD");
    const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
    const existing = [
      "# Work Assistant Stats",
      "",
      `| Note | Initial | Current | ${yesterday} | ${today} |`,
      "| --- | --- | --- | --- | --- |",
      "| 🍅 POMO |  |  | 0 | 0 |",
      "| 失效链接 |  |  | 2 | 3 |",
      "| [[Daily/deleted]] | 10 | 15 | 4 | 5 |",
      "",
    ].join("\n");
    const env = createEnv({ "stats.md": existing });
    env.addFile("Daily/deleted.md");
    const store = new StatsMdStore(env.app, () => "stats.md");
    await store.load();

    expect(store.handleDelete("Daily/deleted.md")).toBe(true);
    env.removeFile("Daily/deleted.md");
    await store.save();
    const firstSave = env.fileMap.get("stats.md") ?? "";
    expect(firstSave).not.toContain("[[Daily/deleted]]");
    expect(firstSave).toContain(`| 失效链接 |  |  | 8 | 6 |`);

    const reloaded = new StatsMdStore(env.app, () => "stats.md");
    await reloaded.load();
    await reloaded.save();
    expect(env.fileMap.get("stats.md")).toContain(`| 失效链接 |  |  | 8 | 6 |`);
  });

  test("a change made during a write remains pending for the next save", async () => {
    const env = createEnv();
    env.addFile("Daily/note.md");
    const store = new StatsMdStore(env.app, () => "stats.md");
    await store.load();

    let releaseWrite: (() => void) | undefined;
    let signalWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve;
    });
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    env.app.vault.adapter.write.mockImplementationOnce(async (path: string, content: string) => {
      signalWriteStarted?.();
      await writeReleased;
      env.fileMap.set(path, content);
    });

    const firstSave = store.save({
      dayCounts: {},
      todaysWordCount: { "Daily/note": { initial: 10, current: 10 } },
      pomoCounts: {},
    });
    await writeStarted;
    store.settings.todaysWordCount["Daily/note"].current = 12;
    store.markRuntimeChanged();
    releaseWrite?.();
    await firstSave;

    expect(store.hasUnpersistedChanges()).toBe(true);
    await store.save();
    expect(store.hasUnpersistedChanges()).toBe(false);
    expect(env.fileMap.get("stats.md")).toContain("| [[Daily/note]] | 10 | 12 | 2 |");
  });

  test("a failed write keeps the revision pending and can be retried", async () => {
    const env = createEnv();
    env.addFile("Daily/note.md");
    const store = new StatsMdStore(env.app, () => "stats.md");
    await store.load();
    env.app.vault.adapter.write.mockRejectedValueOnce(new Error("disk unavailable"));

    await expect(store.save({
      dayCounts: {},
      todaysWordCount: { "Daily/note": { initial: 10, current: 11 } },
      pomoCounts: {},
    })).rejects.toThrow("disk unavailable");
    expect(store.hasUnpersistedChanges()).toBe(true);

    await store.save();
    expect(store.hasUnpersistedChanges()).toBe(false);
    expect(env.fileMap.get("stats.md")).toContain("| [[Daily/note]] | 10 | 11 | 1 |");
  });
});
