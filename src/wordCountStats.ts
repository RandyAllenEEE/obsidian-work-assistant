import { MarkdownView, debounce, TFile, Component } from 'obsidian';
import type { Debouncer, App } from 'obsidian';
import type { Moment } from "moment";
import { t } from "./i18n";
import { WORKER_CODE } from "./workers/worker";
import { DEFAULT_DAILY_STATS_SETTINGS, StatsMdStore } from "./io/statsMdStore";
import type { DailyStatsSettings } from "./io/statsMdStore";
import type { TodaysWordCountAggregate } from "./io/statsMdStore";
import type { WordCountSnapshot } from "./io/statsMdStore";
import type CalendarPlugin from "./main";

export const WORD_COUNT_STATS_UPDATED_EVENT = "work-assistant:word-count-stats-updated";

export default class WordCountStats extends Component {
	settings: DailyStatsSettings;
	currentWordCount: number;
	today: string;
	debouncedUpdate: Debouncer<[string, string], void>;
	private debouncedSave: Debouncer<[], Promise<void>>;
	plugin: CalendarPlugin;
	app: App;
	statusBarEl: HTMLElement | null = null;
	private readonly statsStore: StatsMdStore;
	private todaysAggregate: TodaysWordCountAggregate = { total: 0, byFile: {} };

	// Worker related
	private worker: Worker | null = null;
	private lastNonce = 0;
	private latestNonceByPath = new Map<string, number>();
	private pathByNonce = new Map<number, string>();
	private dirty = false; // Check for unsaved changes
	private activeStatsMdPath: string;

	// Cache for file word counts to improve performance
	private wordCountCache: Map<string, { contentHash: string; wordCount: number; timestamp: number }> = new Map();
	private isSaving = false; // Guard against concurrent save operations
	private isDayTransitioning = false;
	private isUnloading = false;
	private saveDrainPromise: Promise<void> | null = null;
	private saveRequested = false;
	private pendingSkipUpdateDateCheck = true;
	private bufferedUpdatesDuringTransition = new Map<string, number>();

	constructor(plugin: CalendarPlugin, app: App) {
		super();
		this.plugin = plugin;
		this.app = app;
		this.settings = Object.assign({}, DEFAULT_DAILY_STATS_SETTINGS);
		this.today = window.moment().format("YYYY-MM-DD");
		this.activeStatsMdPath = this.resolveStatsMdPath();
		this.statsStore = new StatsMdStore(this.app, () => this.resolveStatsMdPath());
	}

	onload(): void {
		this.initialize();
	}

	onunload(): void {
		this.isUnloading = true;
		if (this.statusBarEl) {
			this.statusBarEl.remove();
			this.statusBarEl = null;
		}

		// 强制保存脏数据，防止会话统计丢失（best effort）
		if (this.dirty) {
			void this.flushOnUnload();
			return;
		}
		
		this.finalizeUnload();
	}

	private async flushOnUnload(): Promise<void> {
		try {
			await Promise.race([
				this.requestSave({ skipUpdateDateCheck: true }),
				new Promise<void>((resolve) => setTimeout(resolve, 500))
			]);
		} finally {
			this.finalizeUnload();
		}
	}

	private finalizeUnload(): void {
		this.statsStore.cleanup();
		this.terminateWorker();
	}

