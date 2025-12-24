import { setIcon } from "obsidian";
import type { SystemMediaMonitor } from "../smtc/SystemMediaMonitor";

export class StatusBarPlayer {
    private container: HTMLElement;
    private monitor: SystemMediaMonitor;
    private playButton: HTMLElement;
    private prevButton: HTMLElement;
    private nextButton: HTMLElement;
    private popover: HTMLElement | null = null;
    private currentMedia: any = null;
    private unsubscribe: () => void;

    constructor(container: HTMLElement, monitor: SystemMediaMonitor) {
        this.container = container;
        this.monitor = monitor;
        this.container.addClass("smtc-status-bar");

        // Initialize Visibility: Show as "Searching" or similar if monitor is active but no data yet
        this.container.style.display = 'flex';
        this.render();

        // Subscribe to store
        this.unsubscribe = this.monitor.mediaStore.subscribe((media) => {
            this.currentMedia = media;
            this.update(media);
        });
    }

    public destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        this.container.empty();
    }

    private render() {
        this.container.empty();

        // Previous Button
        this.prevButton = this.container.createDiv({ cls: "smtc-control" });
        setIcon(this.prevButton, "skip-back");
        this.prevButton.onclick = (e) => {
            e.stopPropagation();
            this.monitor.controlMedia("Previous");
        };

        // Play/Pause Button
        this.playButton = this.container.createDiv({ cls: "smtc-control" });
        setIcon(this.playButton, "play");
        this.playButton.onclick = (e) => {
            e.stopPropagation();
            this.monitor.controlMedia("PlayPause");
        };

        // Next Button
        this.nextButton = this.container.createDiv({ cls: "smtc-control" });
        setIcon(this.nextButton, "skip-forward");
        this.nextButton.onclick = (e) => {
            e.stopPropagation();
            this.monitor.controlMedia("Next");
        };

        // Hover events
        this.container.onmouseenter = () => this.showPopover();
        this.container.onmouseleave = () => this.hidePopover();
    }

    private update(media: any) {
        if (!media || media.Status === 'Closed' || media.Status === 'Stopped') {
            this.container.style.display = 'flex';
            this.container.style.opacity = '0.5';
            this.container.style.pointerEvents = 'auto';
            if (this.popover) this.hidePopover();

            setIcon(this.playButton, "play");
            return;
        }

        this.container.style.display = 'flex';
        this.container.style.opacity = '1';
        this.container.style.pointerEvents = 'auto';

        const isPlaying = media.Status === 'Playing';
        setIcon(this.playButton, isPlaying ? "pause" : "play");

        if (this.popover) {
            this.showPopover(); // Re-render content
        }
    }

    private showPopover() {
        if (!this.currentMedia) return;

        if (this.popover) this.popover.remove();

        this.popover = document.body.createDiv({ cls: "smtc-popover" });

        // Calculate Position
        const rect = this.container.getBoundingClientRect();
        this.popover.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        this.popover.style.left = `${rect.left + (rect.width / 2) - 100}px`;

        // Album Art
        if (this.currentMedia.Thumbnail) {
            const img = this.popover.createEl('img');
            img.src = this.currentMedia.Thumbnail;
        }

        // Info
        const info = this.popover.createDiv({ cls: "smtc-info" });
        info.createDiv({ cls: "smtc-title", text: this.currentMedia.Title });
        info.createDiv({ cls: "smtc-artist", text: this.currentMedia.Artist });
    }

    private hidePopover() {
        if (this.popover) {
            this.popover.remove();
            this.popover = null;
        }
    }
}
