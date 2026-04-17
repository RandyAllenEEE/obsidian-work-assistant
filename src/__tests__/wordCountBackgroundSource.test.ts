import moment from "moment";
import { WordCountBackgroundSource } from "../ui/sources/wordCountBackground";
import { get } from "svelte/store";

jest.mock("obsidian-daily-notes-interface", () => ({
  getDailyNote: jest.fn(() => null),
  getWeeklyNote: jest.fn(() => null),
}));

jest.mock("svelte/store", () => ({
  get: jest.fn(),
}));

jest.mock("../ui/stores", () => ({
  dailyNotes: {},
  weeklyNotes: {},
  settings: {
    _isSettingsStore: true,
    subscribe: (callback: (value: any) => void) => {
      callback({
        wordCount: {
          heatmap: {
            colorRanges: [
              { min: 0, max: 149, opacity: 0.44 },
              { min: 150, max: 399, opacity: 0.6 },
            ],
          },
        },
      });
      return () => undefined;
    },
  },
}));

describe("WordCountBackgroundSource", () => {
  beforeEach(() => {
    (get as jest.Mock).mockClear();
    (get as jest.Mock).mockImplementation((store) => {
      if (store && store._isSettingsStore) {
        return {
          wordCount: {
            heatmap: {
              colorRanges: [
                { min: 0, max: 149, opacity: 0.44 },
                { min: 150, max: 399, opacity: 0.6 },
              ],
            },
          },
        };
      }
      return {};
    });
  });

  test("treats negative word count as zero and renders no heatmap level", async () => {
    const source = new WordCountBackgroundSource({
      getWordCountForDate: jest.fn(() => -8),
    } as any);

    const metadata = await source.getDailyMetadata(moment("2026-01-01", "YYYY-MM-DD"));
    expect(metadata.dataAttributes["data-heatmap-level"]).toBeUndefined();
  });

  test("constructor does not create persistent settings subscription", () => {
    const source = new WordCountBackgroundSource({
      getWordCountForDate: jest.fn(() => 10),
    } as any);

    expect(source).toBeDefined();
    expect(get).toHaveBeenCalledTimes(0);
  });
});
