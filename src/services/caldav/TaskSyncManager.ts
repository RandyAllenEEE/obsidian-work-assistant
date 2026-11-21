import { Component, Notice, TFile, TFolder } from "obsidian";

import type CalendarPlugin from "../../main";
import { t } from "../../i18n";
import { defaultTaskSyncState, tasksStore } from "../../ui/stores";
import { AutoSyncScheduler } from "./sync/autoSync";
import type { CommonTask } from "./sync/types";
import { LocalTaskPublisher } from "./localTaskPublisher";
import { RemoteTaskRepository } from "./remoteTaskRepository";
import { TaskCoordinator, type CoordinationResult } from "./taskCoordinator";
import { TaskStateStore } from "./storage/taskStateStore";
import type { CalendarMapping } from "./types";
import { describeIncompleteCalendar } from "./utils/calendarConfig";
import { calendarStorageId } from "./utils/calendarStorageId";

interface RuntimeTaskSettings {
  calendar: CalendarMapping;
  syncInterval: number;
  excludedPaths: string[];
  includeObsidianLink: boolean;
  showAutoSyncNotifications: boolean;
}

interface RuntimeSettingsBuild {
  settings: RuntimeTaskSettings | null;
  skipped: string | null;
}

/** Runtime owner for the CalDAV-authoritative task pipeline. */
export class TaskSyncManager extends Component {
  private coordinator: TaskCoordinator | null = null;
  private autoSync: AutoSyncScheduler | null = null;
  private configurationGeneration = 0;
  private localInspectionTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private localInspectionGeneration = 0;
  private pendingLocalPaths = new Set<string>();
  private pendingFolderEvent = false;

  constructor(private readonly plugin: CalendarPlugin) {
    super();
  }

  onload(): void {
    this.registerEvent(this.plugin.app.vault.on("modify", (file) => this.onVaultChanged(file)));
    this.registerEvent(this.plugin.app.vault.on("create", (file) => this.onVaultChanged(file)));
    this.registerEvent(this.plugin.app.vault.on("delete", (file) => this.onVaultDeleted(file)));
    this.registerEvent(this.plugin.app.vault.on("rename", (file, oldPath) => this.onVaultRenamed(file, oldPath)));
  }

  onunload(): void {
    this.configurationGeneration++;
    this.stopAutoSync();
    this.coordinator?.dispose();
    this.coordinator = null;
    if (this.localInspectionTimer !== null) globalThis.clearTimeout(this.localInspectionTimer);
    this.localInspectionTimer = null;
    this.localInspectionGeneration++;
    this.pendingLocalPaths.clear();
    this.pendingFolderEvent = false;
    tasksStore.set(defaultTaskSyncState);
  }

  /** Start initial synchronization without blocking Plugin.onload or the UI. */
  startAfterLayoutReady(): void {
    const scheduledGeneration = this.configurationGeneration;
    this.plugin.app.workspace.onLayoutReady(() => {
      if (this.plugin.taskSyncManager !== this
        || this.configurationGeneration !== scheduledGeneration) return;

      const pending = this.configure();
      const generation = this.configurationGeneration;
      void pending.catch((error) => {
        if (this.plugin.taskSyncManager !== this
          || this.configurationGeneration !== generation) return;
        this.stopAutoSync();
        this.coordinator?.dispose();
        this.coordinator = null;
        tasksStore.set({ ...defaultTaskSyncState, error: errorMessage(error) });
        console.error("[Work Assistant] Initial task synchronization failed:", error);
      });
    });
  }

