import { Plugin, MarkdownView, debounce, TFile, Component, App } from 'obsidian';
import type { Debouncer } from 'obsidian';
import type { Moment } from "moment";
import { t } from "./i18n";
import { WORKER_CODE } from "./workers/worker";

interface WordCount {
	initial: number;
	current: number;
}

interface DailyStatsSettings {
	dayCounts: Record<string, number>;
	todaysWordCount: Record<string, WordCount>;
	pomoCounts: Record<string, number>;
}

const DEFAULT_SETTINGS: DailyStatsSettings = {
	dayCounts: {},
	todaysWordCount: {},
	pomoCounts: {}
}

export default class WordCountStats extends Component {
	settings: DailyStatsSettings;
	currentWordCount: number;
	today: string;
	debouncedUpdate: Debouncer<[string, string], void>;
	plugin: Plugin;
	app: App;
	statusBarEl: HTMLElement | null = null;

	// Worker related
	private worker: Worker | null = null;
	private lastNonce = 0;
	private nonces = new Map<string, number>();
	private pendingHashes = new Map<number, string>();

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

	constructor(plugin: Plugin, app: App) {
		super();
		this.plugin = plugin;
		this.app = app;
	}

	onload(): void {
		this.initialize();
	}

	onunload(): void {
		if (this.statusBarEl) {
			this.statusBarEl.remove();
			this.statusBarEl = null;
		}
		this.terminateWorker();
	}

	private initWorker(): void {
		if (this.worker) return;
		try {
			const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
			const url = URL.createObjectURL(blob);
			this.worker = new Worker(url);

			this.worker.onmessage = (e: MessageEvent) => {
				const { id, count } = e.data;
				this.handleWorkerMessage(id, count);
			};

			// Clean up the URL object
			URL.revokeObjectURL(url);
			console.log("[Work Assistant] Word Count Worker initialized");
		} catch (e) {
			console.error("[Work Assistant] Failed to initialize worker, falling back to main thread:", e);
		}
	}

	private terminateWorker(): void {
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
	}

	private handleWorkerMessage(nonce: number, count: number): void {
		// Find which file this nonce belongs to
		// This is O(N) but map size is small (number of active files being edited concurrently)
		for (const [filepath, storedNonce] of this.nonces.entries()) {
			if (storedNonce === nonce) {
				// Found the matching request
				this.updateStore(filepath, count);
				break;
			}
		}
	}

	async initialize(): Promise<void> {
		await this.loadSettings();

		this.updateDate();
		if (Object.prototype.hasOwnProperty.call(this.settings.dayCounts, this.today)) {
			this.updateCounts();
		} else {
			this.currentWordCount = 0;
		}

		// Initialize Worker if enabled
		this.initWorker();

		this.debouncedUpdate = debounce((contents: string, filepath: string) => {
			this.updateWordCount(contents, filepath);
		}, 400, false);

		// Register events
		this.registerEvent(
			this.app.workspace.on("quick-preview", this.onQuickPreview.bind(this))
		);

		this.registerEvent(
			this.app.vault.on("modify", async (file: TFile) => {
				// Only process markdown files
				if (file instanceof TFile && file.extension === "md") {
					// We need to read the file content to update the word count
					const contents = await this.app.vault.read(file);
					this.debouncedUpdate(contents, file.path);
				}
			})
		);

		// Save settings periodically (every 30 seconds)
		this.registerInterval(window.setInterval(() => {
			this.updateDate();
			this.saveSettings();
		}, 30000)); // Save every 30 seconds


		// Initialize status bar based on initial state? We'll let main.ts call updateStatusBar.
		// this.statusBarEl = this.plugin.addStatusBarItem();
		this.registerStatusBarUpdates();
	}

