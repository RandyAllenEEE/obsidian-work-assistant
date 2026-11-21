import type { ChildProcessWithoutNullStreams } from "child_process";
import { writable, type Writable } from "svelte/store";
import { Component, Platform, debounce, Notice } from "obsidian";

import type { CacheManager } from "../services/CacheManager";
import type { MediaCache } from "../ui/stores";
import type CalendarPlugin from "../main";
import { t } from "../i18n";

// Known hashes for verification. These track the shipped, trusted bridge files.
const KNOWN_CS_HASH = "701249D897255F9D177A57BF93D3D5EF7252645109AA0ABBEE19910F35CC2F24";
const KNOWN_EXE_HASH = "8ABBD5D999F0C621A3F7AB6CCB39C813548649CA16F65EC36444FF385634E0A2";
const JSON_START_MARKER = "JSON_START";
const JSON_END_MARKER = "JSON_END";
const MAX_BUFFER_LENGTH = 1024 * 1024;
const INITIAL_RESTART_DELAY = 1000;
const MAX_RESTART_DELAY = 30_000;

interface DesktopRuntime {
    spawn: typeof import("child_process").spawn;
    fs: typeof import("fs");
    crypto: typeof import("crypto");
}

type RuntimeRequire = (moduleId: string) => unknown;

declare const require: RuntimeRequire | undefined;

function requireDesktopModule<T>(moduleId: string): T {
    if (typeof require !== "function") {
        throw new Error(`[SMTC] Node runtime is unavailable; cannot load ${moduleId}`);
    }
    const runtimeRequire = require;
    return runtimeRequire(moduleId) as T;
}

function joinSystemPath(...parts: string[]): string {
    return parts
        .filter(Boolean)
        .map((part, index) => index === 0
            ? part.replace(/[\\/]+$/, "")
            : part.replace(/^[\\/]+|[\\/]+$/g, ""))
        .join("/");
}

export class SystemMediaMonitor extends Component {
    private process: ChildProcessWithoutNullStreams | null = null;
    public mediaStore: Writable<MediaCache | null> = writable(null);
    private buffer = "";
    private readonly bridgePath: string;
    private readonly sourcePath: string;
    private readonly setupScriptPath: string;
    private readonly setupDirectory: string;
    private readonly cacheManager: CacheManager;
    private readonly plugin: CalendarPlugin;
    private runtime: DesktopRuntime | null = null;
    private runtimePromise: Promise<DesktopRuntime> | null = null;
    private restartTimer: number | null = null;
    private restartDelay = INITIAL_RESTART_DELAY;
    private runGeneration = 0;
    private stopped = true;

    constructor(plugin: CalendarPlugin, cacheManager: CacheManager) {
        super();
        this.plugin = plugin;
        this.cacheManager = cacheManager;

        const adapter = plugin.app.vault.adapter as typeof plugin.app.vault.adapter & {
            getBasePath(): string;
        };
        const basePath = adapter.getBasePath();
        const manifestDir = plugin.manifest.dir
            || `${plugin.app.vault.configDir || ".obsidian"}/plugins/${plugin.manifest.id}`;
        const pluginPath = joinSystemPath(basePath, manifestDir);
        this.setupDirectory = joinSystemPath(pluginPath, "bin");
        this.bridgePath = joinSystemPath(this.setupDirectory, "SMTCBridge.exe");
        this.sourcePath = joinSystemPath(this.setupDirectory, "SMTCBridge.cs");
        this.setupScriptPath = joinSystemPath(this.setupDirectory, "setup.ps1");

        this.initializeFromCache();
    }

    private initializeFromCache(): void {
        const cached = this.cacheManager.getMedia();
        if (cached && (cached.Title || cached.Artist)) {
            this.mediaStore.set(cached);
        }
    }

    onload(): void {
        if (!Platform.isWin) return;
        this.stopped = false;
        void this.startMonitoring();
    }

    private async loadDesktopRuntime(): Promise<DesktopRuntime> {
        if (this.runtime) return this.runtime;
        if (!this.runtimePromise) {
            this.runtimePromise = Promise.resolve().then(() => {
                const childProcess = requireDesktopModule<typeof import("child_process")>("child_process");
                const fs = requireDesktopModule<typeof import("fs")>("fs");
                const crypto = requireDesktopModule<typeof import("crypto")>("crypto");
                this.runtime = { spawn: childProcess.spawn, fs, crypto };
                return this.runtime;
            }).finally(() => {
                this.runtimePromise = null;
            });
        }
        return this.runtimePromise;
    }

