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