	private updateStore(filepath: string, count: number): void {
		// Handle cache update if coming from worker
		// If we are here, we have a count.

		// If coming from worker, we might have a pending hash
		const nonce = this.nonces.get(filepath);
		if (nonce && this.pendingHashes.has(nonce)) {
			const hash = this.pendingHashes.get(nonce);
			this.wordCountCache.set(filepath, {
				contentHash: hash || "",
				wordCount: count,
				timestamp: Date.now()
			});
			this.pendingHashes.delete(nonce);
		}

		if (Object.prototype.hasOwnProperty.call(this.settings.dayCounts, this.today)) {
			if (Object.prototype.hasOwnProperty.call(this.settings.todaysWordCount, filepath)) {//updating existing file
				this.settings.todaysWordCount[filepath].current = count;
			} else {//created new file during session
				this.settings.todaysWordCount[filepath] = { initial: count, current: count };
			}
		} else {//new day, flush the cache
			this.settings.todaysWordCount = {};
			this.settings.todaysWordCount[filepath] = { initial: count, current: count };
			// Clear cache on new day since old files are no longer relevant
			this.wordCountCache.clear();
		}
		this.updateCounts();
	}

	public updateStatusBar(enabled: boolean): void {
		if (enabled) {
			if (!this.statusBarEl) {
				this.statusBarEl = this.plugin.addStatusBarItem();
			}
		} else {
			if (this.statusBarEl) {
				this.statusBarEl.remove();
				this.statusBarEl = null;
			}
		}
	}

	private getObsidianLanguage(): "zh-cn" | "en" {
		const momentLang = window.moment.locale();
		if (momentLang.startsWith('zh')) {
			return 'zh-cn';
		}
		return 'en';
	}

