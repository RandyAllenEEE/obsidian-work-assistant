import { requestUrl } from "obsidian";
import type CalendarPlugin from "../main";
import { sendSystemNotification } from "../utils/notifications";
import { type WeatherCache } from "../ui/stores";

export interface WeatherWarning {
    id: string;
    sender: string;
    pubTime: string;
    title: string;
    startTime: string;
    endTime: string;
    status: string;
    level: string;
    severity: string;
    severityColor: string;
    type: string;
    typeName: string;
    text: string;
}

export interface HourlyForecast {
    fxTime: string;
    temp: string;
    icon: string;
    text: string;
    pop?: string; // Precipitation probability
}

export interface DailyForecast {
    fxDate: string;
    tempMax: string;
    tempMin: string;
    iconDay: string;
    textDay: string;
    sunrise?: string;
    sunset?: string;
}

export interface WeatherData {
    temp: string;
    icon: string;
    text: string;
    windDir?: string;
    windScale?: string;
    humidity?: string;
    obsTime?: string;
    warning?: WeatherWarning[];
    hourly?: HourlyForecast[];
    daily?: DailyForecast[];
}

export class QWeatherService {
    private plugin: CalendarPlugin;

    constructor(plugin: CalendarPlugin) {
        this.plugin = plugin;
    }

    private getApiUrls(): { geo: string; weather: string; weather24h: string; weather3d: string; warning: string } {
        const { host: qweatherApiHost } = this.plugin.options.assistant.weather;

        let host = (qweatherApiHost || "").trim().replace(/\/$/, "");
        if (host && !host.startsWith("http")) host = "https://" + host;

        if (!host) {
            return { geo: "", weather: "", weather24h: "", weather3d: "", warning: "" };
        }

        return {
            geo: `${host}/geo/v2/city/lookup`,
            weather: `${host}/v7/weather/now`,
            weather24h: `${host}/v7/weather/24h`,
            weather3d: `${host}/v7/weather/3d`,
            warning: `${host}/v7/warning/now`
        };
    }

    private resolvePromise: Promise<WeatherData | null> | null = null;

    // Polling handles
    private warningIntervalId: number | null = null;

    async getWeather(forceRefresh = false): Promise<WeatherData | null> {
        return this.fetchData(forceRefresh, 'all');
    }

    async getWarnings(forceRefresh = false): Promise<WeatherData | null> {
        return this.fetchData(forceRefresh, 'warnings-only');
    }

    startWarningPolling(): void {
        // Strict check: only start if BOTH weather and warnings are enabled
        const { enabled, warnings } = this.plugin.options.assistant.weather;
        if (!enabled || !warnings) {
            this.stopWarningPolling();
            return;
        }

        if (this.warningIntervalId) {
            window.clearInterval(this.warningIntervalId);
            this.warningIntervalId = null;
        }

        // Default check every 15 minutes for background warnings
        const interval = 15 * 60 * 1000;

        console.log("[Work Assistant] Starting background weather warning polling.");
        this.warningIntervalId = window.setInterval(() => {
            this.getWarnings(false);
        }, interval);

        // Initial fetch
        this.getWarnings(false);
    }

    unload(): void {
        this.stopWarningPolling();
    }

    stopWarningPolling(): void {
        if (this.warningIntervalId) {
            window.clearInterval(this.warningIntervalId);
            this.warningIntervalId = null;
        }
    }

