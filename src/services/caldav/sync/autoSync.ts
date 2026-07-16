interface SchedulerTimers {
	setInterval: typeof window.setInterval;
	clearInterval: typeof window.clearInterval;
}

export class AutoSyncScheduler {
	private intervalId: number | null = null;
	private syncFn: () => Promise<void>;
	private registerInterval: (id: number) => void;
	private timers: SchedulerTimers;
	private running = false;
	private queued = false;

	constructor(
		syncFn: () => Promise<void>,
		registerInterval: (id: number) => void,
		timers: SchedulerTimers = {
			setInterval: window.setInterval.bind(window),
			clearInterval: window.clearInterval.bind(window),
		},
	) {
		this.syncFn = syncFn;
		this.registerInterval = registerInterval;
		this.timers = timers;
	}

	start(intervalMinutes: number): void {
		this.stop();
		if (intervalMinutes <= 0) return;
		const ms = intervalMinutes * 60 * 1000;
		this.intervalId = this.timers.setInterval(() => {
			void this.runOnce();
		}, ms);
		this.registerInterval(this.intervalId);
	}

	stop(): void {
		if (this.intervalId !== null) {
			this.timers.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	isRunning(): boolean {
		return this.intervalId !== null;
	}

	private async runOnce(): Promise<void> {
		if (this.running) {
			this.queued = true;
			return;
		}
		this.running = true;
		try {
			do {
				this.queued = false;
				await this.syncFn();
			} while (this.queued && this.intervalId !== null);
		} catch (error) {
			console.error('Auto-sync failed:', error);
		} finally {
			this.running = false;
		}
	}
}
