import type { Granularity, PeriodicConfig } from "./types";

export const DEFAULT_DAILY_NOTE_FORMAT = "YYYY-MM-DD";
export const DEFAULT_WEEKLY_NOTE_FORMAT = "gggg-[W]ww";
export const DEFAULT_MONTHLY_NOTE_FORMAT = "YYYY-MM";
export const DEFAULT_QUARTERLY_NOTE_FORMAT = "YYYY-[Q]Q";
export const DEFAULT_YEARLY_NOTE_FORMAT = "YYYY";

export const DEFAULT_FORMAT = Object.freeze({
  day: DEFAULT_DAILY_NOTE_FORMAT,
  week: DEFAULT_WEEKLY_NOTE_FORMAT,
  month: DEFAULT_MONTHLY_NOTE_FORMAT,
  quarter: DEFAULT_QUARTERLY_NOTE_FORMAT,
  year: DEFAULT_YEARLY_NOTE_FORMAT,
});

export const HUMANIZE_FORMAT = Object.freeze({
  month: "MMMM YYYY",
  quarter: "YYYY Q[Q]",
  year: "YYYY",
});

export const DEFAULT_PERIODIC_TEMPLATE_FOLDER = "periodic_note_templates";

export const DEFAULT_PERIODIC_TEMPLATE_PATH: Readonly<Record<Granularity, string>> = Object.freeze({
  day: `${DEFAULT_PERIODIC_TEMPLATE_FOLDER}/Daily.md`,
  week: `${DEFAULT_PERIODIC_TEMPLATE_FOLDER}/Weekly.md`,
  month: `${DEFAULT_PERIODIC_TEMPLATE_FOLDER}/Monthly.md`,
  quarter: `${DEFAULT_PERIODIC_TEMPLATE_FOLDER}/Quarterly.md`,
  year: `${DEFAULT_PERIODIC_TEMPLATE_FOLDER}/Yearly.md`,
});

export const DEFAULT_PERIODIC_CONFIG: PeriodicConfig = Object.freeze({
  enabled: false,
  openAtStartup: false,

  format: "",
  templatePath: "",
  folder: "",
});
