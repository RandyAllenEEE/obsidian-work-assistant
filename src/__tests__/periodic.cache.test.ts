import moment from "moment";
import type { TFile } from "obsidian";
import { PeriodicNotesCache } from "../periodic/cache";

jest.mock("obsidian", () => {
  class Component {
    registerEvent(): void {
      // noop
    }
    onunload(): void {
      // noop
    }
  }
  class TFile {}
  return {
    Component,
    TFile,
    parseFrontMatterEntry: jest.fn(),
  };
});

describe("PeriodicNotesCache core behaviors", () => {
  beforeAll(() => {
    (global as any).window = { moment };
  });

  function createCache(markdownFiles: Array<{ path: string }>) {
    const app = {
      workspace: {
        onLayoutReady: jest.fn(),
        on: jest.fn(() => ({}) as any),
        trigger: jest.fn(),
      },
      metadataCache: {
        on: jest.fn(() => ({}) as any),
        getFileCache: jest.fn(),
      },
      vault: {
        on: jest.fn(() => ({}) as any),
        getMarkdownFiles: jest.fn(() => markdownFiles as any),
      },
    } as any;

    const plugin = {
      options: {
        periodicNotes: {
          day: { enabled: true, folder: "", format: "YYYY-MM-DD" },
          week: { enabled: true, folder: "", format: "gggg-[W]ww" },
          month: { enabled: false, folder: "", format: "YYYY-MM" },
          quarter: { enabled: false, folder: "", format: "YYYY-[Q]Q" },
          year: { enabled: false, folder: "", format: "YYYY" },
        },
      },
    } as any;

    return new PeriodicNotesCache(app, plugin);
  }

  test("findAdjacent returns null when requesting backward from first", () => {
    const cache = createCache([]);
    cache.cachedFiles.set("2024-03-01.md", {
      filePath: "2024-03-01.md",
      date: moment("2024-03-01"),
      granularity: "day",
      canonicalDateStr: "2024-03-01T00:00:00.000Z",
      matchData: { exact: true, matchType: "filename" },
    });
    cache.cachedFiles.set("2024-03-02.md", {
      filePath: "2024-03-02.md",
      date: moment("2024-03-02"),
      granularity: "day",
      canonicalDateStr: "2024-03-02T00:00:00.000Z",
      matchData: { exact: true, matchType: "filename" },
    });

    expect(cache.findAdjacent("2024-03-01.md", "backwards")).toBeNull();
  });

  test("findAdjacent returns null when requesting forward from last", () => {
    const cache = createCache([]);
    cache.cachedFiles.set("2024-03-01.md", {
      filePath: "2024-03-01.md",
      date: moment("2024-03-01"),
      granularity: "day",
      canonicalDateStr: "2024-03-01T00:00:00.000Z",
      matchData: { exact: true, matchType: "filename" },
    });
    cache.cachedFiles.set("2024-03-02.md", {
      filePath: "2024-03-02.md",
      date: moment("2024-03-02"),
      granularity: "day",
      canonicalDateStr: "2024-03-02T00:00:00.000Z",
      matchData: { exact: true, matchType: "filename" },
    });

    expect(cache.findAdjacent("2024-03-02.md", "forwards")).toBeNull();
  });

  test("findAdjacent returns adjacent note in middle", () => {
    const cache = createCache([]);
    cache.cachedFiles.set("2024-03-01.md", {
      filePath: "2024-03-01.md",
      date: moment("2024-03-01"),
      granularity: "day",
      canonicalDateStr: "2024-03-01T00:00:00.000Z",
      matchData: { exact: true, matchType: "filename" },
    });
    cache.cachedFiles.set("2024-03-02.md", {
      filePath: "2024-03-02.md",
      date: moment("2024-03-02"),
      granularity: "day",
      canonicalDateStr: "2024-03-02T00:00:00.000Z",
      matchData: { exact: true, matchType: "filename" },
    });

    expect(cache.findAdjacent("2024-03-01.md", "forwards")?.filePath).toBe("2024-03-02.md");
  });

  test("fastScan only prioritizes files with matching month segment", () => {
    const currentMonth = moment().format("YYYY-MM");
    const [year, month] = currentMonth.split("-");
    const previousYear = String(Number(year) - 1);
    const files = [
      { path: `Daily/${currentMonth}-01.md` },
      { path: `Archive/${previousYear}-${month}-10.md` },
      { path: `Monthly/${currentMonth}/report.md` },
      { path: `Notes/${currentMonth.replace("-", "")}01.md` },
    ];
    const cache = createCache(files);
    const scanSpy = jest.spyOn(cache as any, "scanFiles").mockImplementation(() => undefined);

    (cache as any).fastScan();

    const scanned = scanSpy.mock.calls[0][0] as Array<TFile>;
    const scannedPaths = scanned.map((f: any) => f.path);
    expect(scannedPaths).toContain(`Daily/${currentMonth}-01.md`);
    expect(scannedPaths).toContain(`Monthly/${currentMonth}/report.md`);
    expect(scannedPaths).not.toContain(`Archive/${previousYear}-${month}-10.md`);
    expect(scannedPaths).not.toContain(`Notes/${currentMonth.replace("-", "")}01.md`);
  });
});
