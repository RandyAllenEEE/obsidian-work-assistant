import type { Moment } from "moment";
import type { ICalendarSource, IDayMetadata } from "obsidian-calendar-ui";
import type WordCountStats from "../../wordCountStats";
import { t } from "../../i18n";

export function createDailyStatsSource(wordCountStats: WordCountStats): ICalendarSource {
    return {
        getDailyMetadata: async (date: Moment): Promise<IDayMetadata> => {
            const dateStr = date.format("YYYY-MM-DD");
            // Use logical OR for fallback just in case, assuming methods return number
            const wordCount = wordCountStats.getWordCountForDate(dateStr) || 0;
            const pomoCount = wordCountStats.getPomoCountForDate(dateStr) || 0;

            if (wordCount === 0 && pomoCount === 0) {
                return {};
            }

            const tooltipText = `${t("calendar-tooltip-words")}: ${wordCount}\n${t("calendar-tooltip-pomo")}: ${pomoCount}`;

            return {
                dataAttributes: {
                    "aria-label": tooltipText,
                },
            };
        },
        getWeeklyMetadata: async (date: Moment): Promise<IDayMetadata> => {
            const wordCount = wordCountStats.getWeeklyWordCount(date) || 0;
            const pomoCount = wordCountStats.getWeeklyPomoCount(date) || 0;

            if (wordCount === 0 && pomoCount === 0) {
                return {};
            }

            const tooltipText = `${t("calendar-tooltip-words")}: ${wordCount}\n${t("calendar-tooltip-pomo")}: ${pomoCount}`;

            return {
                dataAttributes: {
                    "aria-label": tooltipText,
                },
            };
        },
    };
}
