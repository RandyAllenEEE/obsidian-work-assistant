import {
  granularities,
  type Granularity,
  type PeriodicNotesConfig,
} from "src/periodic/types";
import { get, type Updater, type Writable } from "svelte/store";

import type { ISettings } from ".";
import { Setting } from "obsidian";

export const clearStartupNote: Updater<ISettings> = (settings: ISettings) => {
  for (const granularity of granularities) {
    const config = (settings.periodicNotes as PeriodicNotesConfig)[granularity];
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
    const config = ($settings.periodicNotes as PeriodicNotesConfig)[granularity];
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

export function createSetting(container: HTMLElement, name: string, desc: string, callback: (value: boolean) => void): Setting {
  const setting = new Setting(container)
    .setName(name)
    .setDesc(desc)
    .addToggle((toggle) =>
      toggle
        .setValue(false)
        .onChange(callback)
    );

  return setting;
}
