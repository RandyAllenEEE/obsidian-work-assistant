import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { writable, type Writable } from 'svelte/store';
import { Component, Platform, debounce, Notice } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { CacheManager } from "../services/CacheManager";
import { type MediaCache } from "../ui/stores";
import type CalendarPlugin from '../main';

// Known hashes for verification
const KNOWN_CS_HASH = "86B272BF9CCF50CCAF554F821163588EA87D8AA0E8E24AA63CA50652FE0138DA";
const KNOWN_EXE_HASH = "638E16C97FF01683AF55C5B528D3AE58467AFF7841CE465328ACB4133AD6CCAF";

export class SystemMediaMonitor extends Component {
    private process: ChildProcessWithoutNullStreams | null = null;
    public mediaStore: Writable<MediaCache | null> = writable(null);
    private buffer = '';
    private bridgePath: string;
    private sourcePath: string;
    private setupScriptPath: string;
    private cacheManager: CacheManager;
    private plugin: CalendarPlugin;

    constructor(plugin: CalendarPlugin, cacheManager: CacheManager) {
        super();
        this.plugin = plugin;
        this.cacheManager = cacheManager;

        const basePath = (plugin.app.vault.adapter as any).getBasePath();
        const manifestDir = plugin.manifest.dir || '.obsidian/plugins/obsidian-work-assistant';
        const pluginPath = path.join(basePath, manifestDir);

        this.bridgePath = path.join(pluginPath, 'bin', 'SMTCBridge.exe');
        this.sourcePath = path.join(pluginPath, 'bin', 'SMTCBridge.cs');
        this.setupScriptPath = path.join(pluginPath, 'bin', 'setup.ps1');

        this.initializeFromCache();
    }

    private initializeFromCache() {
        // Load cached media state immediately
        const cached = this.cacheManager.getMedia();
        if (cached && (cached.Title || cached.Artist)) {
            this.mediaStore.set(cached);
        }
    }

    onload(): void {
        if (!Platform.isWin) return;
        this.startMonitoring();
    }

    private computeHash(filePath: string): string | null {
        if (!fs.existsSync(filePath)) return null;
        try {
            const fileBuffer = fs.readFileSync(filePath);
            const hashSum = crypto.createHash('sha256');
            hashSum.update(fileBuffer);
            return hashSum.digest('hex').toUpperCase();
        } catch (e) {
            console.error(`[SMTC] Failed to compute hash for ${filePath}`, e);
            return null;
        }
    }

    private async verifyIntegrity(): Promise<boolean> {
        const exeHash = this.computeHash(this.bridgePath);
        const trustedHash = this.plugin.options.media.trustedExeHash;

        // 1. Check if matches shipped binary
        if (exeHash === KNOWN_EXE_HASH) {
            return true;
        }

        // 2. Check if matches locally compiled trusted binary
        if (trustedHash && exeHash === trustedHash) {
            return true;
        }

        console.warn(`[SMTC] Binary hash mismatch. Current: ${exeHash}. Verifying source...`);

        // 3. Verify Source Code
        const sourceHash = this.computeHash(this.sourcePath);
        if (sourceHash !== KNOWN_CS_HASH) {
            console.error(`[SMTC] Security Violation: Source code hash mismatch! Expected ${KNOWN_CS_HASH}, got ${sourceHash}`);
            new Notice("Work Assistant: SMTC Security Violation. Source code modified.");
            return false;
        }

        console.log("[SMTC] Source verified. Recompiling to ensure safety...");

        // 4. Recompile
        const compiled = await this.runCompilation();
        if (compiled) {
            const newExeHash = this.computeHash(this.bridgePath);
            if (newExeHash) {
                console.log(`[SMTC] Recompiled successfully. Trusted new hash: ${newExeHash}`);
                // Save this hash as trusted
                this.plugin.writeOptions((old) => ({
                    ...old,
                    media: { ...old.media, trustedExeHash: newExeHash }
                }));
                return true;
            }
        }

        return false;
    }

    async ensureBridge(): Promise<boolean> {
        // First check existence
        if (!fs.existsSync(this.bridgePath)) {
            console.log("[SMTC] SMTCBridge.exe not found. verified source and compiling...");
            // Check source before compiling first time too
            const sourceHash = this.computeHash(this.sourcePath);
            if (sourceHash !== KNOWN_CS_HASH) {
                console.error("[SMTC] Cannot compile: Source code mismatch.");
                return false;
            }
            return await this.runCompilation();
        }

        // Then verify integrity
        return await this.verifyIntegrity();
    }

    private async runCompilation(): Promise<boolean> {
        console.log("[SMTC] Running setup script...");
        return new Promise((resolve) => {
            const child = spawn('powershell', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', this.setupScriptPath
            ], {
                windowsHide: true,
                cwd: path.dirname(this.setupScriptPath)
            });

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
            console.error("[SMTC] Bridge validation failed. Monitoring aborted.");
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
                    this.mediaStore.set(null);
                } else {
                    const data = JSON.parse(jsonStr) as MediaCache;
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
            console.warn(`[SMTC] Buffer overflow (${this.buffer.length} chars), clearing`);
            this.buffer = '';
        }
    }

    // Debounce save to avoid disk I/O on every second update (if any)
    private debouncedSave = debounce((data: MediaCache) => {
        if (!data) return;
        const cleanData: MediaCache = {
            Title: data.Title,
            Artist: data.Artist,
            AlbumTitle: data.AlbumTitle,
            Status: data.Status,
            SourceAppId: data.SourceAppId,
            Thumbnail: data.Thumbnail,
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

export function getActiveWindow(): Promise<Window> {
    return new Promise((resolve) => {
        let settled = false;
        let titleBuffer = '';
        const resolveOnce = (title: string) => {
            if (settled) return;
            settled = true;
            resolve({ title } as unknown as Window);
        };

        const child = spawn('powershell', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command', 'Get-Process -Id $PID | Select-Object -ExpandProperty MainWindowTitle'
        ], {
            windowsHide: true,
        });

        child.stdout.on('data', (data: Buffer) => {
            titleBuffer += data.toString();
        });

        child.stderr.on('data', (data: Buffer) => {
            console.error(`[SMTC] GetActiveWindow Stderr: ${data.toString()}`);
        });

        child.on('close', (code) => {
            if (code !== 0) {
                console.error(`[SMTC] GetActiveWindow failed with code ${code}`);
            }
            resolveOnce(titleBuffer.trim());
        });

        child.on('error', (err) => {
            console.error("[SMTC] Failed to run GetActiveWindow:", err);
            resolveOnce('');
        });
    });
}
