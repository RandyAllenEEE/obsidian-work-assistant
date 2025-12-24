export type IPeriodicity = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
export type Granularity =
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year"; /*| "fiscal-year" */

export const granularities: Granularity[] = [
  "day",
  "week",
  "month",
  "quarter",
  "year" /*", fiscal-year" */,
];

export interface PeriodicConfig {
  enabled: boolean;
  openAtStartup: boolean;

  format: string;
  folder: string;
  templatePath?: string;
}

export type PeriodicNotesConfig = Record<Granularity, PeriodicConfig> & {
  enabled: boolean;
  calendarLinkage: boolean;
  wordsPerDot: number;
  timelineComplication: boolean;
};