  async configure(): Promise<void> {
    const generation = ++this.configurationGeneration;
    this.stopAutoSync();
    const previousCoordinator = this.coordinator;
    this.coordinator = null;
    if (this.localInspectionTimer !== null) globalThis.clearTimeout(this.localInspectionTimer);
    this.localInspectionTimer = null;
    this.localInspectionGeneration++;
    this.pendingLocalPaths.clear();
    this.pendingFolderEvent = false;
    await previousCoordinator?.stop();
    if (generation !== this.configurationGeneration) return;
    tasksStore.set(defaultTaskSyncState);

    if (!this.plugin.options.assistant.tasks.enabled) return;
    const runtime = this.buildRuntimeSettings();
    if (!runtime.settings) {
      const reason = runtime.skipped ?? t("tasks-notice-check-settings");
      tasksStore.set({ ...defaultTaskSyncState, error: reason });
      new Notice(t("tasks-notice-no-calendar-ready").replace("{reason}", reason), 8000);
      return;
    }

    const settings = runtime.settings;
    const calendarId = calendarStorageId(settings.calendar.serverUrl, settings.calendar.calendarName);
    let stateStore: TaskStateStore | null = new TaskStateStore(
      this.plugin.app,
      this.plugin.manifest.dir ?? `.obsidian/plugins/${this.plugin.manifest.id}`,
    );
    let stateError: string | undefined;
    try {
      await stateStore.load();
    } catch (error) {
      stateError = `task-state.json could not be loaded; local publishing is disabled: ${errorMessage(error)}`;
      console.error("[Work Assistant] Task state is read-only after a load failure:", error);
      new Notice(stateError, 10000);
      stateStore = null;
    }
    if (generation !== this.configurationGeneration) return;

    const localPublisher = new LocalTaskPublisher(this.plugin.app, {
      syncTag: settings.calendar.obsidianTag,
      excludedPaths: settings.excludedPaths,
      includeObsidianLink: settings.includeObsidianLink,
      getVaultName: () => this.plugin.app.vault.getName(),
    });
    const coordinator = new TaskCoordinator({
      app: this.plugin.app,
      calendarId,
      vaultName: this.plugin.app.vault.getName(),
      repository: new RemoteTaskRepository(settings.calendar),
      localPublisher,
      stateStore,
      stateError,
    });
    this.coordinator = coordinator;

    this.autoSync = new AutoSyncScheduler(
      async () => {
        const result = await coordinator.coordinate();
        if (settings.showAutoSyncNotifications && result?.status === "failed") {
          new Notice(result.error ?? "Task coordination failed", 8000);
        }
      },
      (id) => this.plugin.registerInterval(id),
    );
    this.autoSync.start(settings.syncInterval);

    // A live CalDAV query, never a disk snapshot, gates the first sidebar data.
    await coordinator.coordinate();
  }

  async syncNow(): Promise<void> {
    const coordinator = this.coordinator;
    if (!coordinator) {
      this.noticeUnavailable();
      return;
    }
    const result = await coordinator.coordinateManually();
    new Notice(formatResult(result), result.status === "success" ? 5000 : 9000);
  }

  async previewSync(): Promise<void> {
    const coordinator = this.coordinator;
    if (!coordinator) {
      this.noticeUnavailable();
      return;
    }
    try {
      const preview = await coordinator.preview();
      new Notice(
        `CalDAV: ${preview.remoteTaskCount}\n` +
        `Would create: ${preview.create.length}\n` +
        `Would complete remotely: ${preview.completeRemote.length}\n` +
        `Would complete locally: ${preview.completeLocal.length}`,
        9000,
      );
    } catch (error) {
      new Notice(`Task preview failed: ${errorMessage(error)}`, 9000);
    }
  }

  async showStatus(): Promise<void> {
    if (!this.coordinator) {
      this.noticeUnavailable();
      return;
    }
    new Notice(this.coordinator.getStatus(), 8000);
  }

  async completeTask(task: CommonTask): Promise<void> {
    if (!this.coordinator || task.status === "DONE" || task.status === "CANCELLED") return;
    const result = await this.coordinator.completeTask(task);
    if (result.status === "failed") {
      new Notice(`Task completion is pending: ${result.error ?? "unknown error"}`, 9000);
    }
  }

  /** Refresh means a server query only; it never scans or publishes local data. */
  async refreshRemoteTasks(): Promise<void> {
    if (!this.coordinator) {
      this.noticeUnavailable();
      return;
    }
    const result = await this.coordinator.refreshRemoteManually();
    if (result.status !== "success") {
      new Notice(result.error ?? "Task refresh failed", result.status === "busy" ? 5000 : 8000);
    }
  }

