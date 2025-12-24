import type { Plugin } from "obsidian";
import { pluginCache, type PluginCache, type WeatherCache, type MediaCache, type TimerState } from "../ui/stores";

const CACHE_FILENAME = "cache.json";

export class CacheManager {
    private plugin: Plugin;
    private cache: PluginCache = {};

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

                pluginCache.set(this.cache);
            } else {
                this.cache = { weather: {}, media: {} };
                pluginCache.set(this.cache);
            }
        } catch (e) {
            console.error("[Work Assistant] Failed to load cache:", e);
            // Fallback to empty
            this.cache = { weather: {}, media: {} };
            pluginCache.set(this.cache);
        }
    }

    async save(): Promise<void> {
        try {
            const adapter = this.plugin.app.vault.adapter;
            const path = `${this.plugin.manifest.dir}/${CACHE_FILENAME}`;
            await adapter.write(path, JSON.stringify(this.cache, null, 2));
            // Store update is done in specific update methods to ensure UI sync happens before or after save?
            // Usually we update store immediately then save async.
        } catch (e) {
            console.error("[Work Assistant] Failed to save cache:", e);
        }
    }

    getWeather(): WeatherCache | undefined {
        return this.cache.weather;
    }

    async updateWeather(data: WeatherCache): Promise<void> {
        this.cache.weather = data;
        pluginCache.update(c => ({ ...c, weather: data }));
        await this.save();
    }

    getMedia(): MediaCache | undefined {
        return this.cache.media;
    }

    async updateMedia(data: MediaCache): Promise<void> {
        this.cache.media = data;
        pluginCache.update(c => ({ ...c, media: data }));
        await this.save();
    }

    getTimer(): TimerState | undefined {
        return this.cache.timer;
    }

    async updateTimer(data: TimerState | undefined): Promise<void> {
        this.cache.timer = data;
        pluginCache.update(c => ({ ...c, timer: data }));
        await this.save();
    }
}