    private computeHash(filePath: string): string | null {
        const runtime = this.runtime;
        if (!runtime || !runtime.fs.existsSync(filePath)) return null;
        try {
            const fileBuffer = runtime.fs.readFileSync(filePath);
            const hashSum = runtime.crypto.createHash("sha256");
            hashSum.update(fileBuffer);
            return hashSum.digest("hex").toUpperCase();
        } catch (error) {
            console.error(`[SMTC] Failed to compute hash for ${filePath}`, error);
            return null;
        }
    }

    private async verifyIntegrity(): Promise<boolean> {
        const exeHash = this.computeHash(this.bridgePath);
        const trustedHash = this.plugin.options.media.trustedExeHash;
        if (exeHash === KNOWN_EXE_HASH || (trustedHash && exeHash === trustedHash)) {
            return true;
        }

        console.warn(`[SMTC] Binary hash mismatch. Current: ${exeHash}. Verifying source...`);
        const sourceHash = this.computeHash(this.sourcePath);
        if (sourceHash !== KNOWN_CS_HASH) {
            console.error(`[SMTC] Security Violation: Source code hash mismatch! Expected ${KNOWN_CS_HASH}, got ${sourceHash}`);
            new Notice(t("notice-smtc-security-violation"));
            return false;
        }

        console.log("[SMTC] Source verified. Recompiling to ensure safety...");
        if (!(await this.runCompilation())) return false;

        const newExeHash = this.computeHash(this.bridgePath);
        if (!newExeHash) return false;
        console.log(`[SMTC] Recompiled successfully. Trusted new hash: ${newExeHash}`);
        void this.plugin.writeOptions((old) => ({
            ...old,
            media: { ...old.media, trustedExeHash: newExeHash },
        })).catch((error) => {
            console.error("[SMTC] Failed to persist trusted executable hash", error);
        });
        return true;
    }

    async ensureBridge(): Promise<boolean> {
        const runtime = await this.loadDesktopRuntime();
        if (!runtime.fs.existsSync(this.bridgePath)) {
            console.log("[SMTC] SMTCBridge.exe not found. Verifying source and compiling...");
            if (this.computeHash(this.sourcePath) !== KNOWN_CS_HASH) {
                console.error("[SMTC] Cannot compile: Source code mismatch.");
                return false;
            }
            return this.runCompilation();
        }
        return this.verifyIntegrity();
    }

    private async runCompilation(): Promise<boolean> {
        const { spawn } = await this.loadDesktopRuntime();
        console.log("[SMTC] Running setup script...");
        return new Promise((resolve) => {
            const child = spawn("powershell", [
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", this.setupScriptPath,
            ], {
                windowsHide: true,
                cwd: this.setupDirectory,
            });
            child.on("close", (code) => {
                if (code === 0) {
                    console.log("[SMTC] Compilation successful.");
                    resolve(true);
                } else {
                    console.error(`[SMTC] Compilation failed with code ${code}`);
                    resolve(false);
                }
            });
            child.on("error", (error) => {
                console.error("[SMTC] Failed to run setup script:", error);
                resolve(false);
            });
        });
    }

