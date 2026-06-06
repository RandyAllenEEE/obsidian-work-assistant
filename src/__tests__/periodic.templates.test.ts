import moment from "moment";
import { applyTemplateTransformations, getTemplateContents } from "../periodic/utils";

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
});
