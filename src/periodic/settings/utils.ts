import type { App, DailyNotesPlugin, DailyNotesSettings } from "obsidian";
import {
  granularities,
  type Granularity,
  type PeriodicConfig,
} from "src/periodic/types";
import { get, type Updater, type Writable } from "svelte/store";

import { DEFAULT_PERIODIC_CONFIG } from "../constants";
import type { ISettings } from ".";

const defaultPeriodicSettings = granularities.reduce((acc, g) => {
  acc[g] = { ...DEFAULT_PERIODIC_CONFIG };
  return acc;
}, {} as Record<Granularity, PeriodicConfig>);

export const clearStartupNote: Updater<ISettings> = (settings: ISettings) => {
  for (const granularity of granularities) {
    // @ts-ignore
    const config = settings[granularity];
    if (config && config.openAtStartup) {
      config.openAtStartup = false;
    }
  }
  return settings;
};

interface StartupNoteConfig {
  granularity: Granularity;
}

type FindStartupNoteConfigFunc = (
  settings: Writable<ISettings>
) => StartupNoteConfig | null;

export const findStartupNoteConfig: FindStartupNoteConfigFunc = (
  settings: Writable<ISettings>
) => {
  const $settings = get(settings);
  for (const granularity of granularities) {
    // @ts-ignore
    const config = $settings[granularity];
    if (config && config.openAtStartup) {
      return {
        granularity,
      };
    }
  }

  return null;
};

export const wrapAround = (value: number, size: number): number => {
  return ((value % size) + size) % size;
};

export function isDailyNotesPluginEnabled(app: App): boolean {
  return app.internalPlugins.getPluginById("daily-notes").enabled;
}

function getDailyNotesPlugin(app: App): DailyNotesPlugin | null {
  const installedPlugin = app.internalPlugins.getPluginById("daily-notes");
  if (installedPlugin) {
    return installedPlugin.instance as DailyNotesPlugin;
  }
  return null;
}

export function hasLegacyDailyNoteSettings(app: App): boolean {
  const options = getDailyNotesPlugin(app)?.options || {};
  return !!(options.format || options.folder || options.template);
}

export function getLegacyDailyNoteSettings(app: App): DailyNotesSettings {
  const dailyNotesInstalledPlugin = app.internalPlugins.plugins["daily-notes"];
  if (!dailyNotesInstalledPlugin) {
    return {
      folder: "",
      template: "",
      format: "",
    };
  }

  const options = {
    format: "",
    folder: "",
    template: "",
    ...getDailyNotesPlugin(app)?.options,
  };
  return {
    format: options.format,
    folder: options.folder?.trim(),
    template: options.template?.trim(),
  };
}

export function disableDailyNotesPlugin(app: App): void {
  app.internalPlugins.getPluginById("daily-notes").disable(true);
}

export function getLocaleOptions(): { label: string; value: string }[] {
  const sysLocale = navigator.language?.toLowerCase();
  return [
    { label: `Same as system (${sysLocale})`, value: "system-default" },
    ...window.moment.locales().map((locale) => ({
      label: locale,
      value: locale,
    })),
  ];
}

export function getWeekStartOptions(): { label: string; value: string }[] {
  const weekdays = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const localizedWeekdays = window.moment.weekdays();
  const localeWeekStartNum = window._bundledLocaleWeekSpec?.dow ?? (window.moment.localeData() as any)._week?.dow ?? 0;
  const localeWeekStart = localizedWeekdays[localeWeekStartNum];
  return [
    { label: `Locale default (${localeWeekStart})`, value: "locale" },
    ...localizedWeekdays.map((day, i) => ({ value: weekdays[i], label: day })),
  ];
}
