import { Component, Notice, TFile, TFolder, debounce } from "obsidian";

import type CalendarPlugin from "../../main";
import { t } from "../../i18n";
import {
  defaultTaskSyncState,
  tasksStore,
} from "../../ui/stores";
import { runMigrations } from "./migrations/migrationRunner";
import { AutoSyncScheduler } from "./sync/autoSync";
import { ObsidianAdapter } from "./sync/obsidianAdapter";
import { SyncEngine, type SyncResult } from "./sync/syncEngine";
import type { CommonTask } from "./sync/types";
import { getEarliestTaskActionDate } from "../../ui/taskGrouping";
import { ObsidianTasksWrapper, type ObsidianTask } from "./tasks/obsidianTasksWrapper";
import type { CalDAVSettings, CalendarMapping } from "./types";
import { SyncResultModal } from "./ui/syncResultModal";
import { describeIncompleteCalendar } from "./utils/calendarConfig";

interface RuntimeSettingsBuild {
  settings: CalDAVSettings | null;
  skipped: string | null;
}

export class TaskSyncManager extends Component {
  private plugin: CalendarPlugin;
  private syncEngine: SyncEngine | null = null;
  private autoSync: AutoSyncScheduler | null = null;
  private taskOrigins = new Map<string, ObsidianTask>();
  private refreshLocalTasksDebounced: () => void;
  private refreshGeneration = 0;
  private syncPromise: Promise<SyncResult[]> | null = null;
  private backgroundSyncQueued = false;
  private knownTaskPaths = new Set<string>();
  private relevanceTimer: number | null = null;
  private pendingRelevancePaths = new Set<string>();

  constructor(plugin: CalendarPlugin) {
    super();
    this.plugin = plugin;
    this.refreshLocalTasksDebounced = debounce(
      () => void this.refreshLocalTasks(false),
      500,
      true
    );
  }

  onload(): void {
    this.registerEvent(this.plugin.app.vault.on("modify", (file) => this.onVaultChanged(file, undefined, true)));
    this.registerEvent(this.plugin.app.vault.on("create", (file) => this.onVaultChanged(file, undefined, true)));
    this.registerEvent(this.plugin.app.vault.on("delete", (file) => this.onVaultChanged(file, undefined, false)));
    this.registerEvent(this.plugin.app.vault.on("rename", (file, oldPath) => this.onVaultChanged(file, oldPath, true)));
  }

  onunload(): void {
    this.stopAutoSync();
    this.syncEngine = null;
    this.refreshGeneration++;
    this.taskOrigins.clear();
    this.knownTaskPaths.clear();
    if (this.relevanceTimer !== null) window.clearTimeout(this.relevanceTimer);
    this.relevanceTimer = null;
    this.pendingRelevancePaths.clear();
    tasksStore.set(defaultTaskSyncState);
  }

  async configure(): Promise<void> {
    this.stopAutoSync();
    this.syncEngine = null;

    const taskSettings = this.plugin.options.assistant.tasks;
    if (!taskSettings.enabled) {
      this.refreshGeneration++;
      this.taskOrigins.clear();
      tasksStore.set(defaultTaskSyncState);
      return;
    }

    const runtime = this.buildRuntimeSettings();
    if (runtime.skipped) {
      new Notice(t("tasks-notice-calendar-skipped").replace("{reason}", runtime.skipped), 8000);
    }

    if (runtime.settings) {
      await this.runStorageMigrations(runtime.settings);
      await this.initializeEngine(runtime.settings);
      this.autoSync = new AutoSyncScheduler(
        () => this.syncAll({ background: true }).then(() => undefined),
        (id) => this.plugin.registerInterval(id)
      );
      this.autoSync.start(runtime.settings.syncInterval);
    }

    await this.refreshLocalTasks();
  }

  async syncNow(): Promise<void> {
    const results = await this.syncAll();
    if (results.length === 0) return;
    new SyncResultModal(this.plugin.app, results, false).open();
  }