    private async fetchData(forceRefresh: boolean, type: 'all' | 'warnings-only'): Promise<WeatherData | null> {
        const { enabled: enableWeather, warnings: enableWeatherWarnings, token: qweatherToken, city: weatherCity, refreshInterval: weatherRefreshInterval, dailyRefreshInterval: dailyWeatherRefreshInterval, host: qweatherApiHost } = this.plugin.options.assistant.weather;

        // If getting warnings only, allow even if weather disabled? 
        // No, master weather switch usually controls tokens etc.
        if (!enableWeather || !qweatherToken || !weatherCity || !qweatherApiHost) {
            return null;
        }

        const API = this.getApiUrls();

        let cache = this.plugin.cacheManager.getWeather() || {};
        let locationId = cache.locationId;

        // If city changed, clear cache
        if (cache.locationName !== weatherCity) {
            locationId = undefined;
        }

        // 1. Resolve Location ID if missing
        if (!locationId) {
            const trimmedCity = weatherCity.trim();
            const trimmedToken = qweatherToken.trim();
            if (!trimmedCity) return null;

            console.log(`[Work Assistant] Resolving LocationID for city: "${trimmedCity}"`);
            const url = `${API.geo}?location=${encodeURIComponent(trimmedCity)}&key=${trimmedToken}&lang=en`;

            try {
                const geoRes = await requestUrl({ url, throw: false });
                if (geoRes.status === 200) {
                    const data = geoRes.json;
                    if (data.code === "200" && data.location && data.location.length > 0) {
                        locationId = data.location[0].id;

                        await this.plugin.cacheManager.updateWeather({
                            ...cache,
                            locationId,
                            locationName: weatherCity,
                            weatherData: undefined,
                            hourlyData: undefined,
                            dailyData: undefined,
                            lastWeatherFetch: 0,
                            lastHourlyFetch: 0,
                            lastDailyFetch: 0,
                            warningData: undefined,
                            lastWarningFetch: 0
                        });
                        cache = this.plugin.cacheManager.getWeather() || {};
                    } else {
                        console.error("[Work Assistant] GeoAPI failed:", data);
                        return null;
                    }
                } else {
                    return null;
                }
            } catch (e) {
                if (navigator.onLine) {
                    console.error("[Work Assistant] GeoAPI Network Error:", e);
                }
                return null;
            }
        }

        if (!locationId) return null;

        const now = Date.now();
        const trimmedToken = qweatherToken.trim();

        // Settings: Now/Hourly interval (mins), Daily interval (hours)
        const nowIntervalMs = (weatherRefreshInterval || 60) * 60 * 1000;
        const dailyIntervalMs = (dailyWeatherRefreshInterval || 4) * 60 * 60 * 1000;
        const warningIntervalMs = 15 * 60 * 1000;

        const timeSinceLastNow = now - (cache.lastWeatherFetch || 0);
        const timeSinceLastDaily = now - (cache.lastDailyFetch || 0);
        const timeSinceLastWarning = now - (cache.lastWarningFetch || 0);

        let shouldFetchNow = false;
        let shouldFetchDaily = false;
        let shouldFetchWarning = false;

        if (type === 'all') {
            shouldFetchNow = forceRefresh || timeSinceLastNow > nowIntervalMs;
            shouldFetchDaily = forceRefresh || timeSinceLastDaily > dailyIntervalMs;
        }

        // Warnings logic: Check regardless of type, but respect enableWeatherWarnings
        // If type is warnings-only, we ONLY check warnings.
        // If type is all, we check warnings if enabled.
        if (enableWeatherWarnings) {
            if (type === 'warnings-only' || type === 'all') {
                shouldFetchWarning = forceRefresh || timeSinceLastWarning > warningIntervalMs;
            }
        }

        // If nothing needs update, return cache
        if (!shouldFetchNow && !shouldFetchDaily && !shouldFetchWarning) {
            return {
                ...cache.weatherData,
                warning: cache.warningData,
                hourly: cache.hourlyData,
                daily: cache.dailyData
            } as WeatherData;
        }

        // Prepare fetches
        interface RequestResult { json: any; status: number }
        const promises: Promise<RequestResult | { error: any }>[] = [];
        // Map indices to result types
        let fetchNowIndex = -1, fetchWarningIndex = -1, fetchHourlyIndex = -1, fetchDailyIndex = -1;
        let pIndex = 0;

        if (shouldFetchNow) {
            promises.push(requestUrl({ url: `${API.weather}?location=${locationId}&key=${trimmedToken}&lang=en` }));
            fetchNowIndex = pIndex++;

            promises.push(requestUrl({ url: `${API.weather24h}?location=${locationId}&key=${trimmedToken}&lang=en` }));
            fetchHourlyIndex = pIndex++;
        }

        if (shouldFetchWarning) {
            // Fetch warnings decoupled from Now
            promises.push(requestUrl({ url: `${API.warning}?location=${locationId}&key=${trimmedToken}&lang=en` }));
            fetchWarningIndex = pIndex++;
        }

        if (shouldFetchDaily) {
            promises.push(requestUrl({ url: `${API.weather3d}?location=${locationId}&key=${trimmedToken}&lang=en` }));
            fetchDailyIndex = pIndex++;
        }

        try {
            const results = await Promise.all(promises.map(p => p.catch(e => ({ error: e }))));

            const newTask: Partial<WeatherCache> = {};
            let hasUpdates = false;

            // Process Now
            if (fetchNowIndex !== -1) {
                const res = results[fetchNowIndex];
                if (res && 'json' in res && res.json && res.json.code === "200") {
                    newTask.weatherData = res.json.now;
                    newTask.lastWeatherFetch = now;
                    hasUpdates = true;
                }
            }

            // Process Hourly
            if (fetchHourlyIndex !== -1) {
                const res = results[fetchHourlyIndex];
                if (res && 'json' in res && res.json && res.json.code === "200") {
                    newTask.hourlyData = res.json.hourly; // list of 24 objects
                    newTask.lastHourlyFetch = now;
                    hasUpdates = true;
                }
            }

            // Process Warning
            if (fetchWarningIndex !== -1) {
                const res = results[fetchWarningIndex];
                if (res && 'json' in res && res.json && res.json.code === "200") {
                    const warnings = res.json.warning || [];
                    newTask.warningData = warnings;
                    newTask.lastWarningFetch = now;

                    // Notification Logic
                    const cachedWarnings = cache.warningData as WeatherWarning[] || [];
                    const newWarnings = warnings.filter((w: WeatherWarning) => !cachedWarnings.some(cw => cw.id === w.id));
                    if (newWarnings.length > 0) {
                        newWarnings.forEach((w: WeatherWarning) => {
                            sendSystemNotification(`⚠️ ${w.typeName} ${w.level} Warning`, `${w.title}`, false);
                        });
                    }

                    // Prune dismissed
                    const currentDismissed = cache.dismissedWarningIds || [];
                    const activeWarningIds = new Set(warnings.map((w: WeatherWarning) => w.id));
                    newTask.dismissedWarningIds = currentDismissed.filter(id => activeWarningIds.has(id));
                    hasUpdates = true;
                }
            }

            // Process Daily
            if (fetchDailyIndex !== -1) {
                const res = results[fetchDailyIndex];
                if (res && 'json' in res && res.json && res.json.code === "200") {
                    newTask.dailyData = res.json.daily;
                    newTask.lastDailyFetch = now;
                    hasUpdates = true;
                }
            }

            if (hasUpdates) {
                await this.plugin.cacheManager.updateWeather({
                    ...cache,
                    ...newTask
                });

                // Refresh local cache ref
                cache = this.plugin.cacheManager.getWeather() || {};
            }

            // Return full combined data
            return {
                ...cache.weatherData,
                warning: cache.warningData,
                hourly: cache.hourlyData,
                daily: cache.dailyData
            } as WeatherData;

        } catch (e) {
            // Only log if online. If offline, it's expected.
            if (navigator.onLine) {
                console.error("[Work Assistant] Weather Fetch Error:", e);
            }
            // Return cached if fail
            return {
                ...cache.weatherData,
                warning: cache.warningData,
                hourly: cache.hourlyData,
                daily: cache.dailyData
            } as WeatherData;
        }
    }

    async dismissWarning(id: string): Promise<void> {
        const cache = this.plugin.cacheManager.getWeather() || {};
        const dismissed = cache.dismissedWarningIds || [];
        if (!dismissed.includes(id)) {
            await this.plugin.cacheManager.updateWeather({
                ...cache,
                dismissedWarningIds: [...dismissed, id]
            });
        }
    }
}
