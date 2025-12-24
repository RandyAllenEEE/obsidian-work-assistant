import type { TFile } from "obsidian";
import {
  getAllDailyNotes,
  getAllWeeklyNotes,
} from "obsidian-daily-notes-interface";
import { writable } from "svelte/store";

import { defaultSettings } from "src/settings";
import type { ISettings } from "src/settings";

import { getDateUIDFromFile } from "./utils";

function createDailyNotesStore() {
  let hasError = false;
  const store = writable<Record<string, TFile>>({});
  return {
    reindex: (data?: Record<string, TFile>) => {
      if (data) {
        store.set(data);
        hasError = false;
        return;
      }
      try {
        const dailyNotes = getAllDailyNotes();
        store.set(dailyNotes || {});
        hasError = false;
      } catch (err) {
        if (!hasError) {
          console.warn("[Work Assistant] Daily notes not found or not configured in core Daily Notes plugin. Using internal cache.", err);
        }
        store.set({});
        hasError = true;
      }
    },
    ...store,
  };
}

function createWeeklyNotesStore() {
  let hasError = false;
  const store = writable<Record<string, TFile>>({});
  return {
    reindex: (data?: Record<string, TFile>) => {
      if (data) {
        store.set(data);
        hasError = false;
        return;
      }
      try {
        const weeklyNotes = getAllWeeklyNotes();
        store.set(weeklyNotes || {});
        hasError = false;
      } catch (err) {
        if (!hasError) {
          console.warn("[Work Assistant] Weekly notes not found or not configured in Periodic Notes plugin. Using internal cache.", err);
        }
        store.set({});
        hasError = true;
      }
    },
    ...store,
  };
}

export const settings = writable<ISettings>(defaultSettings);
export const dailyNotes = createDailyNotesStore();
export const weeklyNotes = createWeeklyNotesStore();

function createSelectedFileStore() {
  const store = writable<string>(null);

  return {
    setFile: (file: TFile) => {
      const id = getDateUIDFromFile(file);
      store.set(id);
    },
    ...store,
  };
}

export const activeFile = createSelectedFileStore();

export interface WeatherCache {
  locationId?: string;
  locationName?: string;
  weatherData?: {
    temp: string;
    icon: string;
    text: string;
    [key: string]: any;
  };
  lastWeatherFetch?: number; // For "Now"
  hourlyData?: any[]; // For 24h
  lastHourlyFetch?: number;
  dailyData?: any[]; // For 3d
  lastDailyFetch?: number;
  warningData?: any[];
  lastWarningFetch?: number;
  dismissedWarningIds?: string[];
}

export interface MediaCache {
  Title?: string;
  Artist?: string;
  AlbumTitle?: string;
  Status?: 'Closed' | 'Opened' | 'Changing' | 'Stopped' | 'Playing' | 'Paused';
  SourceAppId?: string;
  Thumbnail?: string;
  lastUpdate?: number;
}

export interface TimerState {
  mode: number; // Enum Mode
  startTime: number; // Timestamp
  endTime: number; // Timestamp
  paused: boolean;
  pausedTime: number;
  pomosSinceStart: number;
  cyclesSinceLastAutoStop: number;
}

export interface PluginCache {
  weather?: WeatherCache;
  media?: MediaCache;
  timer?: TimerState;
}

export const pluginCache = writable<PluginCache>({});