	registerStatusBarUpdates(): void {
		// Update when active leaf changes (to show file-specific counts)
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.refreshStatusBar();
			})
		);

		// Update when editor changes (live counting)
		// Note: We leverage the existing debouncedUpdate for the heavy lifting
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, view) => {
				if (view instanceof MarkdownView && view.file) {
					const content = editor.getValue();
					this.debouncedUpdate(content, view.file.path);
				}
			})
		);
	}

	refreshStatusBar(): void {
		if (!this.statusBarEl) return;

		const lang = this.getObsidianLanguage();
		const currentWordCount = this.currentWordCount || 0;

		let text = t('status-bar-words-today', lang).replace('{count}', currentWordCount.toString());

		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.extension === 'md') {
			const fileChange = this.getFileCountChange(activeFile.path);
			const detailText = t('status-bar-words-today-detail', lang)
				.replace('{file}', fileChange.toString())
				.replace('{total}', currentWordCount.toString());

			if (detailText !== 'status-bar-words-today-detail') {
				text = detailText;
			}
		}

		this.statusBarEl.setText(text);
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

	updateWordCount(contents: string, filepath: string): void {
		// Use cache to avoid recalculating word count for unchanged content
		const contentHash = this.simpleHash(contents);
		const cached = this.wordCountCache.get(filepath);

		// Optimization: Check cache FIRST on main thread. 
		if (cached && cached.contentHash === contentHash && cached.timestamp > Date.now() - 60000) { // Cache for 1 minute
			// Use cached word count if content hasn't changed
			this.updateStore(filepath, cached.wordCount);
			return;
		}

		// Not cached or stale. Send to worker.
		if (this.worker) {
			const nonce = ++this.lastNonce;
			this.nonces.set(filepath, nonce);
			this.pendingHashes.set(nonce, contentHash);
			this.worker.postMessage({ id: nonce, text: contents });
		} else {
			console.warn("[Work Assistant] Worker not initialized, skipping word count update.");
		}
	}

	updateDate(): void {
		const newToday = window.moment().format("YYYY-MM-DD");
		// If date has changed, clear the cache for better performance
		if (newToday !== this.today) {
			this.wordCountCache.clear();
		}
		this.today = newToday;
	}

	updateCounts(): void {
		this.currentWordCount = Object.values(this.settings.todaysWordCount).map((wordCount) => Math.max(0, wordCount.current - wordCount.initial)).reduce((a, b) => a + b, 0);
		this.settings.dayCounts[this.today] = this.currentWordCount;
		this.refreshStatusBar();
	}

	incrementPomoCount(date: string = this.today): void {
		if (!this.settings.pomoCounts) {
			this.settings.pomoCounts = {};
		}

		if (!this.settings.pomoCounts[date]) {
			this.settings.pomoCounts[date] = 0;
		}

		this.settings.pomoCounts[date]++;
		this.saveSettings();
	}

	getPomoCountForDate(dateStr: string): number {
		return this.settings.pomoCounts?.[dateStr] || 0;
	}

	private getDataPath(): string {
		const configDir = this.plugin.app.vault.configDir || ".obsidian";
		const pluginId = this.plugin.manifest.id || "work-assistant";
		return `${configDir}/plugins/${pluginId}/daily-count-data.json`;
	}

	async loadSettings(): Promise<void> {
		const dataPath = this.getDataPath();
		try {
			if (!(await this.plugin.app.vault.adapter.exists(dataPath))) {
				this.settings = Object.assign({}, DEFAULT_SETTINGS);
				return;
			}
			const data = await this.plugin.app.vault.adapter.read(dataPath);
			if (data) {
				const parsedData = JSON.parse(data);
				this.settings = Object.assign({}, DEFAULT_SETTINGS, parsedData);
				if (!this.settings.pomoCounts) {
					this.settings.pomoCounts = {};
				}
			} else {
				this.settings = Object.assign({}, DEFAULT_SETTINGS);
			}
		} catch (e) {
			console.log("[Work Assistant] Failed to load daily count data, using defaults", e);
			this.settings = Object.assign({}, DEFAULT_SETTINGS);
		}
	}

	async saveSettings(): Promise<void> {
		if (Object.keys(this.settings.dayCounts).length > 0 || Object.keys(this.settings.pomoCounts).length > 0) {
			const dataPath = this.getDataPath();
			try {
				const backupPath = dataPath.replace(".json", "-backup.json");

				// Ensure directory exists
				const dir = dataPath.substring(0, dataPath.lastIndexOf("/"));
				if (!(await this.plugin.app.vault.adapter.exists(dir))) {
					await this.plugin.app.vault.adapter.mkdir(dir);
				}

				if (await this.plugin.app.vault.adapter.exists(dataPath)) {
					const existingData = await this.plugin.app.vault.adapter.read(dataPath);
					await this.plugin.app.vault.adapter.write(backupPath, existingData);
				}

				await this.plugin.app.vault.adapter.write(dataPath, JSON.stringify(this.settings));

				if (await this.plugin.app.vault.adapter.exists(backupPath)) {
					await this.plugin.app.vault.adapter.remove(backupPath);
				}
			} catch (error) {
				console.error("[Work Assistant] Failed to save daily count data, keeping backup:", error);
			}
		}
	}

	// Get word count for a specific date
	getWordCountForDate(dateStr: string): number {
		return this.settings.dayCounts[dateStr] || 0;
	}

	getFileCountChange(filepath: string): number {
		const fileData = this.settings.todaysWordCount[filepath];
		if (!fileData) return 0;
		return Math.max(0, fileData.current - fileData.initial);
	}

	getWeeklyWordCount(date: Moment): number {
		// Clone to avoid modifying the original date
		// Start from the beginning of the week
		const startOfWeek = date.clone().startOf('week');
		let total = 0;

		// Iterate through 7 days
		for (let i = 0; i < 7; i++) {
			const currentDay = startOfWeek.clone().add(i, 'days');
			const dateStr = currentDay.format("YYYY-MM-DD");
			const count = this.getWordCountForDate(dateStr);
			total += count;
		}

		return total;
	}

	getWeeklyPomoCount(date: Moment): number {
		const startOfWeek = date.clone().startOf('week');
		let total = 0;

		for (let i = 0; i < 7; i++) {
			const currentDay = startOfWeek.clone().add(i, 'days');
			const dateStr = currentDay.format("YYYY-MM-DD");
			const count = this.getPomoCountForDate(dateStr);
			total += count;
		}

		return total;
	}

	// Get all word count data
	getAllWordCountData(): Record<string, number> {
		return this.settings.dayCounts;
	}
}