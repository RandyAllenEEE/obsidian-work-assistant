import moment from "moment";
import { getLooselyMatchedDate } from "../periodic/parser";
import {
  getBasename,
  getDateInput,
  removeEscapedCharacters,
  validateFormat,
  validateFormatComplexity,
} from "../periodic/settings/validation";

jest.mock("obsidian", () => ({
  normalizePath: (value: string) => value.replace(/\\/g, "/"),
}));

describe("periodic parser and validation", () => {
  beforeAll(() => {
    (global as any).window = { moment };
  });

  test("getLooselyMatchedDate parses full day date", () => {
    const result = getLooselyMatchedDate("daily-2024-03-14-note");
    expect(result?.granularity).toBe("day");
    expect(result?.date.format("YYYY-MM-DD")).toBe("2024-03-14");
  });

  test("getLooselyMatchedDate parses month date", () => {
    const result = getLooselyMatchedDate("report-2024-03");
    expect(result?.granularity).toBe("month");
    expect(result?.date.format("YYYY-MM-DD")).toBe("2024-03-01");
  });

  test("getLooselyMatchedDate parses year date", () => {
    const result = getLooselyMatchedDate("yearly-2024-summary");
    expect(result?.granularity).toBe("year");
    expect(result?.date.format("YYYY-MM-DD")).toBe("2024-01-01");
  });

  test("getLooselyMatchedDate returns null for no date", () => {
    expect(getLooselyMatchedDate("no-date-here")).toBeNull();
  });

  test("removeEscapedCharacters removes bracket and escaped tokens", () => {
    expect(removeEscapedCharacters("YYYY/[MM]/DD\\-note")).toBe("YYYY//DDnote");
  });

  test("getBasename returns trailing segment for nested format", () => {
    expect(getBasename("Daily/YYYY-MM-DD")).toBe("YYYY-MM-DD");
  });

  test("validateFormat rejects illegal filename chars", () => {
    expect(validateFormat("YYYY:MM:DD", "day")).toBe("Format contains illegal characters");
  });

  test("validateFormatComplexity marks fragile basename for nested day format without day token", () => {
    expect(validateFormatComplexity("YYYY/MM", "day")).toBe("fragile-basename");
  });

  test("validateFormatComplexity returns valid for standard day format", () => {
    expect(validateFormatComplexity("YYYY-MM-DD", "day")).toBe("valid");
  });

  test("getDateInput extracts nested path when format is fragile-basename", () => {
    const file = {
      path: "Daily/2024/03/report.md",
      extension: "md",
      basename: "report",
    } as any;
    expect(getDateInput(file, "YYYY/MM", "day")).toBe("03/report");
  });
});
