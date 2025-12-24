import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { writable, type Writable } from 'svelte/store';
import { Component, Platform, debounce } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';
import type { CacheManager } from "../services/CacheManager";
import { type MediaCache } from "../ui/stores";

// interface MediaInfo extends MediaCache { }

export class SystemMediaMonitor extends Component {
    private process: ChildProcessWithoutNullStreams | null = null;
    public mediaStore: Writable<MediaCache | null> = writable(null);
    private buffer = '';
    private bridgePath: string;
    private setupScriptPath: string;
    private cacheManager: CacheManager;

    constructor(pluginPath: string, cacheManager: CacheManager) {
        super();
        this.bridgePath = path.join(pluginPath, 'bin', 'SMTCBridge.exe');
        this.setupScriptPath = path.join(pluginPath, 'bin', 'setup.ps1');
        this.cacheManager = cacheManager;
        this.initializeFromCache();
    }

    private initializeFromCache() {
        // Load cached media state immediately
        const cached = this.cacheManager.getMedia();
        if (cached && (cached.Title || cached.Artist)) {
            // Restore as "Paused" or "Stopped" to avoid confusion if it was playing when closed?
            // User might want to see what was last playing. Retain status but maybe UI renders it differently?
            // Keeping raw status is fine.
            this.mediaStore.set(cached);
        }
    }

    onload(): void {
        if (!Platform.isWin) return;
        this.startMonitoring();
    }

    async ensureBridge(): Promise<boolean> {
        if (fs.existsSync(this.bridgePath)) {
            return true;
        }

        console.log("[SMTC] SMTCBridge.exe not found. Running compilation setup...");
        return new Promise((resolve) => {
            const child = spawn('powershell', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', this.setupScriptPath
            ], { windowsHide: true });

            child.on('close', (code) => {
                if (code === 0) {
                    console.log("[SMTC] Compilation successful.");
                    resolve(true);
                } else {
                    console.error(`[SMTC] Compilation failed with code ${code}`);
                    resolve(false);
                }
            });

            child.on('error', (err) => {
                console.error("[SMTC] Failed to run setup script:", err);
                resolve(false);
            });
        });
    }

    async startMonitoring(): Promise<void> {
        this.stopMonitoring();

        const ready = await this.ensureBridge();
        if (!ready) {
            console.error("[SMTC] Bridge not ready. Monitoring aborted.");
            return;
        }

        try {
            console.log(`[SMTC] Starting Monitor: ${this.bridgePath}`);

            this.process = spawn(this.bridgePath, ['monitor'], {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            this.process.stdout.on('data', (data: Buffer) => {
                const chunk = data.toString();
                this.buffer += chunk;
                this.processBuffer();
            });

            this.process.stderr.on('data', (data: Buffer) => {
                console.error(`[SMTC] Bridge Stderr: ${data.toString()}`);
            });

            this.process.on('close', (code) => {
                console.log(`[SMTC] Monitor process exited with code ${code}`);
                this.process = null;
            });

            this.process.on('error', (err) => {
                console.error("[SMTC] Failed to spawn monitor:", err);
            });

        } catch (e) {
            console.error("[SMTC] Error starting system monitor:", e);
        }
    }

    private processBuffer() {
        let startIndex = this.buffer.indexOf('JSON_START');
        let endIndex = this.buffer.indexOf('JSON_END');

        while (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
            const jsonStr = this.buffer.substring(startIndex + 10, endIndex);

            try {
                if (jsonStr === 'null') {
                    // Don't clear store/cache on null immediately if we want to persist "Last Played"?
                    // Usually null means "no active session".
                    // If we want persistence, we might ignore null updates OR treat them as "Closed".
                    this.mediaStore.set(null);
                    // this.updateCache(null); // Optional: clear cache or keep last? 
                    // Usually if session ends, we verify that. Let's keep last played in UI if preferred,
                    // but 'null' implies nothing to control.
                } else {
                    const data = JSON.parse(jsonStr) as MediaCache;

                    // Optimization: Check if meaningful change before update?
                    // Store set triggers subscribers.
                    this.mediaStore.set(data);
                    this.debouncedSave(data);
                }
            } catch (e) {
                console.error("[SMTC] Failed to parse JSON:", e);
            }

            this.buffer = this.buffer.substring(endIndex + 8);
            startIndex = this.buffer.indexOf('JSON_START');
            endIndex = this.buffer.indexOf('JSON_END');
        }

        if (this.buffer.length > 10000) {
            this.buffer = '';
        }
    }

    // Debounce save to avoid disk I/O on every second update (if any)
    private debouncedSave = debounce((data: MediaCache) => {
        if (!data) return;
        // Sanitize: Pick only allowed fields to prevent cache bloat (garbage properties from JSON)
        // and ensure we overwrite cleanly.
        const cleanData: MediaCache = {
            Title: data.Title,
            Artist: data.Artist,
            AlbumTitle: data.AlbumTitle,
            Status: data.Status,
            SourceAppId: data.SourceAppId,
            Thumbnail: data.Thumbnail, // We keep the base64 thumbnail
            lastUpdate: Date.now()
        };
        this.cacheManager.updateMedia(cleanData);
    }, 2000, true);

    stopMonitoring(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }

    controlMedia(action: 'PlayPause' | 'Next' | 'Previous'): void {
        if (!Platform.isWin) return;

        const cmd = action.toLowerCase();

        try {
            console.log(`[SMTC] Sending control: ${cmd}`);
            const child = spawn(this.bridgePath, ['control', cmd], {
                windowsHide: true,
                stdio: ['ignore', 'ignore', 'pipe']
            });

            child.stderr.on('data', (data) => {
                console.error(`[SMTC] Control Stderr: ${data}`);
            });

            child.on('error', (err) => {
                console.error("[SMTC] Failed to spawn control:", err);
            });

        } catch (e) {
            console.error("[SMTC] Failed to control media:", e);
        }
    }

    onunload(): void {
        this.stopMonitoring();
    }
}