	private initWorker(): void {
		if (this.worker) return;
		try {
			const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
			const url = URL.createObjectURL(blob);
			this.worker = new Worker(url);

			this.worker.onmessage = (e: MessageEvent) => {
				const { id, count, hash } = e.data;
				this.handleWorkerMessage(id, count, hash);
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
		this.latestNonceByPath.clear();
		this.pathByNonce.clear();
	}

	private handleWorkerMessage(nonce: number, count: number, hash: string): void {
		const filepath = this.pathByNonce.get(nonce);
		if (!filepath) {
			return;
		}

		this.pathByNonce.delete(nonce);
		if (this.latestNonceByPath.get(filepath) !== nonce) {
			return; // Stale worker response, ignore safely.
		}

		this.latestNonceByPath.delete(filepath);
		this.wordCountCache.set(filepath, {
			contentHash: hash,
			wordCount: count,
			timestamp: Date.now()
		});

		this.updateStore(filepath, count);
	}

	async initialize(): Promise<void> {
		await this.loadSettings();

		this.updateDate();
		this.updateCounts();

		// Initialize Worker if enabled
		this.initWorker();

		// 使用带校验的配置值，避免异常配置直接生效
		const debounceDelay = this.getDebounceDelay();
		this.debouncedUpdate = debounce((contents: string, filepath: string) => {
			this.updateWordCount(contents, filepath);
		}, debounceDelay, false);

		this.debouncedSave = debounce(async () => {
			await this.saveSettings();
		}, debounceDelay, true);

		// Register events
		this.registerEvent(
			this.app.workspace.on("quick-preview", this.onQuickPreview.bind(this))
		);

		this.registerEvent(
			this.app.vault.on("modify", async (file: TFile) => {
				// Only process markdown files
				if (file instanceof TFile && file.extension === "md" && !this.isStatsFile(file.path) && !this.shouldIgnoreFile(file.path)) {
					// We need to read the file content to update the word count
					const contents = await this.app.vault.read(file);
					this.debouncedUpdate(contents, file.path);
				}
			})
		);

		// 使用带校验的配置值，避免异常配置直接生效
		const autoSaveInterval = this.getAutoSaveInterval();
		// Save settings periodically as a safety measure
		this.registerInterval(window.setInterval(() => {
			this.updateDate();
			if (this.dirty) {
				this.debouncedSave();
			}
		}, autoSaveInterval));

		// Initialize status bar based on initial state? We'll let main.ts call updateStatusBar.
		// this.statusBarEl = this.plugin.addStatusBarItem();
		this.registerStatusBarUpdates();
		void this.initializeActiveFileWordCount();
	}

		public async handleSettingsChanged(): Promise<void> {
		const nextPath = this.resolveStatsMdPath();
		const pathChanged = nextPath !== this.activeStatsMdPath;

		if (this.dirty) {
			await this.saveSettings();
		}

		if (pathChanged) {
			this.activeStatsMdPath = nextPath;
		}

		// Always reload settings to pick up changes like ignoredFiles
		await this.loadSettings();

		if (pathChanged) {
			this.updateDate();
			this.updateCounts();
		}
	}

	private updateStore(filepath: string, count: number): void {
		if (this.isUnloading) {
			return;
		}
		if (this.isStatsFile(filepath)) {
			return;
		}
		if (this.shouldIgnoreFile(filepath)) {
			return;
		}

		let changed = false;

		this.updateDate();
		if (this.isDayTransitioning) {
			this.bufferedUpdatesDuringTransition.set(filepath, count);
			return;
		}

		if (!Object.prototype.hasOwnProperty.call(this.settings.dayCounts, this.today)) {
			this.settings.dayCounts[this.today] = 0;
			this.settings.todaysWordCount = {};
			this.wordCountCache.clear();
		}

		if (this.ensureBaselineForFile(filepath, count)) {
			changed = true;
		} else {
			// 获取现有记录
			const existingRecord = this.settings.todaysWordCount[filepath];
			
			// 计算变化量（相对于当前值的变化）
			const delta = count - existingRecord.current;
			
			// 如果变化超过阈值，则移动基线（而不是完全忽略）
			if (Math.abs(delta) >= this.getShockThreshold()) {
				// ✅ 智能处理：将大变化加到 initial 和 current
				// 这样既忽略了这次冲击，又不影响后续的计数
				// 原理：新增长 = new_current - new_initial = (old_current + delta) - (old_initial + delta) = old_growth
				this.settings.todaysWordCount[filepath] = {
					initial: existingRecord.initial + delta,
					current: count
				};
				this.dirty = true;
				this.updateCounts();
				// ✅ 冲击是特殊事件，立即保存（不等防抖）
				void this.saveSettings();
				return;
			}
			
			// 更新current值
			if (existingRecord.current !== count) {
				this.settings.todaysWordCount[filepath] = {
					initial: existingRecord.initial,
					current: count
				};
				changed = true;
			}
		}

		if (changed) {
			this.dirty = true;
			this.updateCounts();
			this.debouncedSave();
		}
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
				// Ensure daily baseline exists when user enters a note.
				void this.initializeActiveFileWordCount();
			})
		);

