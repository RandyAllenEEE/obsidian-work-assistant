import { PluginSettingTab } from "obsidian";
import type { App } from "obsidian";
import { mount } from "svelte";
import type { SvelteComponent } from "svelte";

import type CalendarPlugin from "../../main";
import SettingsRouter from "./pages/Router.svelte";
import type { PeriodicConfig } from "../types";

export type ILocaleOverride = "system-default" | string;
export type IWeekStartOption =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "locale";

export interface ISettings {
  hasMigratedDailyNoteSettings: boolean;
  hasMigratedWeeklyNoteSettings: boolean;
  installedVersion: string;

  day: PeriodicConfig;
  week: PeriodicConfig;
  month: PeriodicConfig;
  quarter: PeriodicConfig;
  year: PeriodicConfig;

  enableTimelineComplication: boolean;
  localeOverride: ILocaleOverride;
  weekStart: IWeekStartOption;

  wordsPerDot: number;
  shouldConfirmBeforeCreate: boolean;
  wordCountColorRanges: Array<{ min: number; max: number; opacity: number }>;
  heatmapRefreshInterval: number;
}

export const DEFAULT_SETTINGS: ISettings = {
  // Onboarding
  installedVersion: "1.0.0-beta3",
  hasMigratedDailyNoteSettings: false,
  hasMigratedWeeklyNoteSettings: false,

  // Configuration / Preferences
  day: { enabled: true, openAtStartup: false, format: "YYYY-MM-DD", templatePath: "", folder: "" },
  week: { enabled: false, openAtStartup: false, format: "gggg-[W]ww", templatePath: "", folder: "" },
  month: { enabled: false, openAtStartup: false, format: "YYYY-MM", templatePath: "", folder: "" },
  quarter: { enabled: false, openAtStartup: false, format: "YYYY-[Q]Q", templatePath: "", folder: "" },
  year: { enabled: false, openAtStartup: false, format: "YYYY", templatePath: "", folder: "" },

  enableTimelineComplication: true,

  // Localization
  localeOverride: "system-default",
  weekStart: "locale" as IWeekStartOption,

  // Heatmap
  wordsPerDot: 250,
  shouldConfirmBeforeCreate: true,
  wordCountColorRanges: [
    { min: 0, max: 149, opacity: 0.44 },
    { min: 150, max: 399, opacity: 0.6 },
    { min: 400, max: 749, opacity: 0.76 },
    { min: 750, max: 1499, opacity: 0.92 },
    { min: 1500, max: Infinity, opacity: 1 },
  ],
  heatmapRefreshInterval: 5000,
};

export class PeriodicNotesSettingsTab extends PluginSettingTab {
  private view: SvelteComponent;

  constructor(readonly app: App, readonly plugin: CalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.containerEl.empty();

    this.view = mount(SettingsRouter, {
      target: this.containerEl,
      props: {
        app: this.app,
        settings: this.plugin.settings,
      },
    }) as any;
  }

  hide(): void {
    super.hide();
    if (this.view && typeof this.view.$destroy === 'function') {
      this.view.$destroy();
    }
  }
}
