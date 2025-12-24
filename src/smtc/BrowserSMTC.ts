import { Component } from 'obsidian';
import { WhiteNoiseService } from '../services/audio/WhiteNoiseService';

export class BrowserSMTC extends Component {
    private service: WhiteNoiseService;
    private title = "White Noise";
    private artist = "Obsidian Work Assistant";

    constructor(service: WhiteNoiseService) {
        super();
        this.service = service;
    }

    onload(): void {
        if ('mediaSession' in navigator) {
            this.updateMetadata();
            this.setHandlers();
        }
    }

    updateMetadata(): void {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.metadata = new MediaMetadata({
            title: this.title,
            artist: this.artist,
            // artwork: [] // We could add an icon here
        });
    }

    setPlaybackState(state: 'playing' | 'paused' | 'none'): void {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = state;
    }

    private setHandlers() {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.setActionHandler('play', () => {
            this.service.play();
            this.setPlaybackState('playing');
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            this.service.pause();
            this.setPlaybackState('paused');
        });

        navigator.mediaSession.setActionHandler('stop', () => {
            this.service.stop();
            this.setPlaybackState('none');
        });
    }

    onunload(): void {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', null);
            navigator.mediaSession.setActionHandler('pause', null);
            navigator.mediaSession.setActionHandler('stop', null);
            navigator.mediaSession.playbackState = 'none';
        }
    }
}