  async previewSync(): Promise<void> {
    const results = await this.syncAll({ dryRun: true });
    if (results.length === 0) return;
    new SyncResultModal(this.plugin.app, results, true, () => this.syncAll()).open();
  }

  async showStatus(): Promise<void> {
    if (!(await this.ensureEngineAvailable())) return;
    new Notice(this.syncEngine?.getStatus() ?? t("tasks-notice-status-not-ready"), 8000);
  }

  async completeTask(task: CommonTask): Promise<void> {
    if (task.status === "DONE" || task.status === "CANCELLED") return;

    const wrapper = new ObsidianTasksWrapper(this.plugin.app);
    if (!wrapper.initialize()) {
      this.setStoreError(t("tasks-error-plugin-unavailable"));
      new Notice(t("tasks-notice-completion-requires-plugin"));
      return;
    }

    const existingTask = this.taskOrigins.get(task.uid) ?? wrapper.findTaskById(task.uid);
    if (!existingTask) {
      new Notice(t("tasks-notice-task-not-found"));
      await this.refreshLocalTasks();
      return;
    }

    const toggle = wrapper.getToggleCommand();
    if (!toggle) {
      new Notice(t("tasks-notice-toggle-unavailable"));
      return;
    }

    try {
      tasksStore.update((state) => ({ ...state, syncing: true, error: undefined }));
      const updatedMarkdown = toggle(existingTask.originalMarkdown, existingTask.taskLocation.path);
      await wrapper.updateTaskInVault(existingTask, updatedMarkdown);
      await this.waitForTaskCache();
      await this.refreshLocalTasks(false);

      if (this.syncEngine) {
        await this.syncAll({ background: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStoreError(message);
      new Notice(t("tasks-notice-update-failed").replace("{message}", message), 8000);
    } finally {
      tasksStore.update((state) => ({ ...state, syncing: false }));
    }
  }

  async refreshLocalTasks(showLoading = true): Promise<void> {
    const generation = ++this.refreshGeneration;
    const taskSettings = this.plugin.options.assistant.tasks;
    if (!taskSettings.enabled) {
      tasksStore.set(defaultTaskSyncState);
      return;
    }

    if (showLoading) {
      tasksStore.update((state) => ({ ...state, loading: true, error: undefined }));
    }

    const wrapper = new ObsidianTasksWrapper(this.plugin.app);
    if (!wrapper.initialize()) {
      if (generation !== this.refreshGeneration) return;
      this.taskOrigins.clear();
      this.knownTaskPaths.clear();
      tasksStore.set({
        ...defaultTaskSyncState,
        error: t("tasks-error-plugin-unavailable"),
      });
      return;
    }

    try {
      const tasks = new Map<string, CommonTask>();
      const taskOrigins = new Map<string, ObsidianTask>();

      const calendar = taskSettings.calendar;
      const adapter = new ObsidianAdapter(wrapper, {
        syncTag: calendar.obsidianTag,
        excludedPaths: taskSettings.excludedPaths,
        newTasksDestination: taskSettings.newTasksDestination,
        newTasksSection: taskSettings.newTasksSection,
        includeObsidianLink: taskSettings.includeObsidianLink,
        getVaultName: () => this.plugin.app.vault.getName(),
      });
      const calendarTasks = await adapter.fetchTasks();
      for (const task of calendarTasks) {
        tasks.set(task.uid, task);
        const original = adapter.findOriginalTask(task.uid);
        if (original) {
          taskOrigins.set(task.uid, original);
        }
      }

      if (generation !== this.refreshGeneration) return;
      const sortedTasks = Array.from(tasks.values()).sort(compareTasks);
      this.taskOrigins = taskOrigins;
      this.knownTaskPaths = new Set(
        [...taskOrigins.values()].map((task) => task.taskLocation.path)
      );
      tasksStore.update((state) => ({
        ...state,
        tasks: sortedTasks,
        ready: true,
        loading: false,
        error: undefined,
      }));
    } catch (error) {
      if (generation !== this.refreshGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      this.setStoreError(message);
    }
  }

  private async syncAll({
    dryRun = false,
    background = false,
  }: { dryRun?: boolean; background?: boolean } = {}): Promise<SyncResult[]> {
    if (this.syncPromise) {
      if (background) {
        this.backgroundSyncQueued = true;
        return [];
      }
      const busy = this.buildBusyResult();
      new Notice(busy.message);
      return [busy];
    }

    const run = this.runSync({ dryRun, background });
    this.syncPromise = run;
    try {
      return await run;
    } finally {
      if (this.syncPromise === run) this.syncPromise = null;
      if (this.backgroundSyncQueued) {
        this.backgroundSyncQueued = false;
        void this.syncAll({ background: true });
      }
    }
  }

  private async runSync({
    dryRun,
    background,
  }: { dryRun: boolean; background: boolean }): Promise<SyncResult[]> {
    if (!(await this.ensureEngineAvailable(background))) {
      return [];
    }

    const results: SyncResult[] = [];
    tasksStore.update((state) => ({ ...state, syncing: true, error: undefined }));

    try {
      if (this.syncEngine) {
        results.push(await this.syncEngine.sync({ dryRun, background }));
      }
      if (!dryRun) {
        await this.waitForTaskCache();
        await this.refreshLocalTasks(false);
        if (results.length > 0 && results.every((result) => result.success)) {
          tasksStore.update((state) => ({
            ...state,
            lastSyncTime: new Date().toISOString(),
          }));
        } else if (results.some((result) => !result.success)) {
          this.setStoreError(results.find((result) => !result.success)?.message ?? "Task sync failed");
        }
      }
    } finally {
      tasksStore.update((state) => ({ ...state, syncing: false }));
    }

    return results;
  }

  private buildBusyResult(): SyncResult {
    const message = "Task sync is already running.";
    return {
      calendarName: this.plugin.options.assistant.tasks.calendar.calendarName,
      status: "busy",
      success: false,
      message,
      created: { toObsidian: 0, toCalDAV: 0 },
      updated: { toObsidian: 0, toCalDAV: 0 },
      deleted: { toObsidian: 0, toCalDAV: 0 },
      reconciled: 0,
      conflicts: 0,
      details: { toObsidian: [], toCalDAV: [], conflictDetails: [] },
    };
  }

  private async initializeEngine(settings: CalDAVSettings, showNotice = true): Promise<void> {
    const engine = new SyncEngine(this.plugin.app, settings.calendar, settings);
    const ready = await engine.initialize(showNotice);
    this.syncEngine = ready ? engine : null;
    if (showNotice && !this.syncEngine) {
      new Notice(t("tasks-notice-sync-configured-plugin-missing"));
    }
  }

  private buildRuntimeSettings(): RuntimeSettingsBuild {
    const taskSettings = this.plugin.options.assistant.tasks;
    const calendar = taskSettings.calendar;
    const candidate: CalendarMapping = {
      obsidianTag: calendar.obsidianTag,
      caldavCategory: calendar.caldavCategory,
      calendarName: calendar.calendarName,
      serverUrl: calendar.serverUrl,
      username: calendar.username,
      password: "",
    };

    const incomplete = describeIncompleteCalendar(candidate, 0);
    if (incomplete) {
      return { settings: null, skipped: incomplete };
    }

    const password = calendar.passwordSecretId
      ? this.plugin.app.secretStorage?.getSecret(calendar.passwordSecretId) ?? ""
      : "";
    if (!password) {
      const calendarName = calendar.calendarName || calendar.serverUrl || t("settings-tasks-calendar");
      return {
        settings: null,
        skipped: t("tasks-notice-missing-password-secret").replace("{calendar}", calendarName),
      };
    }

    return {
      skipped: null,
      settings: {
        calendar: { ...candidate, password },
        syncInterval: taskSettings.syncInterval,
        newTasksDestination: taskSettings.newTasksDestination,
        newTasksSection: taskSettings.newTasksSection || undefined,
        excludedPaths: taskSettings.excludedPaths,
        requireManualConflictResolution: false,
        autoResolveObsidianWins: taskSettings.autoResolveObsidianWins,
        syncCompletedTasks: false,
        deleteBehavior: "ask",
        includeObsidianLink: taskSettings.includeObsidianLink,
        showAutoSyncNotifications: taskSettings.showAutoSyncNotifications,
        appliedMigrations: taskSettings.appliedMigrations ?? [],
      },
    };
  }

  private async runStorageMigrations(settings: CalDAVSettings): Promise<void> {
    try {
      const migrated = await runMigrations(this.plugin.app, settings);
      if (!migrated) return;

      await this.plugin.writeOptions((old) => ({
        ...old,
        assistant: {
          ...old.assistant,
          tasks: {
            ...old.assistant.tasks,
            appliedMigrations: settings.appliedMigrations ?? [],
          },
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t("tasks-notice-migration-failed").replace("{message}", message), 8000);
      console.error("[Work Assistant] Task sync migration failed:", error);
    }
  }

  private async ensureEngineAvailable(background = false): Promise<boolean> {
    if (this.syncEngine) return true;

    const taskSettings = this.plugin.options.assistant.tasks;
    if (!taskSettings.enabled) return false;

    const runtime = this.buildRuntimeSettings();
    if (!runtime.settings) {
      if (!background) {
        const reason = runtime.skipped ?? t("tasks-notice-check-settings");
        new Notice(t("tasks-notice-no-calendar-ready").replace("{reason}", reason), 8000);
      }
      return false;
    }

    await this.initializeEngine(runtime.settings, !background);
    if (this.syncEngine) return true;

    if (!background) {
      new Notice(t("tasks-notice-plugin-not-ready"), 8000);
    }
    return false;
  }

  private stopAutoSync(): void {
    this.autoSync?.stop();
    this.autoSync = null;
  }

  private onVaultChanged(file: unknown, oldPath?: string, mayContainNewTasks = false): void {
    if (!this.plugin.options.assistant.tasks.enabled) return;
    if (file instanceof TFolder) {
      this.queueLocalTaskRefresh();
      return;
    }
    if (!(file instanceof TFile) || file.extension !== "md") return;
    if (this.knownTaskPaths.has(file.path) || (!!oldPath && this.knownTaskPaths.has(oldPath))) {
      this.queueLocalTaskRefresh();
      return;
    }
    if (!mayContainNewTasks) return;

    this.pendingRelevancePaths.add(file.path);
    if (this.relevanceTimer !== null) return;
    this.relevanceTimer = window.setTimeout(() => {
      this.relevanceTimer = null;
      const pendingPaths = this.pendingRelevancePaths;
      this.pendingRelevancePaths = new Set();
      const wrapper = new ObsidianTasksWrapper(this.plugin.app);
      if (!wrapper.initialize()) return;
      if (wrapper.getAllTasks().some((task) => pendingPaths.has(task.taskLocation?.path))) {
        this.queueLocalTaskRefresh();
      }
    }, 250);
  }

  private queueLocalTaskRefresh(): void {
    this.refreshGeneration++;
    this.refreshLocalTasksDebounced();
  }

  private setStoreError(error: string): void {
    tasksStore.update((state) => ({
      ...state,
      loading: false,
      ready: false,
      error,
    }));
  }

  private waitForTaskCache(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, 250));
  }
}

function compareTasks(a: CommonTask, b: CommonTask): number {
  const aDate = getEarliestTaskActionDate(a) ?? "9999-12-31";
  const bDate = getEarliestTaskActionDate(b) ?? "9999-12-31";
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  return a.title.localeCompare(b.title);
}
