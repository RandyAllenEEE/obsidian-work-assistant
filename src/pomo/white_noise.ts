import CalendarPlugin from '../main';
import { Mode } from './timer'

export class WhiteNoise {
	plugin: CalendarPlugin;
	whiteNoisePlayer: HTMLAudioElement;

	constructor(plugin: CalendarPlugin, whiteNoiseUrl: string) {
		this.plugin = plugin;
		this.whiteNoisePlayer = new Audio(whiteNoiseUrl);
		this.whiteNoisePlayer.loop = true;
	}

	stopWhiteNoise() {
		this.whiteNoisePlayer.pause();
		this.whiteNoisePlayer.currentTime = 0;
	}

	whiteNoise() {
		if (this.plugin.timer.mode === Mode.Pomo && this.plugin.timer.paused === false) {
			this.whiteNoisePlayer.play();
		} else {
			this.stopWhiteNoise();
		}
	}
}