    async startMonitoring(resetBackoff = true): Promise<void> {
        if (!Platform.isWin) return;
        this.stopped = false;
        if (resetBackoff) this.restartDelay = INITIAL_RESTART_DELAY;
        this.clearRestartTimer();
        this.stopCurrentProcess();
        const generation = ++this.runGeneration;

        let ready: boolean;
        try {
            ready = await this.ensureBridge();
        } catch (error) {
            console.error("[SMTC] Desktop runtime initialization failed:", error);
            return;
        }
        if (!ready || this.stopped || generation !== this.runGeneration) {
            if (!ready) console.error("[SMTC] Bridge validation failed. Monitoring aborted.");
            return;
        }

        try {
            const { spawn } = await this.loadDesktopRuntime();
            if (this.stopped || generation !== this.runGeneration) return;
            console.log(`[SMTC] Starting Monitor: ${this.bridgePath}`);
            const child = spawn(this.bridgePath, ["monitor"], {
                windowsHide: true,
                stdio: ["pipe", "pipe", "pipe"],
            }) as ChildProcessWithoutNullStreams;
            this.process = child;
            let exited = false;
            const handleExit = (reason: string): void => {
                if (exited) return;
                exited = true;
                if (this.process === child) this.process = null;
                if (this.stopped || generation !== this.runGeneration) return;
                console.warn(`[SMTC] Monitor process stopped (${reason}); scheduling restart`);
                this.scheduleRestart(generation);
            };

            child.stdout.on("data", (data: Buffer) => {
                this.buffer += data.toString();
                this.processBuffer();
            });
            child.stderr.on("data", (data: Buffer) => {
                console.error(`[SMTC] Bridge Stderr: ${data.toString()}`);
            });
            child.on("close", (code) => handleExit(`exit code ${code}`));
            child.on("error", (error) => {
                console.error("[SMTC] Failed to spawn monitor:", error);
                handleExit(error.message);
            });
        } catch (error) {
            console.error("[SMTC] Error starting system monitor:", error);
            if (!this.stopped && generation === this.runGeneration) {
                this.scheduleRestart(generation);
            }
        }
    }

    private scheduleRestart(generation: number): void {
        if (this.restartTimer !== null || this.stopped || generation !== this.runGeneration) return;
        const delay = this.restartDelay;
        this.restartDelay = Math.min(this.restartDelay * 2, MAX_RESTART_DELAY);
        this.restartTimer = window.setTimeout(() => {
            this.restartTimer = null;
            if (this.stopped || generation !== this.runGeneration) return;
            void this.startMonitoring(false);
        }, delay);
    }

    private processBuffer(): void {
        let startIndex = this.buffer.indexOf(JSON_START_MARKER);
        if (startIndex === -1) {
            if (this.buffer.length > MAX_BUFFER_LENGTH) this.clearOversizedBuffer();
            return;
        }
        if (startIndex > 0) {
            this.buffer = this.buffer.substring(startIndex);
            startIndex = 0;
        }

        let endIndex = this.buffer.indexOf(
            JSON_END_MARKER,
            startIndex + JSON_START_MARKER.length
        );
        while (endIndex !== -1) {
            const payload = this.buffer.substring(JSON_START_MARKER.length, endIndex);
            this.applyPayload(payload);
            this.buffer = this.buffer.substring(endIndex + JSON_END_MARKER.length);
            startIndex = this.buffer.indexOf(JSON_START_MARKER);
            if (startIndex === -1) break;
            if (startIndex > 0) this.buffer = this.buffer.substring(startIndex);
            endIndex = this.buffer.indexOf(JSON_END_MARKER, JSON_START_MARKER.length);
        }
        if (this.buffer.length > MAX_BUFFER_LENGTH) this.clearOversizedBuffer();
    }

    private applyPayload(payload: string): void {
        try {
            this.restartDelay = INITIAL_RESTART_DELAY;
            if (payload === "null") {
                this.mediaStore.set(null);
                void this.cacheManager.updateMedia({ lastUpdate: Date.now() });
                return;
            }
            const data = JSON.parse(payload) as MediaCache;
            this.mediaStore.set(data);
            this.debouncedSave(data);
        } catch (error) {
            console.error("[SMTC] Failed to parse JSON:", error);
        }
    }

    private clearOversizedBuffer(): void {
        console.warn(`[SMTC] Buffer overflow (${this.buffer.length} chars), clearing`);
        this.buffer = "";
    }

    private debouncedSave = debounce((data: MediaCache) => {
        const cleanData: MediaCache = {
            Title: data.Title,
            Artist: data.Artist,
            AlbumTitle: data.AlbumTitle,
            Status: data.Status,
            SourceAppId: data.SourceAppId,
            Thumbnail: data.Thumbnail,
            lastUpdate: Date.now(),
        };
        void this.cacheManager.updateMedia(cleanData);
    }, 2000, true);

    stopMonitoring(): void {
        this.stopped = true;
        this.runGeneration++;
        this.clearRestartTimer();
        this.stopCurrentProcess();
        this.buffer = "";
    }

    private stopCurrentProcess(): void {
        const child = this.process;
        this.process = null;
        if (!child) return;
        try {
            if (child.stdin.writable && !child.stdin.destroyed) {
                child.stdin.write("quit\n");
            }
        } catch {
            // Ignore shutdown races.
        }
        child.kill();
    }

