import type { Moment } from "moment";
import type { ICalendarSource, IDayMetadata } from "obsidian-calendar-ui";
import { getDailyNote, getWeeklyNote } from "obsidian-daily-notes-interface";
import { get } from "svelte/store";

import { dailyNotes, settings, weeklyNotes } from "../stores";
import WordCountStats from "../../wordCountStats";

// Default color mapping configuration
const DEFAULT_COLOR_MAPPING = [
  { min: 0, max: 149, opacity: 0.44 },
  { min: 150, max: 399, opacity: 0.6 },
  { min: 400, max: 749, opacity: 0.76 },
  { min: 750, max: 1499, opacity: 0.92 },
  { min: 1500, max: Infinity, opacity: 1 }
];

export class WordCountBackgroundSource {
  private wordCountStats: WordCountStats;
  private colorMapping: Array<{ min: number; max: number; opacity: number }>;

  constructor(wordCountStats: WordCountStats) {
    this.wordCountStats = wordCountStats;
    // Initialize with default color mapping
    this.colorMapping = DEFAULT_COLOR_MAPPING;

    // Subscribe to settings changes to update color mapping dynamically
    settings.subscribe((settings) => {
      if (settings && settings.wordCountColorRanges) {
        this.colorMapping = settings.wordCountColorRanges;
      }
    });
  }

  // Get opacity value based on word count
  private getOpacityForWordCount(wordCount: number): number {
    for (const range of this.colorMapping) {
      if (wordCount >= range.min && wordCount <= range.max) {
        return range.opacity;
      }
    }
    return 0; // Default to transparent if no range matches
  }

  // Get heatmap level (0-4) based on word count
  private getLevelForWordCount(wordCount: number): number {
    for (let i = 0; i < this.colorMapping.length; i++) {
      const range = this.colorMapping[i];
      if (wordCount >= range.min && wordCount <= range.max) {
        return i;
      }
    }
    return -1;
  }

  getDailyMetadata: (date: Moment) => Promise<IDayMetadata> = async (date: Moment) => {
    const file = getDailyNote(date, get(dailyNotes));

    // Get word count for this date
    const dateString = date.format("YYYY/M/D"); // Match the format used in wordCountStats
    const wordCount = this.wordCountStats.getWordCountForDate(dateString);

    // Check if we should ignore 0 word counts.
    // Logic update: If wordCount is 0, we treat it as "no data" (transparent), unless explicitly mapped otherwise.
    // However, the user complained about future dates (0 words) being grey. 
    // So we force level -1 if wordCount is 0.
    const level = wordCount === 0 ? -1 : this.getLevelForWordCount(wordCount);

    const classes = file ? ["has-note"] : [];

    const dataAttributes: Record<string, string> = {
      "data-heatmap-level": level !== -1 ? level.toString() : undefined
    };

    // Robustness: Inject inline style via dataAttributes to mimic the referenced project's approach.
    // We use the CSS variables we set up in view.ts to maintain reactivity to settings (opacity changes).
    if (level !== -1) {
      dataAttributes["style"] = `background-color: rgba(var(--calendar-word-count-color), var(--heatmap-opacity-${level})) !important;`;
    }

    return {
      classes,
      dataAttributes
    };
  };

  // Get heatmap level (0-4) based on weekly word count (ranges scaled by 7)
  private getLevelForWeeklyWordCount(wordCount: number): number {
    for (let i = 0; i < this.colorMapping.length; i++) {
      const range = this.colorMapping[i];
      // Scale min and max by 7 for weekly targets
      const weeklyMin = range.min * 7;
      const weeklyMax = range.max === Infinity ? Infinity : range.max * 7;

      if (wordCount >= weeklyMin && wordCount <= weeklyMax) {
        return i;
      }
    }
    return -1;
  }

  getWeeklyMetadata: (date: Moment) => Promise<IDayMetadata> = async (date: Moment) => {
    const file = getWeeklyNote(date, get(weeklyNotes));
    const showWeeklyNote = get(settings).showWeeklyNote;

    let wordCount = 0;
    if (showWeeklyNote) {
      wordCount = this.wordCountStats.getWeeklyWordCount(date);
    } else {
      wordCount = 0;
    }

    const classes = file ? ["has-note"] : [];
    // Use the new weekly level calculation which scales ranges by 7
    const level = wordCount === 0 ? -1 : this.getLevelForWeeklyWordCount(wordCount);

    const dataAttributes: Record<string, string> = {
      "data-heatmap-level": level !== -1 ? level.toString() : undefined
    };

    if (level !== -1) {
      dataAttributes["style"] = `background-color: rgba(var(--calendar-word-count-color), var(--heatmap-opacity-${level})) !important;`;
    }

    return {
      classes,
      dataAttributes
    };
  };
}

// Export a factory function to create the source with word count stats
export function createWordCountBackgroundSource(wordCountStats: WordCountStats): ICalendarSource {
  const source = new WordCountBackgroundSource(wordCountStats);

  return {
    getDailyMetadata: source.getDailyMetadata,
    getWeeklyMetadata: source.getWeeklyMetadata
  };
}