  /** Kept as an internal compatibility alias for callers compiled against 4.4. */
  async refreshLocalTasks(): Promise<void> {
    await this.refreshRemoteTasks();
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
    if (incomplete) return { settings: null, skipped: incomplete };
    const password = calendar.passwordSecretId
      ? this.plugin.app.secretStorage?.getSecret(calendar.passwordSecretId) ?? ""
      : "";
    if (!password) {
      const name = calendar.calendarName || calendar.serverUrl || t("settings-tasks-calendar");
      return {
        settings: null,
        skipped: t("tasks-notice-missing-password-secret").replace("{calendar}", name),
      };
    }

    return {
      skipped: null,
      settings: {
        calendar: { ...candidate, password },
        syncInterval: taskSettings.syncInterval,
        excludedPaths: taskSettings.excludedPaths,
        includeObsidianLink: taskSettings.includeObsidianLink,
        showAutoSyncNotifications: taskSettings.showAutoSyncNotifications,
      },
    };
  }

  private onVaultChanged(file: unknown): void {
    if (!this.plugin.options.assistant.tasks.enabled) return;
    if (!this.isRelevantVaultPath(file)) return;
    if (file instanceof TFolder) {
      this.pendingFolderEvent = true;
    } else {
      this.pendingLocalPaths.add(file.path);
    }
    if (this.localInspectionTimer !== null) globalThis.clearTimeout(this.localInspectionTimer);
    const generation = this.configurationGeneration;
    const inspectionGeneration = ++this.localInspectionGeneration;
    this.localInspectionTimer = globalThis.setTimeout(() => {
      this.localInspectionTimer = null;
      const paths = this.pendingLocalPaths;
      const includeFolderEvent = this.pendingFolderEvent;
      this.pendingLocalPaths = new Set();
      this.pendingFolderEvent = false;
      void this.runLocalInspection(generation, inspectionGeneration, paths, includeFolderEvent);
    }, 400);
  }

  private onVaultDeleted(file: unknown): void {
    if (!this.isRelevantVaultPath(file)) return;
    void this.coordinator?.handleLocalDelete(file.path).catch((error) => {
      console.error("[Work Assistant] Failed to retire deleted task paths:", error);
    });
    this.onVaultChanged(file);
  }

  private onVaultRenamed(file: unknown, oldPath: string): void {
    if (!this.isRelevantVaultPath(file)) return;
    if (typeof oldPath === "string") {
      void this.coordinator?.handleLocalRename(oldPath, file.path).catch((error) => {
        console.error("[Work Assistant] Failed to migrate renamed task paths:", error);
      });
    }
    this.onVaultChanged(file);
  }

  private isRelevantVaultPath(file: unknown): file is TFile | TFolder {
    return file instanceof TFolder || (file instanceof TFile && file.extension === "md");
  }

  private async runLocalInspection(
    generation: number,
    inspectionGeneration: number,
    paths: ReadonlySet<string>,
    includeFolderEvent: boolean,
  ): Promise<void> {
    const coordinator = this.coordinator;
    if (!coordinator
      || generation !== this.configurationGeneration
      || inspectionGeneration !== this.localInspectionGeneration) return;
    try {
      if (await coordinator.hasActionableLocalChangesAtPaths(paths, includeFolderEvent)) {
        if (generation !== this.configurationGeneration
          || inspectionGeneration !== this.localInspectionGeneration
          || coordinator !== this.coordinator) return;
        await coordinator.coordinate();
      }
    } catch (error) {
      console.error("[Work Assistant] Failed to inspect local task changes:", error);
    }
  }

  private stopAutoSync(): void {
    this.autoSync?.stop();
    this.autoSync = null;
  }

  private noticeUnavailable(): void {
    new Notice(t("tasks-notice-no-calendar-ready").replace("{reason}", t("tasks-notice-check-settings")), 8000);
  }
}

function formatResult(result: CoordinationResult): string {
  if (result.status === "busy") {
    return result.error ?? "Task coordination is already running.";
  }
  if (result.status === "failed") {
    return `Task coordination finished with pending work: ${result.error ?? "unknown error"}`;
  }
  return `CalDAV confirmed ${result.remoteTaskCount} tasks; created ${result.created}, completed ${result.completedRemote} remotely and ${result.completedLocal} locally.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