    private clearRestartTimer(): void {
        if (this.restartTimer !== null) {
            window.clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
    }

    controlMedia(action: "PlayPause" | "Next" | "Previous"): void {
        if (!Platform.isWin) return;
        if (!this.runtime) {
            void this.loadDesktopRuntime()
                .then(() => this.controlMedia(action))
                .catch((error) => console.error("[SMTC] Media control runtime unavailable:", error));
            return;
        }

        const cmd = action.toLowerCase();
        if (this.sendMonitorCommand(`control ${cmd}`)) return;
        console.warn("[SMTC] Monitor stdin unavailable. Falling back to one-shot control process.");
        try {
            const child = this.runtime.spawn(this.bridgePath, ["control", cmd], {
                windowsHide: true,
                stdio: ["ignore", "ignore", "pipe"],
            });
            child.stderr?.on("data", (data: Buffer) => {
                console.error(`[SMTC] Control Stderr: ${data}`);
            });
            child.on("error", (error) => {
                console.error("[SMTC] Failed to spawn control:", error);
            });
            child.on("close", () => {
                window.setTimeout(() => this.triggerImmediatePoll(), 100);
            });
        } catch (error) {
            console.error("[SMTC] Failed to control media:", error);
        }
    }

    private sendMonitorCommand(command: string): boolean {
        const stdin = this.process?.stdin;
        if (!stdin || stdin.destroyed || !stdin.writable) return false;
        try {
            stdin.write(`${command}\n`);
            return true;
        } catch (error) {
            console.error("[SMTC] Failed to write monitor command:", error);
            return false;
        }
    }

    private triggerImmediatePoll(): void {
        if (!this.runtime || this.stopped) return;
        try {
            const child = this.runtime.spawn(this.bridgePath, ["poll"], {
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
            });
            let output = "";
            child.stdout?.on("data", (data: Buffer) => {
                output += data.toString();
                if (output.length > MAX_BUFFER_LENGTH) output = "";
            });
            child.stderr?.on("data", (data: Buffer) => {
                console.error(`[SMTC] Immediate Poll Stderr: ${data.toString()}`);
            });
            child.on("close", () => {
                const startIndex = output.indexOf(JSON_START_MARKER);
                const endIndex = startIndex === -1
                    ? -1
                    : output.indexOf(JSON_END_MARKER, startIndex + JSON_START_MARKER.length);
                if (startIndex !== -1 && endIndex !== -1) {
                    this.applyPayload(output.substring(startIndex + JSON_START_MARKER.length, endIndex));
                }
            });
            child.on("error", (error) => {
                console.error("[SMTC] Failed to trigger immediate poll:", error);
            });
        } catch (error) {
            console.error("[SMTC] Failed to trigger immediate poll:", error);
        }
    }

    onunload(): void {
        this.stopMonitoring();
    }
}

export async function getActiveWindow(): Promise<Window> {
    let spawn: typeof import("child_process").spawn;
    try {
        ({ spawn } = requireDesktopModule<typeof import("child_process")>("child_process"));
    } catch (error) {
        console.error("[SMTC] Active-window runtime unavailable:", error);
        return { title: "" } as unknown as Window;
    }
    return new Promise((resolve) => {
        let settled = false;
        let titleBuffer = "";
        const resolveOnce = (title: string): void => {
            if (settled) return;
            settled = true;
            resolve({ title } as unknown as Window);
        };
        const child = spawn("powershell", [
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-Command", "Get-Process -Id $PID | Select-Object -ExpandProperty MainWindowTitle",
        ], { windowsHide: true });
        child.stdout?.on("data", (data: Buffer) => {
            titleBuffer += data.toString();
        });
        child.stderr?.on("data", (data: Buffer) => {
            console.error(`[SMTC] GetActiveWindow Stderr: ${data.toString()}`);
        });
        child.on("close", (code) => {
            if (code !== 0) console.error(`[SMTC] GetActiveWindow failed with code ${code}`);
            resolveOnce(titleBuffer.trim());
        });
        child.on("error", (error) => {
            console.error("[SMTC] Failed to run GetActiveWindow:", error);
            resolveOnce("");
        });
    });
}
