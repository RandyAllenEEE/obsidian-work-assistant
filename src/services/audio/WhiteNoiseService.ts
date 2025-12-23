import { Component } from 'obsidian';
import type CalendarPlugin from '../../main';

export class WhiteNoiseService extends Component {
    plugin: CalendarPlugin;
    private audio: HTMLAudioElement;
    private isPlaying = false;
    private currentUrl = '';

    private smtc: any; // Type 'BrowserSMTC' to be defined or keep loose for now to avoid circular deps if they exist, but better to use interface.

    constructor(plugin: CalendarPlugin) {
        super();
        this.plugin = plugin;
    }

    setSMTC(smtc: any) {
        this.smtc = smtc;
    }

    initialize(url: string) {
        if (this.audio) return;

        this.currentUrl = url;
        this.audio = new Audio(url);
        this.audio.loop = true;

        // Ensure we handle errors (like invalid URLs)
        this.audio.onerror = (e) => {
            console.error("White Noise Audio Error:", e);
        };
    }

    setUrl(url: string) {
        if (this.currentUrl === url) return;

        const wasPlaying = this.isPlaying;
        this.stop();
        this.currentUrl = url;
        this.audio = new Audio(url);
        this.audio.loop = true;

        if (wasPlaying) {
            this.play();
        }
    }

    play() {
        if (!this.audio) return;

        this.audio.play().then(() => {
            this.isPlaying = true;
            if (this.smtc) this.smtc.setPlaybackState('playing');
        }).catch(err => {
            console.error("Failed to play white noise:", err);
        });
    }

    pause() {
        if (!this.audio) return;

        this.audio.pause();
        this.isPlaying = false;
        if (this.smtc) this.smtc.setPlaybackState('paused');
    }

    stop() {
        if (!this.audio) return;

        this.audio.pause();
        this.audio.currentTime = 0;
        this.isPlaying = false;
        if (this.smtc) this.smtc.setPlaybackState('none');
    }

    getIsPlaying(): boolean {
        return this.isPlaying;
    }

    onunload() {
        this.stop();
        this.audio = null;
    }
}