		// Update when editor changes (live counting)
		// Note: We leverage the existing debouncedUpdate for the heavy lifting
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, view) => {
				if (view instanceof MarkdownView && view.file) {
					if (this.isStatsFile(view.file.path) || this.shouldIgnoreFile(view.file.path)) {
						return;
					}
					const content = editor.getValue();
					this.debouncedUpdate(content, view.file.path);
				}
			})
		);
	}

	private async initializeActiveFileWordCount(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.extension === 'md' && !this.isStatsFile(activeFile.path) && !this.shouldIgnoreFile(activeFile.path)) {
			// 检查是否已经有当天的记录
			if (!Object.prototype.hasOwnProperty.call(this.settings.todaysWordCount, activeFile.path)) {
				// 立即读取文件内容并初始化
				try {
					const contents = await this.app.vault.read(activeFile);
					const count = this.countWords(contents);
					
					// 立即更新store（不经过防抖）
					this.updateStoreImmediate(activeFile.path, count, true);
				} catch (error) {
					console.warn("[Work Assistant] Failed to initialize word count for active file:", error);
				}
			}
		}
	}

	private updateStoreImmediate(filepath: string, count: number, allowDuringDayTransition = false): void {
		if (this.isUnloading) {
			return;
		}
		if (this.isStatsFile(filepath)) {
			return;
		}
		if (this.shouldIgnoreFile(filepath)) {
			return;
		}

		let changed = false;

		this.updateDate();
		if (this.isDayTransitioning && !allowDuringDayTransition) {
			this.bufferedUpdatesDuringTransition.set(filepath, count);
			return;
		}

		if (!Object.prototype.hasOwnProperty.call(this.settings.dayCounts, this.today)) {
			this.settings.dayCounts[this.today] = 0;
			this.settings.todaysWordCount = {};
			this.wordCountCache.clear();
		}

		if (this.ensureBaselineForFile(filepath, count)) {
			changed = true;
		} else {
			// 获取现有记录
			const existingRecord = this.settings.todaysWordCount[filepath];
			
			// 计算变化量（相对于当前值的变化）
			const delta = count - existingRecord.current;
			
			// 如果变化超过阈值，则移动基线（而不是完全忽略）
			if (Math.abs(delta) >= this.getShockThreshold()) {
				// ✅ 智能处理：将大变化加到 initial 和 current
				// 这样既忽略了这次冲击，又不影响后续的计数
				this.settings.todaysWordCount[filepath] = {
					initial: existingRecord.initial + delta,
					current: count
				};
				this.dirty = true;
				this.updateCounts();
				// ✅ 冲击是特殊事件，立即保存
				void this.saveSettings();
				return;
			}
			
			// 更新current值
			if (existingRecord.current !== count) {
				this.settings.todaysWordCount[filepath] = {
					initial: existingRecord.initial,
					current: count
				};
				changed = true;
			}
		}

		if (changed) {
			this.dirty = true;
			this.updateCounts();
			// 立即保存，不使用防抖
			void this.saveSettings();
		}
	}

	private ensureBaselineForFile(filepath: string, count: number): boolean {
		if (Object.prototype.hasOwnProperty.call(this.settings.todaysWordCount, filepath)) {
			return false;
		}

		this.settings.todaysWordCount[filepath] = {
			initial: count,
			current: count
		};
		return true;
	}

	refreshStatusBar(): void {
		if (!this.statusBarEl) return;

		const lang = this.getObsidianLanguage();
		const currentWordCount = Math.max(0, this.todaysAggregate.total || 0);
		const formattedCount = currentWordCount.toString();

		let text = t('status-bar-words-today', lang).replace('{count}', formattedCount);

		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.extension === 'md') {
			const fileChange = Math.max(0, this.getFileCountChange(activeFile.path));
			const formattedFileChange = fileChange.toString();
			const detailText = t('status-bar-words-today-detail', lang)
				.replace('{file}', formattedFileChange)
				.replace('{total}', formattedCount);

			if (detailText !== 'status-bar-words-today-detail') {
				text = detailText;
			}
		}

		this.statusBarEl.setText(text);
	}

	onQuickPreview(file: TFile, contents: string): void {
		if (this.isStatsFile(file.path) || this.shouldIgnoreFile(file.path)) {
			return;
		}

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
		if (this.isUnloading) {
			return;
		}
		if (this.shouldIgnoreFile(filepath)) {
			return;
		}
		if (this.worker) {
			const nonce = ++this.lastNonce;
			const previousNonce = this.latestNonceByPath.get(filepath);
			if (previousNonce !== undefined) {
				this.pathByNonce.delete(previousNonce);
			}
			this.latestNonceByPath.set(filepath, nonce);
			this.pathByNonce.set(nonce, filepath);
			this.worker.postMessage({ id: nonce, text: contents });
		} else {
			// Fallback to main thread
			this.fallbackUpdateWordCount(contents, filepath);
		}
	}

	private fallbackUpdateWordCount(text: string, filepath: string): void {
		const hash = this.computeHash(text);
		const count = this.countWords(text);

		// Simulate worker message handling
		this.wordCountCache.set(filepath, {
			contentHash: hash,
			wordCount: count,
			timestamp: Date.now()
		});

		this.updateStore(filepath, count);
	}

	private computeHash(text: string): string {
		let hash = 0;
		for (let i = 0; i < text.length; i++) {
			const char = text.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		return hash.toString();
	}

	private countWords(text: string): number {
		// Use the same algorithm as in ui/utils.ts to ensure consistency
		let words = 0;
		const matches = text.match(
			/[a-zA-Z0-9_\u0392-\u03c9\u00c0-\u00ff\u0600-\u06ff]+|[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\uac00-\ud7af]+/gm
		);

		if (matches) {
			for (let i = 0; i < matches.length; i++) {
				// CJK字符判定：字符编码 > 19968 (0x4e00)
				if (matches[i].charCodeAt(0) > 19968) {
					// CJK (中日韩)：按字符数计
					words += matches[i].length;
				} else {
					// 英文/数字等：按单词数计
					words += 1;
				}
			}
		}
		return words;
	}

	updateDate(): void {
		const newToday = window.moment().format("YYYY-MM-DD");
		// 如果日期已改变，执行跨天处理
		if (newToday !== this.today && !this.isDayTransitioning) {
			void this.transitionToNewDay(newToday);
		}
	}

	private resetDailyTracking(newToday: string): void {
		this.today = newToday;
		// New day starts with a clean baseline to avoid stale initial/current carry-over.
		this.settings.todaysWordCount = {};
		this.settings.dayCounts[this.today] = 0;
		this.updateCounts();
		this.dirty = true;
	}

	private async transitionToNewDay(newToday: string): Promise<void> {
		if (this.isDayTransitioning) {
			return;
		}
		this.isDayTransitioning = true;
		try {
			this.wordCountCache.clear();
			if (this.dirty) {
				await this.requestSave({ skipUpdateDateCheck: true });
			}
			this.resetDailyTracking(newToday);
			await this.requestSave({ skipUpdateDateCheck: true });
			// Cold-start and midnight-running both initialize current active note baseline.
			await this.initializeActiveFileWordCount();
			if (this.dirty) {
				await this.requestSave({ skipUpdateDateCheck: true });
			}
		} finally {
			this.isDayTransitioning = false;
			this.replayBufferedUpdatesAfterTransition();
		}
	}

	private replayBufferedUpdatesAfterTransition(): void {
		if (this.bufferedUpdatesDuringTransition.size === 0) {
			return;
		}

		const buffered = [...this.bufferedUpdatesDuringTransition.entries()];
		this.bufferedUpdatesDuringTransition.clear();
		buffered.forEach(([filepath, count]) => this.updateStore(filepath, count));
	}

	updateCounts(): void {
		this.todaysAggregate = this.statsStore.getTodaysWordCountAggregate(this.settings.todaysWordCount);
		this.currentWordCount = this.todaysAggregate.total;
		// Persist the display value for stats table-like consumers.
		this.settings.dayCounts[this.today] = this.currentWordCount;
		this.refreshStatusBar();
	}

	private applySnapshot(snapshot: WordCountSnapshot): void {
		this.settings = snapshot.settings;
		this.todaysAggregate = snapshot.todaysAggregate;
		this.currentWordCount = this.todaysAggregate.total;
		
		// 修正 today 覆盖逻辑：只有当当天数据不存在时才设置
		if (!this.settings.dayCounts[this.today] || this.settings.dayCounts[this.today] !== this.currentWordCount) {
			this.settings.dayCounts[this.today] = this.currentWordCount;
		}
		
		this.refreshStatusBar();
	}

	private emitStatsUpdated(): void {
		this.app.workspace.trigger(WORD_COUNT_STATS_UPDATED_EVENT);
	}

	incrementPomoCount(date: string = this.today): void {
		if (!this.settings.pomoCounts) {
			this.settings.pomoCounts = {};
		}

		if (!this.settings.pomoCounts[date]) {
			this.settings.pomoCounts[date] = 0;
		}

		this.settings.pomoCounts[date]++;
		this.dirty = true;
		this.debouncedSave();
	}

	getPomoCountForDate(dateStr: string): number {
		return this.settings.pomoCounts?.[dateStr] || 0;
	}

	async loadSettings(): Promise<void> {
		const snapshot = await this.statsStore.load();
		const hasTodayInSnapshot = Object.prototype.hasOwnProperty.call(
			snapshot.settings.dayCounts ?? {},
			this.today
		);
		this.applySnapshot(snapshot);
		if (!hasTodayInSnapshot && !this.isDayTransitioning) {
			void this.transitionToNewDay(this.today);
		}
		await this.reconcileActiveFileBaselineAfterLoad(hasTodayInSnapshot);
		// 不需要特殊初始化wordCountCache，因为它会在updateStore中按需填充
	}

	private async reconcileActiveFileBaselineAfterLoad(hasTodayInSnapshot: boolean): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== 'md' || this.isStatsFile(activeFile.path) || this.shouldIgnoreFile(activeFile.path)) {
			return;
		}

		let contents = "";
		try {
			contents = await this.app.vault.read(activeFile);
		} catch (error) {
			console.warn("[Work Assistant] Failed to read active file for baseline reconciliation:", error);
			return;
		}

		const count = this.countWords(contents);
		const existing = this.settings.todaysWordCount[activeFile.path];
		if (!existing) {
			this.updateStoreImmediate(activeFile.path, count, true);
			return;
		}

		if (!hasTodayInSnapshot) {
			return;
		}

		// If today already exists but active baseline drifts too much, treat it as stale baseline.
		if (Math.abs(count - existing.current) >= this.getShockThreshold()) {
			this.settings.todaysWordCount[activeFile.path] = { initial: count, current: count };
			this.dirty = true;
			this.updateCounts();
			void this.requestSave();
			return;
		}

		if (existing.current !== count) {
			this.updateStoreImmediate(activeFile.path, count, true);
		}
	}

	private requestSave(options?: { skipUpdateDateCheck?: boolean }): Promise<void> {
		this.saveRequested = true;
		const shouldSkipUpdateDateCheck = options?.skipUpdateDateCheck === true;
		if (!shouldSkipUpdateDateCheck) {
			this.pendingSkipUpdateDateCheck = false;
		}

		if (!this.saveDrainPromise) {
			this.saveDrainPromise = this.drainSaveRequests().finally(() => {
				this.saveDrainPromise = null;
			});
		}
		return this.saveDrainPromise;
	}

	private async drainSaveRequests(): Promise<void> {
		while (this.saveRequested) {
			const skipUpdateDateCheck = this.pendingSkipUpdateDateCheck;
			this.saveRequested = false;
			this.pendingSkipUpdateDateCheck = true;

			if (!this.dirty || this.isSaving) {
				continue;
			}

			this.isSaving = true;
			try {
				const refreshedSnapshot = await this.statsStore.save(this.settings);
				this.applySnapshot(refreshedSnapshot);
				this.dirty = false;
				this.emitStatsUpdated();
				if (!skipUpdateDateCheck) {
					this.updateDate();
				}
			} catch (error) {
				console.error("[Work Assistant] Failed to save stats.md data:", error);
			} finally {
				this.isSaving = false;
			}
		}
	}

	async saveSettings(options?: { skipUpdateDateCheck?: boolean }): Promise<void> {
		await this.requestSave(options);
	}

	// Get word count for a specific date
	getWordCountForDate(dateStr: string): number {
		if (dateStr === this.today) {
			return this.todaysAggregate.total;
		}
		return this.settings.dayCounts[dateStr] || 0;
	}

	getFileCountChange(filepath: string): number {
		// 返回实际的增减值（允许负数），不作为 0 处理
		return this.todaysAggregate.byFile[filepath]?.displayDelta ?? 0;
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

	private resolveStatsMdPath(): string {
		const path = this.plugin.options.wordCount.statsMdPath?.trim();
		return path || "stats.md";
	}

	private isStatsFile(path: string): boolean {
		return path === this.resolveStatsMdPath();
	}

	private shouldIgnoreFile(filepath: string): boolean {
		const { ignoredFiles } = this.plugin.options.wordCount;
		if (!ignoredFiles || ignoredFiles.length === 0) {
			return false;
		}

		// Normalize filepath to use forward slashes for consistent matching
		const normalizedFilepath = filepath.replace(/\\/g, '/');

		for (const pattern of ignoredFiles) {
			const trimmed = pattern.trim();
			if (!trimmed) continue;

			try {
				// Regex format: /pattern/ or /pattern/flags
				// Must have content between the slashes to be considered a regex
				if (trimmed.startsWith('/') && trimmed.endsWith('/') && trimmed.length > 2) {
					const regex = new RegExp(trimmed.slice(1, -1));
					if (regex.test(normalizedFilepath)) return true;
				} else {
					// Normalize pattern to use forward slashes
					const normalizedPattern = trimmed.replace(/\\/g, '/');
					// Exact path match for files (patterns without trailing /)
					if (normalizedFilepath === normalizedPattern) {
						return true;
					}
					// Folder prefix match: pattern ending with / matches all files under that folder
					// e.g., "Inbox/" matches "Inbox/note.md", "Inbox/subfolder/note.md"
					if (normalizedPattern.endsWith('/') && normalizedFilepath.startsWith(normalizedPattern)) {
						return true;
					}
				}
			} catch (e) {
				console.warn(`[Work Assistant] Invalid ignore pattern: ${trimmed}`);
			}
		}
		return false;
	}

	private getShockThreshold(): number {
		const threshold = this.plugin.options.wordCount.shockThreshold;
		if (threshold === -1) return Infinity; // -1 means disabled (never trigger shock)
		return Number.isInteger(threshold) && threshold > 0 ? threshold : 1000;
	}

	private getDebounceDelay(): number {
		const delay = this.plugin.options.wordCount.debounceDelay;
		return Number.isInteger(delay) && delay > 0 ? delay : 2000;
	}

	private getAutoSaveInterval(): number {
		const interval = this.plugin.options.wordCount.autoSaveInterval;
		return Number.isInteger(interval) && interval > 0 ? interval : 30000;
	}

}
