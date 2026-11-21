import type { App } from "obsidian";

import Calendar from "./components/Calendar.svelte";
import type { ICalendarSource, IDot, IDayMetadata } from "./types";

declare global {
  interface Window {
    app: App;
  }
}

export { Calendar };
export type { ICalendarSource, IDot, IDayMetadata };
export { configureGlobalMomentLocale } from "./localization";
