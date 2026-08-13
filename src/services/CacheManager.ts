import type { Plugin } from "obsidian";

import {
  pluginCache,
  type MediaCache,
  type PluginCache,
  type TimerState,
  type WeatherCache,
} from "../ui/stores";
import { RevisionedJsonStore } from "./RevisionedJsonStore";

const CACHE_FILENAME = "cache.json";

function createCache(): PluginCache {
  return { weather: {}, media: {} };
}

function isPluginCache(value: unknown): value is PluginCache {
  if (!isRecord(value)) return false;
  return isOptionalRecord(value.weather)
    && isOptionalRecord(value.media)
    && isOptionalRecord(value.timer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOptionalRecord(value: unknown): boolean {
  return value === undefined || isRecord(value);
}

export class CacheManager {
  private cache: PluginCache = createCache();
  private readonly store: RevisionedJsonStore<PluginCache>;

  constructor(plugin: Plugin) {
    const path = `${plugin.manifest.dir}/${CACHE_FILENAME}`;
    this.store = new RevisionedJsonStore(plugin.app.vault.adapter, path, {
      create: createCache,
      validate: isPluginCache,
      onWriteError: (error) => console.error("[Work Assistant] Failed to save cache:", error),
    });
  }

  async load(): Promise<void> {
    try {
      const loaded = (await this.store.load()).value;
      this.cache = {
        weather: loaded.weather ?? {},
        media: loaded.media ?? {},
        timer: loaded.timer,
      };
    } catch (error) {
      // Keep the file protected by RevisionedJsonStore. Runtime consumers get
      // empty cache values, but later updates cannot overwrite malformed data.
      console.error("[Work Assistant] Failed to load cache:", error);
      this.cache = createCache();
    }
    pluginCache.set(this.snapshot());
  }

  async save(): Promise<void> {
    try {
      await this.store.save();
    } catch {
      // RevisionedJsonStore keeps the failed revision dirty for retry.
    }
  }

  getWeather(): WeatherCache | undefined {
    return this.cache.weather;
  }

  async updateWeather(data: WeatherCache): Promise<void> {
    await this.patchWeather(data);
  }

  async patchWeather(patch: Partial<WeatherCache>): Promise<void> {
    await this.commit({
      ...this.cache,
      weather: { ...(this.cache.weather ?? {}), ...patch },
    });
  }

  getMedia(): MediaCache | undefined {
    return this.cache.media;
  }

  async updateMedia(data: MediaCache | undefined): Promise<void> {
    await this.commit({ ...this.cache, media: data });
  }

  getTimer(): TimerState | undefined {
    return this.cache.timer;
  }

  async updateTimer(data: TimerState | undefined): Promise<void> {
    await this.commit({ ...this.cache, timer: data });
  }

  private async commit(next: PluginCache): Promise<void> {
    if (this.store.getLoadError()) {
      console.error("[Work Assistant] Cache update skipped because cache.json is unreadable:", this.store.getLoadError());
      return;
    }
    this.cache = next;
    pluginCache.set(this.snapshot());
    try {
      this.store.replace(this.snapshot());
      await this.store.save();
    } catch {
      // A write error leaves the revision dirty; the next update retries it.
    }
  }

  private snapshot(): PluginCache {
    return {
      weather: this.cache.weather ? { ...this.cache.weather } : undefined,
      media: this.cache.media ? { ...this.cache.media } : undefined,
      timer: this.cache.timer ? { ...this.cache.timer } : undefined,
    };
  }
}
