import type { Plugin } from "obsidian";
import { pluginCache, type PluginCache, type WeatherCache, type MediaCache, type TimerState } from "../ui/stores";

const CACHE_FILENAME = "cache.json";

export class CacheManager {
    private plugin: Plugin;
    private cache: PluginCache = {};
    private revision = 0;
    private persistedRevision = 0;
    private savePromise: Promise<void> | null = null;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    async load(): Promise<void> {
        try {
            const adapter = this.plugin.app.vault.adapter;
            const path = `${this.plugin.manifest.dir}/${CACHE_FILENAME}`;

            if (await adapter.exists(path)) {
                const content = await adapter.read(path);
                this.cache = JSON.parse(content);
                // Validate structure
                if (!this.cache.weather) this.cache.weather = {};
                if (!this.cache.media) this.cache.media = {};

                pluginCache.set(this.snapshot());
            } else {
                this.cache = { weather: {}, media: {} };
                pluginCache.set(this.snapshot());
            }
        } catch (e) {
            console.error("[Work Assistant] Failed to load cache:", e);
            // Fallback to empty
            this.cache = { weather: {}, media: {} };
            pluginCache.set(this.snapshot());
        }
        this.revision = 0;
        this.persistedRevision = 0;
    }

    async save(): Promise<void> {
        if (this.persistedRevision >= this.revision) return;
        if (!this.savePromise) {
            this.savePromise = this.drainSaveQueue().finally(() => {
                this.savePromise = null;
            });
        }
        await this.savePromise;
    }

    getWeather(): WeatherCache | undefined {
        return this.cache.weather;
    }

    async updateWeather(data: WeatherCache): Promise<void> {
        await this.patchWeather(data);
    }

    async patchWeather(patch: Partial<WeatherCache>): Promise<void> {
        this.cache = {
            ...this.cache,
            weather: { ...(this.cache.weather ?? {}), ...patch },
        };
        await this.markChanged();
    }

    getMedia(): MediaCache | undefined {
        return this.cache.media;
    }

    async updateMedia(data: MediaCache | undefined): Promise<void> {
        this.cache = { ...this.cache, media: data };
        await this.markChanged();
    }

    getTimer(): TimerState | undefined {
        return this.cache.timer;
    }

    async updateTimer(data: TimerState | undefined): Promise<void> {
        this.cache = { ...this.cache, timer: data };
        await this.markChanged();
    }

    private async markChanged(): Promise<void> {
        this.revision++;
        pluginCache.set(this.snapshot());
        await this.save();
    }

    private snapshot(): PluginCache {
        return {
            weather: this.cache.weather ? { ...this.cache.weather } : undefined,
            media: this.cache.media ? { ...this.cache.media } : undefined,
            timer: this.cache.timer ? { ...this.cache.timer } : undefined,
        };
    }

    private async drainSaveQueue(): Promise<void> {
        const adapter = this.plugin.app.vault.adapter;
        const path = `${this.plugin.manifest.dir}/${CACHE_FILENAME}`;

        while (this.persistedRevision < this.revision) {
            const writeRevision = this.revision;
            const content = JSON.stringify(this.snapshot(), null, 2);
            try {
                await adapter.write(path, content);
                this.persistedRevision = writeRevision;
            } catch (e) {
                // Keep the revision dirty. A later domain update or explicit save retries it.
                console.error("[Work Assistant] Failed to save cache:", e);
                break;
            }
        }
    }
}
