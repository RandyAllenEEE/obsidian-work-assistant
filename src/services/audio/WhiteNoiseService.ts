import { Component } from 'obsidian';
import type CalendarPlugin from '../../main';

export interface ISmtcPlayer {
    setPlaybackState(state: 'playing' | 'paused' | 'none'): void;
}

export class WhiteNoiseService extends Component {
    plugin: CalendarPlugin;
    private audio: HTMLAudioElement;
    private isPlaying = false;
    private currentUrl = '';

    private smtc: ISmtcPlayer | null = null;

    constructor(plugin: CalendarPlugin) {
        super();
        this.plugin = plugin;
    }

    setSMTC(smtc: ISmtcPlayer | null): void {
        this.smtc = smtc;
    }

    initialize(url: string): void {
        if (this.audio) return;

        this.currentUrl = url;
        this.audio = new Audio(url);
        this.audio.loop = true;

        // Ensure we handle errors (like invalid URLs)
        this.audio.onerror = (e) => {
            console.error("White Noise Audio Error:", e);
        };
    }

    setUrl(url: string): void {
        if (this.currentUrl === url) return;

        const wasPlaying = this.isPlaying;
        this.stop();
        this.currentUrl = url;
        // Reuse existing Audio element and just update the src to avoid orphaning the old element
        if (this.audio) {
            this.audio.src = url;
            this.audio.loop = true;
        } else {
            this.audio = new Audio(url);
            this.audio.loop = true;
        }

        if (wasPlaying) {
            this.play();
        }
    }

    play(): void {
        if (!this.audio) return;

        this.audio.play().then(() => {
            this.isPlaying = true;
            if (this.smtc) this.smtc.setPlaybackState('playing');
        }).catch(err => {
            console.error("Failed to play white noise:", err);
        });
    }

    pause(): void {
        if (!this.audio) return;

        this.audio.pause();
        this.isPlaying = false;
        if (this.smtc) this.smtc.setPlaybackState('paused');
    }

    stop(): void {
        if (!this.audio) return;

        this.audio.pause();
        this.audio.currentTime = 0;
        this.isPlaying = false;
        if (this.smtc) this.smtc.setPlaybackState('none');
    }

    getIsPlaying(): boolean {
        return this.isPlaying;
    }

    private async decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
        const audioContext = new AudioContext();
        return await audioContext.decodeAudioData(arrayBuffer);
    }

    onunload(): void {
        this.stop();
        this.audio = null as any;
    }
}
