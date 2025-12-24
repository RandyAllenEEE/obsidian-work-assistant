import { Notice, moment } from 'obsidian';
import { notificationUrl } from './audio_urls';
import { WhiteNoiseService } from '../services/audio/WhiteNoiseService';
import type CalendarPlugin from '../main'; // Import type to avoid circular dependency issues at runtime if possible, or just import class

import { t } from '../i18n';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const electron = require("electron");

const MILLISECS_IN_MINUTE = 60 * 1000;

export const enum Mode {
    Pomo,
    ShortBreak,
    LongBreak,
    NoTimer
}

export class Timer {
    plugin: CalendarPlugin;
    startTime: moment.Moment; /*when currently running timer started*/
    endTime: moment.Moment;   /*when currently running timer will end if not paused*/
    mode: Mode;
    pausedTime: number;  /*time left on paused timer, in milliseconds*/
    paused: boolean;
    autoPaused: boolean;
    pomosSinceStart: number;
    cyclesSinceLastAutoStop: number;
    whiteNoiseService: WhiteNoiseService;

    constructor(plugin: CalendarPlugin) {
        this.plugin = plugin;
        this.mode = Mode.NoTimer;
        this.paused = false;
        this.pomosSinceStart = 0;
        this.cyclesSinceLastAutoStop = 0;

        // Initialize WhiteNoiseService
        this.whiteNoiseService = new WhiteNoiseService(plugin);
        plugin.addChild(this.whiteNoiseService); // Register lifecycle

        if (this.plugin.options?.whiteNoise === true) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { whiteNoiseUrl } = require('./audio_urls');
            const url = this.plugin.options.pomoBackgroundNoiseFile || whiteNoiseUrl;
            this.whiteNoiseService.initialize(url);
        }
    }

    // Initialize white noise player properly if needed
    initWhiteNoise() {
        if (this.plugin.options?.whiteNoise === true) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { whiteNoiseUrl } = require('./audio_urls');
            const url = this.plugin.options.pomoBackgroundNoiseFile || whiteNoiseUrl;
            this.whiteNoiseService.initialize(url);
        }
    }

    /*Set status bar to remaining time or empty string if no timer is running*/
    async setStatusBarText(): Promise<string> {
        let timer_type_symbol = "🏖️ ";
        if (this.mode === Mode.Pomo || this.mode === Mode.NoTimer) {
            timer_type_symbol = "🍅 ";
        }

        if (this.mode !== Mode.NoTimer) {
            if (this.paused === true) {
                return timer_type_symbol + millisecsToString(this.pausedTime); //just show the paused time
            } else if (window.moment().isSameOrAfter(this.endTime)) {
                await this.handleTimerEnd();
            }

            return timer_type_symbol + millisecsToString(this.getCountdown()); //return display value
        } else {
            return timer_type_symbol.trim(); // Show only the icon when idle
        }
    }

    async handleTimerEnd() {
        if (this.mode === Mode.Pomo) { //completed another pomo
            this.pomosSinceStart += 1;

            if (this.plugin.wordCountStats) {
                this.plugin.wordCountStats.incrementPomoCount(window.moment().format('YYYY-MM-DD'));
            }
        } else if (this.mode === Mode.ShortBreak || this.mode === Mode.LongBreak) {
            this.cyclesSinceLastAutoStop += 1;
        }

        if (this.plugin.options.notificationSound === true) { //play sound end of timer
            playNotification();
        }
        if (this.plugin.options.useSystemNotification === true) { //show system notification end of timer
            showSystemNotification(this.mode);
        }

        const autostart = this.plugin.options.continuousMode === true;
        const numAutoCycles = this.plugin.options.numAutoCycles || 0;

        if (autostart === false && numAutoCycles <= this.cyclesSinceLastAutoStop) {
            this.setupTimer();
            this.autoPaused = true;
            this.paused = true;
            this.pausedTime = this.getTotalModeMillisecs();
            this.cyclesSinceLastAutoStop = 0;
        } else {
            this.startTimer();
        }
    }

    async quitTimer(): Promise<void> {
        this.mode = Mode.NoTimer;
        this.startTime = window.moment(0);
        this.endTime = window.moment(0);
        this.paused = false;
        this.pomosSinceStart = 0;

        if (this.plugin.options.whiteNoise === true) {
            this.whiteNoiseService.stop();
        }
    }

    pauseTimer(): void {
        this.paused = true;
        this.pausedTime = this.getCountdown();

        if (this.plugin.options.whiteNoise === true) {
            this.whiteNoiseService.stop(); // or pause() if we want it to resume
        }
    }

    togglePause() {
        if (this.paused === true) {
            this.restartTimer();
        } else if (this.mode !== Mode.NoTimer) { //if some timer running
            this.pauseTimer();
            new Notice(t("pomo-notice-paused"));
        }
    }

    restartTimer(): void {

        this.setStartAndEndTime(this.pausedTime);
        this.modeRestartingNotification();
        this.paused = false;

        if (this.plugin.options.whiteNoise === true) {
            this.initWhiteNoise();
            this.whiteNoiseService.play();
        }
    }

    startTimer(mode: Mode = null): void {
        this.setupTimer(mode);
        this.paused = false;

        this.modeStartingNotification();

        if (this.plugin.options.whiteNoise === true) {
            this.initWhiteNoise(); // Ensure URL is latest
            this.whiteNoiseService.play();
        }
    }

    private setupTimer(mode: Mode = null) {
        if (mode === null) { //no arg -> start next mode in cycle
            if (this.mode === Mode.Pomo) {
                if (this.pomosSinceStart % this.plugin.options.longBreakInterval === 0) {
                    this.mode = Mode.LongBreak;
                } else {
                    this.mode = Mode.ShortBreak;
                }
            } else { //short break, long break, or no timer
                this.mode = Mode.Pomo;
            }
        } else { //starting a specific mode passed to func
            this.mode = mode;
        }

        this.setStartAndEndTime(this.getTotalModeMillisecs());
    }

    setStartAndEndTime(millisecsLeft: number): void {
        this.startTime = window.moment(); //start time to current time
        this.endTime = window.moment().add(millisecsLeft, 'milliseconds');
    }

    /*Return milliseconds left until end of timer*/
    getCountdown(): number {
        const endTimeClone = this.endTime.clone();
        return endTimeClone.diff(window.moment());
    }

    getTotalModeMillisecs(): number {
        switch (this.mode) {
            case Mode.Pomo: {
                return this.plugin.options.pomo * MILLISECS_IN_MINUTE;
            }
            case Mode.ShortBreak: {
                return this.plugin.options.shortBreak * MILLISECS_IN_MINUTE;
            }
            case Mode.LongBreak: {
                return this.plugin.options.longBreak * MILLISECS_IN_MINUTE;
            }
            case Mode.NoTimer: {
                throw new Error("Mode NoTimer does not have an associated time value");
            }
        }
    }

    /**************  Notifications  **************/
    /*Sends notification corresponding to whatever the mode is at the moment it's called*/
    modeStartingNotification(): void {
        let time = this.getTotalModeMillisecs();
        let unit: string;

        if (time >= MILLISECS_IN_MINUTE) { /*display in minutes*/
            time = Math.floor(time / MILLISECS_IN_MINUTE);
            unit = time === 1 ? t("pomo-unit-minute") : t("pomo-unit-minute-plural");
        } else { /*less than a minute, display in seconds*/
            time = Math.floor(time / 1000); //convert to secs
            unit = time === 1 ? t("pomo-unit-second") : t("pomo-unit-second-plural");
        }

        const modeStr = this.mode === Mode.Pomo ? t("pomo-mode-work") : t("pomo-mode-break");

        switch (this.mode) {
            case (Mode.Pomo):
            case (Mode.ShortBreak):
            case (Mode.LongBreak): {
                new Notice(t("pomo-notice-start")
                    .replace("{time}", time.toString())
                    .replace("{unit}", unit)
                    .replace("{mode}", modeStr));
                break;
            }
            case (Mode.NoTimer): {
                new Notice(t("pomo-notice-quit"));
                break;
            }
        }
    }

    modeRestartingNotification(): void {
        const modeStr = this.mode === Mode.Pomo ? t("pomo-mode-work") : t("pomo-mode-break");
        switch (this.mode) {
            case (Mode.Pomo):
            case (Mode.ShortBreak):
            case (Mode.LongBreak): {
                new Notice(t("pomo-notice-restart").replace("{mode}", modeStr));
                break;
            }
        }
    }




}

function millisecsToString(millisecs: number): string {
    let formattedCountDown: string;

    if (millisecs >= 60 * 60 * 1000) { /* >= 1 hour*/
        formattedCountDown = window.moment.utc(millisecs).format('HH:mm:ss');
    } else {
        formattedCountDown = window.moment.utc(millisecs).format('mm:ss');
    }

    return formattedCountDown.toString();
}

function playNotification(): void {
    const audio = new Audio(notificationUrl);
    audio.play();
}

import { sendSystemNotification } from "../utils/notifications";

function showSystemNotification(mode: Mode): void {
    let text = "";
    const emojiStr = " 🍅";
    const breakEmojiStr = " 🏖";

    switch (mode) {
        case (Mode.Pomo): {
            text = t("pomo-sys-notif-pomo-end").replace("{emoji}", breakEmojiStr);
            break;
        }
        case (Mode.ShortBreak):
        case (Mode.LongBreak): {
            text = t("pomo-sys-notif-break-end").replace("{emoji}", emojiStr);
            break;
        }
        case (Mode.NoTimer): {
            // no system notification needed
            return;
        }
    }
    const title = t("pomo-sys-notif-title").replace("{emoji}", emojiStr);

    sendSystemNotification(title, text, true);
}
