import { Plugin, MarkdownView, debounce, TFile } from 'obsidian';
import type { Debouncer } from 'obsidian';
import type { Moment } from "moment";

interface WordCount {
	initial: number;
	current: number;
}

interface DailyStatsSettings {
	dayCounts: Record<string, number>;
	todaysWordCount: Record<string, WordCount>;
}

const DEFAULT_SETTINGS: DailyStatsSettings = {
	dayCounts: {},
	todaysWordCount: {}
}

export default class WordCountStats {
	settings: DailyStatsSettings;
	currentWordCount: number;
	today: string;
	debouncedUpdate: Debouncer<[string, string], void>;
	plugin: Plugin;

	// Cache for file word counts to improve performance
	private wordCountCache: Map<string, { contentHash: string; wordCount: number; timestamp: number }> = new Map();
	// Simple hash function for content comparison
	private simpleHash(str: string): string {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return hash.toString();
	}

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		this.initialize();
	}

	async initialize(): Promise<void> {
		await this.loadSettings();

		this.updateDate();
		if (Object.prototype.hasOwnProperty.call(this.settings.dayCounts, this.today)) {
			this.updateCounts();
		} else {
			this.currentWordCount = 0;
		}

		this.debouncedUpdate = debounce((contents: string, filepath: string) => {
			this.updateWordCount(contents, filepath);
		}, 400, false);

		// Register events
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("quick-preview", this.onQuickPreview.bind(this))
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on("modify", async (file: TFile) => {
				// Only process markdown files
				if (file instanceof TFile && file.extension === "md") {
					// We need to read the file content to update the word count
					const contents = await this.plugin.app.vault.read(file);
					this.debouncedUpdate(contents, file.path);
				}
			})
		);

		// Save settings periodically (every 30 seconds)
		this.plugin.registerInterval(window.setInterval(() => {
			this.updateDate();
			this.saveSettings();
		}, 30000)); // Save every 30 seconds
	}

	onQuickPreview(file: TFile, contents: string): void {
		// Only process daily note files to avoid unnecessary computation
		const date = this.getDateFromFile(file, "day");
		if (date && this.plugin.app.workspace.getActiveViewOfType(MarkdownView)) {
			this.debouncedUpdate(contents, file.path);
		}
	}

	// Helper method to extract date from file (similar to obsidian-daily-notes-interface)
	private getDateFromFile(file: TFile, _mode: "day" | "week" | "month"): moment.Moment | null {
		try {
			// This is a simplified version - in a real implementation, you'd use the actual 
			// obsidian-daily-notes-interface functions
			const moment = window.moment;
			// Try to parse the filename as a date
			const dailyNoteFormat = "YYYY-MM-DD"; // Default format, should match user settings
			const date = moment(file.basename, dailyNoteFormat, true);
			if (date.isValid()) {
				return date;
			}
			return null;
		} catch (e) {
			return null;
		}
	}

	//Credit: better-word-count by Luke Leppan (https://github.com/lukeleppan/better-word-count)
	getWordCount(text: string): number {
		let words = 0;

		const matches = text.match(
			/[a-zA-Z0-9_\u0392-\u03c9\u00c0-\u00ff\u0600-\u06ff]+|[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\uac00-\ud7af]+/gm
		);

		if (matches) {
			for (let i = 0; i < matches.length; i++) {
				if (matches[i].charCodeAt(0) > 19968) {
					words += matches[i].length;
				} else {
					words += 1;
				}
			}
		}

		return words;
	}

	updateWordCount(contents: string, filepath: string): void {
		// Use cache to avoid recalculating word count for unchanged content
		const contentHash = this.simpleHash(contents);
		const cached = this.wordCountCache.get(filepath);

		let curr: number;
		if (cached && cached.contentHash === contentHash && cached.timestamp > Date.now() - 60000) { // Cache for 1 minute
			// Use cached word count if content hasn't changed
			curr = cached.wordCount;
		} else {
			// Calculate new word count and update cache
			curr = this.getWordCount(contents);
			this.wordCountCache.set(filepath, {
				contentHash,
				wordCount: curr,
				timestamp: Date.now()
			});
		}

		if (Object.prototype.hasOwnProperty.call(this.settings.dayCounts, this.today)) {
			if (Object.prototype.hasOwnProperty.call(this.settings.todaysWordCount, filepath)) {//updating existing file
				this.settings.todaysWordCount[filepath].current = curr;
			} else {//created new file during session
				this.settings.todaysWordCount[filepath] = { initial: curr, current: curr };
			}
		} else {//new day, flush the cache
			this.settings.todaysWordCount = {};
			this.settings.todaysWordCount[filepath] = { initial: curr, current: curr };
			// Clear cache on new day since old files are no longer relevant
			this.wordCountCache.clear();
		}
		this.updateCounts();
	}

	updateDate(): void {
		const newToday = window.moment().format("YYYY/M/D");
		// If date has changed, clear the cache for better performance
		if (newToday !== this.today) {
			this.wordCountCache.clear();
		}
		this.today = newToday;
	}

	updateCounts(): void {
		this.currentWordCount = Object.values(this.settings.todaysWordCount).map((wordCount) => Math.max(0, wordCount.current - wordCount.initial)).reduce((a, b) => a + b, 0);
		this.settings.dayCounts[this.today] = this.currentWordCount;
	}

	async loadSettings(): Promise<void> {
		// Load from separate word count data file
		try {
			// Attempt to load existing data
			const data = await this.plugin.app.vault.adapter.read(".obsidian/plugins/work-assistant/word-count-data.json");
			if (data) {
				const parsedData = JSON.parse(data);
				this.settings = Object.assign({}, DEFAULT_SETTINGS, parsedData);
			} else {
				this.settings = Object.assign({}, DEFAULT_SETTINGS);
			}
		} catch (e) {
			console.log("Failed to load word count data, using defaults");
			this.settings = Object.assign({}, DEFAULT_SETTINGS);
		}
	}

	async saveSettings(): Promise<void> {
		if (Object.keys(this.settings.dayCounts).length > 0) { //ensuring we never reset the data by accident
			// Save to separate word count data file
			const dataPath = ".obsidian/plugins/work-assistant/word-count-data.json";
			try {
				// Create backup of existing data before writing new data
				const backupPath = ".obsidian/plugins/work-assistant/word-count-data-backup.json";
				if (await this.plugin.app.vault.adapter.exists(dataPath)) {
					const existingData = await this.plugin.app.vault.adapter.read(dataPath);
					await this.plugin.app.vault.adapter.write(backupPath, existingData);
				}

				// Write new data
				await this.plugin.app.vault.adapter.write(dataPath, JSON.stringify(this.settings));

				// If successful, remove backup
				if (await this.plugin.app.vault.adapter.exists(backupPath)) {
					await this.plugin.app.vault.adapter.remove(backupPath);
				}
			} catch (error) {
				console.error("Failed to save word count data, keeping backup:", error);
				// Don't throw the error as it would break the plugin
			}
		}
	}

	// Get word count for a specific date
	getWordCountForDate(dateStr: string): number {
		return this.settings.dayCounts[dateStr] || 0;
	}

	getWeeklyWordCount(date: Moment): number {
		// Clone to avoid modifying the original date
		// Start from the beginning of the week
		const startOfWeek = date.clone().startOf('week');
		let total = 0;

		// Iterate through 7 days
		for (let i = 0; i < 7; i++) {
			const currentDay = startOfWeek.clone().add(i, 'days');
			const dateStr = currentDay.format("YYYY/M/D");
			const count = this.getWordCountForDate(dateStr);
			total += count;
		}

		return total;
	}

	// Get all word count data
	getAllWordCountData(): Record<string, number> {
		return this.settings.dayCounts;
	}
}