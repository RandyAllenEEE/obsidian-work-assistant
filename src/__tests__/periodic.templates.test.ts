import moment from "moment";
import {
  applyTemplateTransformations,
  getTemplateContents,
  resolvePeriodicNotePath,
} from "../periodic/utils";

jest.mock("obsidian", () => ({
  FileSystemAdapter: {
    readLocalFile: jest.fn(),
  },
  normalizePath: (value: string) => {
    if (value === "") return "/";
    return value.replace(/\\/g, "/");
  },
  Notice: jest.fn(),
  Platform: {
    isDesktopApp: false,
  },
}));

describe("periodic bundled templates", () => {
  beforeAll(() => {
    moment.locale("en");
    (global as any).window = { moment };
  });

  function createApp(templateContent = "bundled template") {
    const adapter = {
      exists: jest.fn(async (path: string) =>
        path === ".obsidian/plugins/work-assistant/periodic_note_templates/Daily.md"
      ),
      read: jest.fn(async () => templateContent),
    };

    return {
      app: {
        metadataCache: {
          getFirstLinkpathDest: jest.fn(),
        },
        vault: {
          adapter,
          cachedRead: jest.fn(),
        },
      } as any,
      adapter,
    };
  }

  function createSettings(overrides: any = {}) {
    const periodicOverrides = overrides.periodicNotes ?? {};
    const rootOverrides = { ...overrides };
    delete rootOverrides.periodicNotes;
    return {
      ...rootOverrides,
      periodicNotes: {
        enabled: true,
        calendarLinkage: true,
        wordsPerDot: 250,
        timelineComplication: true,
        day: {
          enabled: true,
          openAtStartup: false,
          folder: "Daily\\Notes",
          format: "YYYY/MM/YYYY-MM-DD",
        },
        week: {
          enabled: true,
          openAtStartup: false,
          folder: "Weekly Notes",
          format: "gggg/gggg-[W]ww",
        },
        month: {
          enabled: true,
          openAtStartup: false,
          folder: "Monthly Notes",
          format: "YYYY/YYYY-MM",
        },
        quarter: {
          enabled: true,
          openAtStartup: false,
          folder: "Quarterly Notes",
          format: "YYYY/YYYY-[Q]Q",
        },
        year: {
          enabled: true,
          openAtStartup: false,
          folder: "/",
          format: "YYYY",
        },
        ...periodicOverrides,
      },
    } as any;
  }

  test("empty template path falls back to bundled template", async () => {
    const { app, adapter } = createApp("hello from bundled daily template");

    const contents = await getTemplateContents(app, "", {
      granularity: "day",
      pluginId: "work-assistant",
    });

    expect(contents).toBe("hello from bundled daily template");
    expect(adapter.exists).toHaveBeenCalledWith(
      ".obsidian/plugins/work-assistant/periodic_note_templates/Daily.md"
    );
    expect(adapter.read).toHaveBeenCalledWith(
      ".obsidian/plugins/work-assistant/periodic_note_templates/Daily.md"
    );
  });

  test("explicit slash still means no template", async () => {
    const { app, adapter } = createApp();

    const contents = await getTemplateContents(app, "/", {
      granularity: "day",
      pluginId: "work-assistant",
    });

    expect(contents).toBe("");
    expect(adapter.exists).not.toHaveBeenCalled();
  });

  test("renders shared date offsets and weekday placeholders outside daily notes", () => {
    const rendered = applyTemplateTransformations(
      "2026-W23",
      "week",
      moment("2026-06-03"),
      "gggg-[W]ww",
      [
        "{{title}}",
        "{{date-7d:gggg-[W]ww}}",
        "{{date+7d:gggg-[W]ww}}",
        "{{monday:YYYY-MM-DD}}",
        "{{sunday:YYYY-MM-DD}}",
      ].join(" ")
    );

    expect(rendered).toBe("2026-W23 2026-W22 2026-W24 2026-06-01 2026-06-07");
  });

  test("renders month, quarter, and year offsets", () => {
    expect(
      applyTemplateTransformations(
        "2026-02",
        "month",
        moment("2026-02-15"),
        "YYYY-MM",
        "{{month-1M:YYYY-MM}} {{month+1M:YYYY-MM}}"
      )
    ).toBe("2026-01 2026-03");

    expect(
      applyTemplateTransformations(
        "2026-Q1",
        "quarter",
        moment("2026-02-15"),
        "YYYY-[Q]Q",
        "{{quarter-3M:YYYY-[Q]Q}} {{quarter+3M:YYYY-[Q]Q}}"
      )
    ).toBe("2025-Q4 2026-Q2");

    expect(
      applyTemplateTransformations(
        "2026",
        "year",
        moment("2026-06-15"),
        "YYYY",
        "{{year-1y:YYYY}} {{year+1y:YYYY}}"
      )
    ).toBe("2025 2027");
  });

  test("resolvePeriodicNotePath uses configured folder and format", () => {
    const settings = createSettings();

    expect(resolvePeriodicNotePath(settings, "day", moment("2026-06-03"))).toBe(
      "Daily/Notes/2026/06/2026-06-03"
    );
    expect(resolvePeriodicNotePath(settings, "day", moment("2026-06-03"), { extension: true })).toBe(
      "Daily/Notes/2026/06/2026-06-03.md"
    );
    expect(resolvePeriodicNotePath(settings, "week", moment("2026-06-03"))).toBe(
      "Weekly Notes/2026/2026-W23"
    );
    expect(resolvePeriodicNotePath(settings, "month", moment("2026-06-03"))).toBe(
      "Monthly Notes/2026/2026-06"
    );
    expect(resolvePeriodicNotePath(settings, "quarter", moment("2026-06-03"))).toBe(
      "Quarterly Notes/2026/2026-Q2"
    );
    expect(resolvePeriodicNotePath(settings, "year", moment("2026-06-03"))).toBe("2026");

    const emptyFolderSettings = createSettings({
      periodicNotes: {
        month: {
          folder: "",
          format: "YYYY-MM",
        },
      },
    });
    expect(resolvePeriodicNotePath(emptyFolderSettings, "month", moment("2026-06-03"))).toBe(
      "2026-06"
    );
  });

  test("renders periodic path placeholders through configured resolver", () => {
    const settings = createSettings();

    const rendered = applyTemplateTransformations(
      "2026-W23",
      "week",
      moment("2026-06-03"),
      "gggg-[W]ww",
      [
        "{{periodic:day:monday}}",
        "{{periodic:week:-1w}}",
        "{{periodic:month:+1M}}",
        "{{periodic:quarter:-3M}}",
        "{{periodic:year:+1y}}",
        "{{periodic:bad:+1w}}",
      ].join("\n"),
      { settings }
    );

    expect(rendered.split("\n")).toEqual([
      "Daily/Notes/2026/06/2026-06-01",
      "Weekly Notes/2026/2026-W22",
      "Monthly Notes/2026/2026-07",
      "Quarterly Notes/2026/2026-Q1",
      "2027",
      "{{periodic:bad:+1w}}",
    ]);

    expect(
      applyTemplateTransformations(
        "2026-W23",
        "week",
        moment("2026-06-03"),
        "gggg-[W]ww",
        "{{periodic:day:monday}}"
      )
    ).toBe("{{periodic:day:monday}}");
  });
});
