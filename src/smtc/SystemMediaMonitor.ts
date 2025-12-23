import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { writable, type Writable } from 'svelte/store';
import { Component, Platform } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';

interface MediaInfo {
    Title: string;
    Artist: string;
    AlbumTitle: string;
    Status: 'Closed' | 'Opened' | 'Changing' | 'Stopped' | 'Playing' | 'Paused';
    SourceAppId: string;
    Thumbnail: string; // Base64 encoded image or empty
}

export class SystemMediaMonitor extends Component {
    private process: ChildProcessWithoutNullStreams | null = null;
    public mediaStore: Writable<MediaInfo | null> = writable(null);
    private buffer = '';
    private bridgePath: string;
    private setupScriptPath: string;

    constructor(pluginPath: string) {
        super();
        this.bridgePath = path.join(pluginPath, 'bin', 'SMTCBridge.exe');
        this.setupScriptPath = path.join(pluginPath, 'bin', 'setup.ps1');
    }

    onload() {
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

    async startMonitoring() {
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
                    this.mediaStore.set(null);
                } else {
                    const data = JSON.parse(jsonStr);
                    this.mediaStore.set(data);
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

    stopMonitoring() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }

    controlMedia(action: 'PlayPause' | 'Next' | 'Previous') {
        if (!Platform.isWin) return;

        // Map string actions to bridge commands if necessary
        // Bridge supports: playpause, next, previous (case insensitive)
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

    onunload() {
        this.stopMonitoring();
    }
}
