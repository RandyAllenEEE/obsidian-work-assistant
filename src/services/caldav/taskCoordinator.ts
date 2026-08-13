import type { App } from "obsidian";

import { defaultTaskSyncState, tasksStore } from "../../ui/stores";
import {
  LocalTaskPublisher,
  type LocalTaskCandidate,
  type LocalTaskInspection,
  type LocalTaskSnapshot,
} from "./localTaskPublisher";
import { RemoteTaskRepository, type RemoteTaskRecord } from "./remoteTaskRepository";
import {
  TaskStateStore,
  type CalendarTaskState,
  type PendingCreateIntent,
  type PendingCompletion,
  type TaskLink,
} from "./storage/taskStateStore";
import type { CommonTask } from "./sync/types";
import { createRemoteUid, createSourceId } from "./utils/sourceId";

export type CoordinationStatus = "success" | "failed" | "busy";

export interface CoordinationResult {
  status: CoordinationStatus;
  remoteTaskCount: number;
  created: number;
  completedRemote: number;
  completedLocal: number;
  error?: string;
}

export interface TaskPreview {
  remoteTaskCount: number;
  create: Array<{ localTaskId?: string; title: string }>;
  completeRemote: Array<{ remoteUid: string; localTaskId?: string }>;
  completeLocal: Array<{ remoteUid: string; localTaskId: string }>;
}

export interface TaskCoordinatorOptions {
  app: App;
  calendarId: string;
  vaultName: string;
  repository: RemoteTaskRepository;
  localPublisher: LocalTaskPublisher;
  stateStore: TaskStateStore | null;
  stateError?: string;
}

interface Counters {
  created: number;
  completedRemote: number;
  completedLocal: number;
}

type LocalPathEvent =
  | { type: "rename"; oldPath: string; newPath: string }
  | { type: "delete"; path: string };

const EMPTY_COUNTERS: Counters = {
  created: 0,
  completedRemote: 0,
  completedLocal: 0,
};

/**
 * Coordinates all task triggers through a single CalDAV-authoritative
 * transaction. `tasksStore` is written only from a successful server query.
 */
export class TaskCoordinator {
  private readonly app: App;
  private readonly calendarId: string;
  private readonly vaultName: string;
  private readonly repository: RemoteTaskRepository;
  private readonly localPublisher: LocalTaskPublisher;
  private readonly stateStore: TaskStateStore | null;
  private readonly stateError?: string;
  private migrationWarning?: string;
  private transaction: Promise<CoordinationResult> | null = null;
  private coordinateQueued = false;
  private refreshQueued = false;
  private completionRequests = new Map<string, CommonTask>();
  private localPathEvents: LocalPathEvent[] = [];
  private localPathUpdateQueued = false;
  private localPathUpdateFailed = false;
  private previewActive = false;
  private disposed = false;
  private lastConfirmedTasks: CommonTask[] = [];
  private lastConfirmedAt?: string;
  private hasConfirmedRemote = false;

  constructor(options: TaskCoordinatorOptions) {
    this.app = options.app;
    this.calendarId = options.calendarId;
    this.vaultName = options.vaultName;
    this.repository = options.repository;
    this.localPublisher = options.localPublisher;
    this.stateStore = options.stateStore;
    this.stateError = options.stateError;
  }

  dispose(): void {
    this.disposed = true;
    this.coordinateQueued = false;
    this.refreshQueued = false;
    this.completionRequests.clear();
    this.localPathEvents = [];
    this.localPathUpdateQueued = false;
    this.localPathUpdateFailed = false;
  }

  async stop(): Promise<void> {
    this.dispose();
    try {
      await this.transaction;
    } catch {
      // Public operations convert failures to CoordinationResult. This guard
      // keeps shutdown safe if a future internal path rejects directly.
    }
  }

  /** Full local scan, remote query, reconciliation, and final remote publish. */
  async coordinate(): Promise<CoordinationResult> {
    this.queuePendingLocalPathUpdate();
    this.coordinateQueued = true;
    return this.schedule();
  }

  /** Manual commands expose contention instead of silently joining a pass. */
  async coordinateManually(): Promise<CoordinationResult> {
    if (this.transaction || this.previewActive) {
      return this.result("busy", this.lastConfirmedTasks.length, EMPTY_COUNTERS, "Task coordination is already running");
    }
    return this.coordinate();
  }

  /** A server refresh only: it does not publish local task fields. */
  async refreshRemote(): Promise<CoordinationResult> {
    this.queuePendingLocalPathUpdate();
    this.refreshQueued = true;
    return this.schedule();
  }

  async refreshRemoteManually(): Promise<CoordinationResult> {
    if (this.transaction || this.previewActive) {
      return this.result("busy", this.lastConfirmedTasks.length, EMPTY_COUNTERS, "Task coordination is already running");
    }
    return this.refreshRemote();
  }

  /** Sidebar completion is serialized with every other refresh. */
  async completeTask(task: CommonTask): Promise<CoordinationResult> {
    if (task.status === "DONE" || task.status === "CANCELLED") {
      return this.result("success", this.lastConfirmedTasks.length, EMPTY_COUNTERS);
    }
    this.queuePendingLocalPathUpdate();
    this.completionRequests.set(task.uid, task);
    return this.schedule();
  }

  /**
   * Vault events arrive before the Tasks cache is necessarily refreshed. Keep
   * path lifecycle changes in the same queue as network work so a stale cache
   * cannot resurrect a deleted or moved local association.
   */
  async handleLocalRename(oldPath: string, newPath: string): Promise<CoordinationResult> {
    const normalizedOldPath = normalizeVaultPath(oldPath);
    const normalizedNewPath = normalizeVaultPath(newPath);
    if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) {
      return this.result("success", this.lastConfirmedTasks.length, EMPTY_COUNTERS);
    }
    if (!this.hasTrackedPathUnder(normalizedOldPath)) {
      return this.result("success", this.lastConfirmedTasks.length, EMPTY_COUNTERS);
    }
    this.localPathEvents.push({ type: "rename", oldPath: normalizedOldPath, newPath: normalizedNewPath });
    this.queuePendingLocalPathUpdate();
    return this.schedule();
  }

  async handleLocalDelete(path: string): Promise<CoordinationResult> {
    const normalizedPath = normalizeVaultPath(path);
    if (!normalizedPath) return this.result("success", this.lastConfirmedTasks.length, EMPTY_COUNTERS);
    if (!this.hasTrackedPathUnder(normalizedPath)) {
      return this.result("success", this.lastConfirmedTasks.length, EMPTY_COUNTERS);
    }
    this.localPathEvents.push({ type: "delete", path: normalizedPath });
    this.queuePendingLocalPathUpdate();
    return this.schedule();
  }

  async preview(): Promise<TaskPreview> {
    if (this.transaction || this.previewActive) {
      throw new Error("Task coordination is already running");
    }
    this.previewActive = true;
    try {
      return await this.buildPreview();
    } finally {
      this.previewActive = false;
      if (!this.disposed && this.hasPendingRequest()) void this.schedule();
    }
  }

  private async buildPreview(): Promise<TaskPreview> {
    const records = await this.repository.fetch();
    this.assertActive();
    const state = this.getCalendarState();
    const inspection = state && this.localPublisher.isAvailable()
      ? await this.localPublisher.inspect()
      : null;
    const byUid = new Map(records.map((record) => [record.task.uid, record]));
    const create: TaskPreview["create"] = [];
    const completeRemote: TaskPreview["completeRemote"] = [];
    const completeLocal: TaskPreview["completeLocal"] = [];

    if (state && inspection?.available) {
      for (const task of inspection.openTasks) {
        const localTaskId = inspection.tasksById.get(task.id)?.id || task.id || undefined;
        if (!localTaskId || (!state.links[localTaskId] && !state.tombstones[localTaskId])) {
          create.push({ localTaskId, title: task.description });
        }
      }

      for (const link of Object.values(state.links)) {
        const remote = byUid.get(link.remoteUid);
        const local = inspection.tasksById.get(link.localTaskId);
        if (!remote || remote.task.status === "CANCELLED") continue;
        if (remote.task.status === "DONE" && local && !local.isDone) {
          completeLocal.push({ remoteUid: link.remoteUid, localTaskId: link.localTaskId });
        }
        if (remote.task.status !== "DONE" && (link.completed || (local && this.localPublisher.isCompleted(local)))) {
          completeRemote.push({ remoteUid: link.remoteUid, localTaskId: link.localTaskId });
        }
      }

      for (const pending of Object.values(state.pendingCompletions)) {
        if (!completeRemote.some((item) => item.remoteUid === pending.remoteUid) && !pending.remoteCompleted) {
          completeRemote.push({ remoteUid: pending.remoteUid, localTaskId: pending.localTaskId });
        }
      }
    }

    return { remoteTaskCount: this.visibleRecords(records).length, create, completeRemote, completeLocal };
  }

  async hasActionableLocalChanges(): Promise<boolean> {
    const state = this.getCalendarState();
    if (!state || !this.localPublisher.isAvailable()) return false;
    const inspection = await this.localPublisher.inspect();
    if (!inspection.available) return false;

    for (const task of inspection.openTasks) {
      const localTaskId = task.id || undefined;
      if (!localTaskId) return true;
      if (!state.links[localTaskId] && !state.tombstones[localTaskId]) return true;
    }
    if (Object.keys(state.pendingCreates).length || Object.keys(state.pendingCompletions).length) return true;

    for (const link of Object.values(state.links)) {
      const local = inspection.tasksById.get(link.localTaskId);
      if (!inspection.eligibleTaskIds.has(link.localTaskId)) {
        if (local || await this.isTaskIdentityAbsentFromVault(link)) return true;
      }
      if (local && this.localPublisher.isCompleted(local) && !link.completed) return true;
      if (local
        && link.localPath !== local.taskLocation.path
        && this.isCurrentVaultTaskPath(local.taskLocation.path)) return true;
    }
    return false;
  }

  /**
   * File-level event preflight. Existing associations need the full lifecycle
   * check because a tag removal or completion may not be visible from a
   * lightweight path query; brand-new unrelated files only need a cache hit.
   */
  async hasActionableLocalChangesAtPaths(
    paths: ReadonlySet<string>,
    includeFolderEvent = false,
  ): Promise<boolean> {
    const state = this.getCalendarState();
    if (!state || !this.localPublisher.isAvailable()) return false;
    if (includeFolderEvent || [...paths].some((path) => this.hasTrackedPathUnder(normalizeVaultPath(path)))) {
      return this.hasActionableLocalChanges();
    }
    return this.localPublisher.hasEligibleTaskAtPaths(paths);
  }

  getStatus(): string {
    const state = this.getCalendarState();
    if (!state) {
      return this.stateError
        ? `CalDAV authority active\nLocal publishing disabled: ${this.stateError}`
        : "CalDAV authority active\nLocal publishing is unavailable.";
    }
    return [
      "CalDAV authority active",
      `Linked tasks: ${Object.keys(state.links).length}`,
      `Pending creates: ${Object.keys(state.pendingCreates).length}`,
      `Pending completions: ${Object.keys(state.pendingCompletions).length}`,
    ].join("\n");
  }

  private schedule(): Promise<CoordinationResult> {
    if (this.disposed) {
      return Promise.resolve(this.result("busy", this.lastConfirmedTasks.length, EMPTY_COUNTERS, "Task coordinator is stopped"));
    }
    if (this.previewActive) {
      return Promise.resolve(this.result("busy", this.lastConfirmedTasks.length, EMPTY_COUNTERS, "Task coordination is already running"));
    }
    if (!this.transaction) {
      const run = this.drainRequests();
      this.transaction = run.finally(() => {
        this.transaction = null;
        if (!this.disposed && this.hasPendingRequest()) void this.schedule();
      });
    }
    return this.transaction;
  }

  private async drainRequests(): Promise<CoordinationResult> {
    let result = this.result("success", this.lastConfirmedTasks.length, EMPTY_COUNTERS);
    while (!this.disposed && this.hasPendingRequest()) {
      if (this.localPathUpdateQueued) {
        this.localPathUpdateQueued = false;
        result = await this.runLocalPathUpdate();
        if (result.status === "failed") return result;
        continue;
      }
      const completion = this.takeCompletionRequest();
      if (completion) {
        result = await this.runSidebarCompletion(completion);
        continue;
      }
      if (this.coordinateQueued) {
        this.coordinateQueued = false;
        this.refreshQueued = false;
        result = await this.runCoordinationCycle();
        continue;
      }
      this.refreshQueued = false;
      result = await this.runRemoteRefresh();
    }
    return result;
  }

  private hasPendingRequest(): boolean {
    if (this.localPathUpdateFailed) return false;
    return this.localPathUpdateQueued
      || this.coordinateQueued
      || this.refreshQueued
      || this.completionRequests.size > 0;
  }

  private queuePendingLocalPathUpdate(): void {
    if (this.localPathEvents.length === 0) return;
    this.localPathUpdateFailed = false;
    this.localPathUpdateQueued = true;
  }

  /**
   * Renames and deletes are ledger-only operations. They run before a future
   * network transaction, but do not themselves fetch or publish CalDAV data.
   */
  private async runLocalPathUpdate(): Promise<CoordinationResult> {
    try {
      await this.applyPendingLocalPathEvents();
      return this.result("success", this.lastConfirmedTasks.length, EMPTY_COUNTERS);
    } catch (error) {
      // Keep the event batch in memory for the next explicit or scheduled
      // transaction. Retrying immediately would spin if the adapter is down.
      this.localPathUpdateQueued = false;
      this.localPathUpdateFailed = true;
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Work Assistant] Failed to apply local task path changes:", error);
      return this.result("failed", this.lastConfirmedTasks.length, EMPTY_COUNTERS, message);
    }
  }

  private takeCompletionRequest(): CommonTask | null {
    const entry = this.completionRequests.entries().next();
    if (entry.done) return null;
    const [uid, task] = entry.value;
    this.completionRequests.delete(uid);
    return task;
  }

  private async runCoordinationCycle(): Promise<CoordinationResult> {
    this.beginRequest();
    try {
      await this.applyPendingLocalPathEvents();
      const state = this.getCalendarState();
      const continuedCreates = new Set(Object.keys(state?.pendingCreates ?? {}));
      const publishedTasks = new Set([
        ...Object.keys(state?.links ?? {}),
        ...Object.keys(state?.tombstones ?? {}),
      ]);
      const publishedTaskPaths = new Map(
        Object.values(state?.links ?? {}).map((link) => [link.localTaskId, link.localPath]),
      );
      const snapshot = state && this.localPublisher.isAvailable()
        ? await this.localPublisher.scan(continuedCreates, publishedTasks, publishedTaskPaths)
        : null;
      let records = await this.repository.fetch();
      this.assertActive();
      const counters: Counters = { ...EMPTY_COUNTERS };
      let requiresFinalRead = false;
      let migrationReady = true;

      if (state) {
        await this.flushState();
        if (snapshot?.available) {
          migrationReady = await this.importLegacyMappingsOnce(records, snapshot);
        }
        await this.confirmPendingCreates(records);
        await this.applyRemoteDeletionTombstones(records);
        await this.confirmRemoteCompletions(records);
      }
      if (state && snapshot?.available) {
        await this.queueCompletedLocalInstances(snapshot);
      }
      if (state && snapshot?.available && migrationReady) {
        const lifecycle = await this.reconcileLocalLifecycle(snapshot, records);
        counters.created += lifecycle.created;
        requiresFinalRead = lifecycle.requiresFinalRead;
        records = lifecycle.records;
      }
      if (state) {
        counters.completedRemote += await this.reconcileLocalCompletion(
          records,
          snapshot?.available ? snapshot : null,
        );
      }

      // A remote create or completion must be followed by a real read before
      // it can enter the sidebar. This also confirms pending create intents.
      if (counters.created || counters.completedRemote || requiresFinalRead) {
        records = await this.repository.fetch();
        this.assertActive();
      }
      if (state) await this.confirmPendingCreates(records);
      if (state) await this.confirmRemoteCompletions(records);
      if (state && snapshot?.available) {
        counters.completedLocal += await this.reconcileRemoteCompletion(records, snapshot);
      }
      const visibleRecords = this.visibleRecords(records);
      this.publish(visibleRecords.map((record) => record.task));
      return this.result("success", visibleRecords.length, counters);
    } catch (error) {
      return this.fail(error);
    }
  }

  private async runRemoteRefresh(): Promise<CoordinationResult> {
    this.beginRequest();
    try {
      const records = await this.repository.fetch();
      this.assertActive();
      const state = this.getCalendarState();
      if (state) {
        await this.flushState();
        await this.confirmPendingCreates(records);
        await this.applyRemoteDeletionTombstones(records);
        await this.confirmRemoteCompletions(records);
      }
      let completedLocal = 0;
      if (state && this.localPublisher.isAvailable()) {
        completedLocal = await this.reconcileRemoteCompletion(records, await this.localPublisher.inspect());
      }
      this.assertActive();
      const visibleRecords = this.visibleRecords(records);
      this.publish(visibleRecords.map((record) => record.task));
      return this.result("success", visibleRecords.length, { ...EMPTY_COUNTERS, completedLocal });
    } catch (error) {
      return this.fail(error);
    }
  }

  private async runSidebarCompletion(requestedTask: CommonTask): Promise<CoordinationResult> {
    this.beginRequest();
    try {
      const state = this.getCalendarState();
      const link = state ? this.findLinkByRemoteUid(state, requestedTask.uid) : undefined;
      if (state) {
        await this.queueCompletion({
          remoteUid: requestedTask.uid,
          localTaskId: link?.localTaskId,
          remoteCompleted: false,
          localCompleted: !link,
          updatedAt: new Date().toISOString(),
        });
      }
      let records = await this.repository.fetch();
      this.assertActive();
      const record = records.find((item) => item.task.uid === requestedTask.uid);
      if (!record) {
        if (state) await this.discardCompletion(requestedTask.uid, true);
        throw new Error(`CalDAV task ${requestedTask.uid} no longer exists`);
      }
      const counters: Counters = { ...EMPTY_COUNTERS };

      if (record.task.status !== "DONE" && record.task.status !== "CANCELLED") {
        this.assertActive();
        await this.repository.complete(record, this.today());
        counters.completedRemote++;
        records = await this.repository.fetch();
        this.assertActive();
      } else if (state && record.task.status === "DONE") {
        await this.markRemoteCompleted(record.task.uid);
      } else if (state) {
        await this.discardCompletion(record.task.uid, false);
      }

      if (state) await this.confirmRemoteCompletions(records);

      if (state && this.localPublisher.isAvailable()) {
        counters.completedLocal += await this.reconcileRemoteCompletion(records, await this.localPublisher.inspect());
      }
      const visibleRecords = this.visibleRecords(records);
      this.publish(visibleRecords.map((item) => item.task));
      return this.result("success", visibleRecords.length, counters);
    } catch (error) {
      return this.fail(error);
    }
  }

  private async reconcileLocalLifecycle(
    snapshot: LocalTaskSnapshot,
    records: RemoteTaskRecord[],
  ): Promise<{ created: number; requiresFinalRead: boolean; records: RemoteTaskRecord[] }> {
    const state = this.getCalendarState();
    if (!state) return { created: 0, requiresFinalRead: false, records };
    const bySource = new Map(
      records.filter((record) => !!record.sourceId).map((record) => [record.sourceId as string, record]),
    );

    // A task that disappeared before its persisted create intent was sent is
    // not recreated later. Its identity becomes a local tombstone instead.
    for (const pending of Object.values(state.pendingCreates)) {
      const local = snapshot.tasksById.get(pending.localTaskId);
      if (local && !local.isDone && snapshot.eligibleTaskIds.has(pending.localTaskId)) {
        if (this.isCurrentVaultTaskPath(local.taskLocation.path)
          || !await this.isTaskIdentityAbsentFromVault(pending)) continue;
      } else if (!local && !await this.isTaskIdentityAbsentFromVault(pending)) {
        continue;
      }
      await this.updateState((calendar) => {
        delete calendar.pendingCreates[pending.localTaskId];
        calendar.tombstones[pending.localTaskId] = {
          localTaskId: pending.localTaskId,
          remoteUid: pending.remoteUid,
          sourceId: pending.sourceId,
          retiredAt: new Date().toISOString(),
        };
      });
    }

    // Local deletion, tag removal, or exclusion never deletes the cloud
    // VTODO. It merely retires the local association.
    for (const link of Object.values(this.getCalendarState()?.links ?? {})) {
      if (snapshot.eligibleTaskIds.has(link.localTaskId)) continue;
      const local = snapshot.tasksById.get(link.localTaskId);
      if (local && this.isCurrentVaultTaskPath(local.taskLocation.path)) {
        await this.retireLocalLink(link);
        continue;
      }
      if (!await this.isTaskIdentityAbsentFromVault(link)) continue;
      await this.retireLocalLink(link);
    }

    for (const link of Object.values(this.getCalendarState()?.links ?? {})) {
      const local = snapshot.tasksById.get(link.localTaskId);
      if (!local
        || local.taskLocation.path === link.localPath
        || !this.isCurrentVaultTaskPath(local.taskLocation.path)) continue;
      await this.updateState((calendar) => {
        const current = calendar.links[link.localTaskId];
        if (current) current.localPath = local.taskLocation.path;
      });
    }

    let created = 0;
    let requiresFinalRead = false;
    const presentCandidates = await this.confirmPresentCandidates(snapshot.candidates);
    for (const candidate of snapshot.candidates) {
      // The scan and network write are asynchronous. Re-check the persisted
      // identity immediately before reserving or creating a VTODO so a vault
      // delete cannot escape through a stale Tasks cache.
      if (!presentCandidates.has(candidate)) continue;
      const current = this.getCalendarState();
      if (!current || current.tombstones[candidate.localTaskId]) continue;
      const existing = current.links[candidate.localTaskId];
      if (existing) {
        if (existing.localPath !== candidate.original.taskLocation.path) {
          await this.updateState((calendar) => {
            const link = calendar.links[candidate.localTaskId];
            if (link) link.localPath = candidate.original.taskLocation.path;
          });
        }
        continue;
      }

      const sourceId = await createSourceId(this.vaultName, candidate.localTaskId);
      const remoteWithSource = bySource.get(sourceId);
      if (remoteWithSource) {
        await this.link(candidate.localTaskId, remoteWithSource.task.uid, sourceId, candidate.original.taskLocation.path);
        continue;
      }

      const existingIntent = current.pendingCreates[candidate.localTaskId];
      const intent = existingIntent ?? {
          localTaskId: candidate.localTaskId,
          remoteUid: createRemoteUid(),
          sourceId,
          localPath: candidate.original.taskLocation.path,
          createdAt: new Date().toISOString(),
      };
      if (!existingIntent) {
        // Persist before network I/O. If this throws, no remote write occurs.
        await this.updateState((calendar) => {
          calendar.pendingCreates[candidate.localTaskId] = intent;
        });
      }

      try {
        await this.repository.create(candidate.task, intent.remoteUid, intent.sourceId);
      } catch (error) {
        const confirmationRecords = await this.repository.fetch();
        this.assertActive();
        const confirmed = this.findCreateConfirmation(confirmationRecords, intent);
        if (confirmed) {
          await this.link(candidate.localTaskId, confirmed.task.uid, intent.sourceId, candidate.original.taskLocation.path);
          // The confirmation query is deliberately not published directly:
          // sidebar state always comes from a complete final server response.
          requiresFinalRead = true;
          continue;
        }
        if (isUidCollision(error)) {
          const conflicting = confirmationRecords.find((record) => record.task.uid === intent.remoteUid);
          if (conflicting && conflicting.sourceId !== intent.sourceId) {
            await this.updateState((calendar) => {
              const pending = calendar.pendingCreates[candidate.localTaskId];
              if (pending) pending.remoteUid = createRemoteUid();
            });
          }
          // If the conflicting resource is not query-visible yet, retain the
          // same UUID. The next cycle can confirm it without creating a twin.
          requiresFinalRead = true;
          continue;
        }
        throw error;
      }
      // Record the successful side effect before relying on UID-only
      // confirmation. This lets us recover from servers that strip unknown
      // X-properties without treating an unrelated UID collision as ours.
      await this.markCreateAccepted(candidate.localTaskId);
      created++;
      // Do not link here. A subsequent server query is required to confirm
      // the create before the intent turns into a durable association.
    }
    return { created, requiresFinalRead, records };
  }

  private async applyPendingLocalPathEvents(): Promise<void> {
    const events = this.localPathEvents.slice();
    if (events.length === 0) return;
    if (!this.stateStore) {
      this.localPathEvents.splice(0, events.length);
      return;
    }

    await this.updateState((calendar) => {
      for (const event of events) {
        if (event.type === "rename") {
          for (const link of Object.values(calendar.links)) {
            if (link.localPath && pathMatchesOrDescends(link.localPath, event.oldPath)) {
              link.localPath = replacePathPrefix(link.localPath, event.oldPath, event.newPath);
            }
          }
          for (const pending of Object.values(calendar.pendingCreates)) {
            if (pending.localPath && pathMatchesOrDescends(pending.localPath, event.oldPath)) {
              pending.localPath = replacePathPrefix(pending.localPath, event.oldPath, event.newPath);
            }
          }
          continue;
        }

        for (const link of Object.values(calendar.links)) {
          if (!link.localPath || !pathMatchesOrDescends(link.localPath, event.path)) continue;
          delete calendar.links[link.localTaskId];
          const pending = calendar.pendingCompletions[link.remoteUid];
          if (pending) {
            if (pending.remoteCompleted || pending.localCompleted) {
              delete calendar.pendingCompletions[link.remoteUid];
            } else {
              // A sidebar completion remains an explicit remote action even
              // when its linked Markdown row disappears before the write.
              pending.localCompleted = true;
              pending.updatedAt = new Date().toISOString();
            }
          }
          calendar.tombstones[link.localTaskId] = {
            localTaskId: link.localTaskId,
            remoteUid: link.remoteUid,
            sourceId: link.sourceId,
            retiredAt: new Date().toISOString(),
          };
        }

        for (const pending of Object.values(calendar.pendingCreates)) {
          if (!pending.localPath || !pathMatchesOrDescends(pending.localPath, event.path)) continue;
          delete calendar.pendingCreates[pending.localTaskId];
          calendar.tombstones[pending.localTaskId] = {
            localTaskId: pending.localTaskId,
            remoteUid: pending.remoteUid,
            sourceId: pending.sourceId,
            retiredAt: new Date().toISOString(),
          };
        }
      }
    });
    this.localPathEvents.splice(0, events.length);
  }

  private isCurrentVaultTaskPath(path: string): boolean {
    const vault = this.app.vault as App["vault"] & {
      getAbstractFileByPath?: (candidate: string) => unknown;
    };
    // Unit-test adapters and older mocks may not expose the indexed lookup.
    // In production it distinguishes a stale Tasks-cache path after rename
    // from a real user move that should update the association.
    return typeof vault.getAbstractFileByPath !== "function"
      || !!vault.getAbstractFileByPath(path);
  }

  private async reconcileLocalCompletion(
    records: RemoteTaskRecord[],
    snapshot: LocalTaskSnapshot | null,
  ): Promise<number> {
    const state = this.getCalendarState();
    if (!state) return 0;
    const byUid = new Map(records.map((record) => [record.task.uid, record]));

    if (snapshot) {
      for (const link of Object.values(state.links)) {
        const remote = byUid.get(link.remoteUid);
        const local = snapshot.tasksById.get(link.localTaskId);
        if (!remote || remote.task.status === "CANCELLED") continue;
        if (remote.task.status === "DONE") {
          await this.markRemoteCompleted(link.remoteUid);
          continue;
        }
        if (link.completed || (local && this.localPublisher.isCompleted(local))) {
          await this.queueCompletion({
            remoteUid: link.remoteUid,
            localTaskId: link.localTaskId,
            remoteCompleted: false,
            localCompleted: !!local && this.localPublisher.isCompleted(local),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

    let completedRemote = 0;
    for (const pending of Object.values(this.getCalendarState()?.pendingCompletions ?? {})) {
      if (pending.remoteCompleted) continue;
      const remote = byUid.get(pending.remoteUid);
      if (!remote || remote.task.status === "CANCELLED") {
        await this.discardCompletion(pending.remoteUid, !remote);
        continue;
      }
      if (remote.task.status === "DONE") {
        await this.markRemoteCompleted(pending.remoteUid);
        continue;
      }
      const local = pending.localTaskId ? snapshot?.tasksById.get(pending.localTaskId) : undefined;
      this.assertActive();
      await this.repository.complete(remote, local ? this.localPublisher.completedDate(local) : this.today());
      completedRemote++;
    }
    return completedRemote;
  }

  /**
   * A local recurring completion can leave a new open instance with the old
   * ID until scan rewrites it. Keep the old linked instance's completion
   * intent even though `tasksById` now points to the completed row.
   */
  private async queueCompletedLocalInstances(snapshot: LocalTaskSnapshot): Promise<void> {
    const state = this.getCalendarState();
    if (!state) return;
    for (const localTaskId of snapshot.completedTaskIds) {
      const link = state.links[localTaskId];
      const local = snapshot.tasksById.get(localTaskId);
      if (!link
        || !local
        || !snapshot.eligibleTaskIds.has(localTaskId)
        || !this.localPublisher.isCompleted(local)
        || link.completed) continue;
      await this.queueCompletion({
        remoteUid: link.remoteUid,
        localTaskId,
        remoteCompleted: false,
        localCompleted: true,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  /** Apply a remote DONE state to its linked Markdown task, never CANCELLED. */
  private async reconcileRemoteCompletion(
    records: RemoteTaskRecord[],
    inspection: Pick<LocalTaskInspection, "available" | "tasksById" | "eligibleTaskIds">,
  ): Promise<number> {
    const state = this.getCalendarState();
    if (!state || !inspection.available) return 0;
    const byUid = new Map(records.map((record) => [record.task.uid, record]));
    let completedLocal = 0;
    for (const link of Object.values(state.links)) {
      const remote = byUid.get(link.remoteUid);
      if (!remote || remote.task.status !== "DONE") continue;
      const local = inspection.tasksById.get(link.localTaskId);
      // A refresh may arrive before the vault-event debounce that retires a
      // removed or excluded association. Never mutate a local task that is
      // no longer eligible for this integration.
      await this.markRemoteCompleted(link.remoteUid);
      if (!local || !inspection.eligibleTaskIds.has(link.localTaskId) || local.isDone) {
        await this.markLocalCompleted(link.remoteUid);
        continue;
      }
      await this.queueCompletion({
        remoteUid: link.remoteUid,
        localTaskId: link.localTaskId,
        remoteCompleted: true,
        localCompleted: false,
        updatedAt: new Date().toISOString(),
      });
      try {
        await this.localPublisher.complete(link.localTaskId);
        await this.markLocalCompleted(link.remoteUid);
        completedLocal++;
      } catch (error) {
        console.error(`[Work Assistant] Failed to complete linked local task ${link.localTaskId}:`, error);
      }
    }
    return completedLocal;
  }

  private async applyRemoteDeletionTombstones(records: RemoteTaskRecord[]): Promise<void> {
    const state = this.getCalendarState();
    if (!state) return;
    const remoteUids = new Set(records.map((record) => record.task.uid));
    for (const link of Object.values(state.links)) {
      if (remoteUids.has(link.remoteUid)) continue;
      if (state.pendingCreates[link.localTaskId]) continue;
      await this.updateState((calendar) => {
        delete calendar.links[link.localTaskId];
        delete calendar.pendingCompletions[link.remoteUid];
        calendar.tombstones[link.localTaskId] = {
          localTaskId: link.localTaskId,
          remoteUid: link.remoteUid,
          sourceId: link.sourceId,
          retiredAt: new Date().toISOString(),
        };
        calendar.remoteTombstones[link.remoteUid] = {
          remoteUid: link.remoteUid,
          localTaskId: link.localTaskId,
          deletedAt: new Date().toISOString(),
        };
      });
    }
  }

  private async confirmPendingCreates(records: RemoteTaskRecord[]): Promise<void> {
    const state = this.getCalendarState();
    if (!state) return;
    for (const intent of Object.values(state.pendingCreates)) {
      const record = this.findCreateConfirmation(records, intent);
      if (!record) continue;
      await this.link(intent.localTaskId, record.task.uid, intent.sourceId, intent.localPath);
    }
  }

  private async confirmRemoteCompletions(records: RemoteTaskRecord[]): Promise<void> {
    const state = this.getCalendarState();
    if (!state) return;
    const byUid = new Map(records.map((record) => [record.task.uid, record]));
    for (const pending of Object.values(state.pendingCompletions)) {
      const record = byUid.get(pending.remoteUid);
      if (!record) {
        await this.discardCompletion(pending.remoteUid, true);
      } else if (record.task.status === "DONE") {
        await this.markRemoteCompleted(pending.remoteUid);
      } else if (record.task.status === "CANCELLED") {
        await this.discardCompletion(pending.remoteUid, false);
      }
    }
  }

  private findCreateConfirmation(
    records: RemoteTaskRecord[],
    intent: Pick<PendingCreateIntent, "remoteUid" | "sourceId" | "remoteWriteAcceptedAt">,
  ): RemoteTaskRecord | null {
    // The source identity is the proof that this resource belongs to this
    // local task. UID alone is not sufficient: a collision with a third-party
    // item must reserve a new UID rather than silently linking to that item.
    const bySource = records.find((record) => record.sourceId === intent.sourceId);
    if (bySource) return bySource;
    if (!intent.remoteWriteAcceptedAt) return null;
    return records.find((record) =>
      record.task.uid === intent.remoteUid && record.sourceId === null
    ) ?? null;
  }

  private async markCreateAccepted(localTaskId: string): Promise<void> {
    await this.updateState((calendar) => {
      const pending = calendar.pendingCreates[localTaskId];
      if (pending && !pending.remoteWriteAcceptedAt) {
        pending.remoteWriteAcceptedAt = new Date().toISOString();
      }
    });
  }

  private async retireLocalLink(link: TaskLink): Promise<void> {
    await this.updateState((calendar) => {
      delete calendar.links[link.localTaskId];
      const pending = calendar.pendingCompletions[link.remoteUid];
      if (pending) {
        // A locally completed task that is then deleted or excluded must not
        // continue an outbound completion retry. Conversely, a pending
        // sidebar action has not touched either side yet, so preserve its
        // remote intent while detaching the now-absent local side.
        if (pending.remoteCompleted || pending.localCompleted) {
          delete calendar.pendingCompletions[link.remoteUid];
        } else {
          pending.localCompleted = true;
          pending.updatedAt = new Date().toISOString();
        }
      }
      calendar.tombstones[link.localTaskId] = {
        localTaskId: link.localTaskId,
        remoteUid: link.remoteUid,
        sourceId: link.sourceId,
        retiredAt: new Date().toISOString(),
      };
    });
  }

  private async link(localTaskId: string, remoteUid: string, sourceId: string, localPath?: string): Promise<void> {
    await this.updateState((calendar) => {
      calendar.links[localTaskId] = { localTaskId, remoteUid, sourceId, localPath };
      delete calendar.pendingCreates[localTaskId];
    });
  }

  private async queueCompletion(completion: PendingCompletion): Promise<void> {
    await this.updateState((calendar) => {
      const existing = calendar.pendingCompletions[completion.remoteUid];
      calendar.pendingCompletions[completion.remoteUid] = {
        ...completion,
        localTaskId: completion.localTaskId ?? existing?.localTaskId,
        remoteCompleted: completion.remoteCompleted || existing?.remoteCompleted || false,
        localCompleted: completion.localCompleted || existing?.localCompleted || false,
      };
    });
  }

  private async markRemoteCompleted(remoteUid: string): Promise<void> {
    await this.updateState((calendar) => {
      const link = this.findLinkByRemoteUid(calendar, remoteUid);
      if (link) link.completed = true;
      const pending = calendar.pendingCompletions[remoteUid];
      if (!pending) return;
      pending.remoteCompleted = true;
      pending.updatedAt = new Date().toISOString();
      if (pending.localCompleted || !pending.localTaskId) delete calendar.pendingCompletions[remoteUid];
    });
  }

  private async markLocalCompleted(remoteUid: string): Promise<void> {
    await this.updateState((calendar) => {
      const link = this.findLinkByRemoteUid(calendar, remoteUid);
      if (link) link.completed = true;
      const pending = calendar.pendingCompletions[remoteUid];
      if (!pending) return;
      pending.localCompleted = true;
      pending.updatedAt = new Date().toISOString();
      if (pending.remoteCompleted) delete calendar.pendingCompletions[remoteUid];
    });
  }

  private async discardCompletion(remoteUid: string, remoteDeleted: boolean): Promise<void> {
    await this.updateState((calendar) => {
      const pending = calendar.pendingCompletions[remoteUid];
      if (remoteDeleted) {
        calendar.remoteTombstones[remoteUid] = {
          remoteUid,
          localTaskId: pending?.localTaskId,
          deletedAt: new Date().toISOString(),
        };
      }
      delete calendar.pendingCompletions[remoteUid];
    });
  }

  private findLinkByRemoteUid(state: CalendarTaskState, remoteUid: string): TaskLink | undefined {
    return Object.values(state.links).find((link) => link.remoteUid === remoteUid);
  }

  private getCalendarState(): CalendarTaskState | null {
    if (!this.stateStore) return null;
    return this.stateStore.getCalendar(this.calendarId);
  }

  private hasTrackedPathUnder(path: string): boolean {
    const state = this.getCalendarState();
    if (!state) return false;
    return [
      ...Object.values(state.links).map((entry) => entry.localPath),
      ...Object.values(state.pendingCreates).map((entry) => entry.localPath),
    ].some((candidate) => {
      const currentPath = candidate ? this.applyQueuedPathEvents(candidate) : null;
      return !!currentPath && pathMatchesOrDescends(currentPath, path);
    });
  }

  /**
   * A Tasks cache can briefly omit an ID immediately after a vault rename.
   * Read the linked file only in that ambiguous case; an unreadable file is
   * treated as unknown so it cannot accidentally retire an association.
   */
  private async isTaskIdentityAbsentFromVault(
    task: Pick<TaskLink, "localPath" | "localTaskId">,
  ): Promise<boolean> {
    if (!task.localPath) return true;
    const publisher = this.localPublisher as LocalTaskPublisher & {
      hasTaskIdentityAtPath?: (path: string, taskId: string) => Promise<boolean | null>;
    };
    if (!publisher.hasTaskIdentityAtPath) return true;
    return (await publisher.hasTaskIdentityAtPath(task.localPath, task.localTaskId)) === false;
  }

  private async confirmPresentCandidates(
    candidates: readonly LocalTaskCandidate[],
  ): Promise<Set<LocalTaskCandidate>> {
    const publisher = this.localPublisher as LocalTaskPublisher & {
      confirmPresentCandidates?: (
        values: readonly LocalTaskCandidate[],
      ) => Promise<Set<LocalTaskCandidate>>;
    };
    // This fallback keeps integrations compiled against the pre-4.5 internal
    // publisher seam functional; the production publisher always verifies.
    if (!publisher.confirmPresentCandidates) return new Set(candidates);
    return publisher.confirmPresentCandidates(candidates);
  }

  private applyQueuedPathEvents(path: string): string | null {
    let currentPath = normalizeVaultPath(path);
    for (const event of this.localPathEvents) {
      if (event.type === "rename" && pathMatchesOrDescends(currentPath, event.oldPath)) {
        currentPath = replacePathPrefix(currentPath, event.oldPath, event.newPath);
      } else if (event.type === "delete" && pathMatchesOrDescends(currentPath, event.path)) {
        return null;
      }
    }
    return currentPath;
  }

  private async updateState(mutator: (state: CalendarTaskState) => void): Promise<void> {
    if (!this.stateStore) return;
    this.assertActive();
    await this.stateStore.updateCalendar(this.calendarId, mutator);
    this.assertActive();
  }

  private async importLegacyMappingsOnce(records: RemoteTaskRecord[], snapshot: LocalTaskSnapshot): Promise<boolean> {
    const state = this.getCalendarState();
    if (!state) return true;
    if (state.migrationVersion === 1) {
      this.migrationWarning = undefined;
      return true;
    }
    const adapter = this.app.vault.adapter;
    const paths = [
      `.caldav-sync/calendars/${this.calendarId}/id-mapping.json`,
      `.caldav-sync/calendars/${this.calendarId}/mapping.json`,
      ".caldav-sync/id-mapping.json",
      ".caldav-sync/mapping.json",
    ];
    const remoteUids = new Set(records.map((record) => record.task.uid));
    const mappings = new Map<string, string>();
    try {
      for (const path of paths) {
        if (!(await adapter.exists(path))) continue;
        const parsed = parseLegacyMappings(JSON.parse(await adapter.read(path)), path);
        for (const [localTaskId, remoteUid] of Object.entries(parsed)) {
          const existing = mappings.get(localTaskId);
          if (existing && existing !== remoteUid) {
            throw new Error(`Conflicting legacy CalDAV mapping for ${localTaskId}`);
          }
          mappings.set(localTaskId, remoteUid);
        }
      }
      const verified: TaskLink[] = [];
      for (const [localTaskId, remoteUid] of mappings) {
        const local = snapshot.tasksById.get(localTaskId);
        if (!remoteUids.has(remoteUid) || !local) continue;
        verified.push({
          localTaskId,
          remoteUid,
          sourceId: await createSourceId(this.vaultName, localTaskId),
          localPath: local.taskLocation.path,
        });
      }
      await this.updateState((calendar) => {
        for (const link of verified) {
          if (!calendar.tombstones[link.localTaskId]) calendar.links[link.localTaskId] = link;
        }
        calendar.migrationVersion = 1;
      });
      this.migrationWarning = undefined;
      return true;
    } catch (error) {
      this.setMigrationWarning(error);
      return false;
    }
  }

  private beginRequest(): void {
    tasksStore.update((state) => ({
      ...state,
      loading: !state.ready,
      syncing: true,
      error: undefined,
      warning: this.warningMessage(),
    }));
  }

  private publish(tasks: CommonTask[]): void {
    if (this.disposed) return;
    this.lastConfirmedTasks = tasks;
    this.lastConfirmedAt = new Date().toISOString();
    this.hasConfirmedRemote = true;
    tasksStore.set({
      ...defaultTaskSyncState,
      tasks,
      ready: true,
      lastSyncTime: this.lastConfirmedAt,
      warning: this.warningMessage(),
    });
  }

  private fail(error: unknown): CoordinationResult {
    const message = error instanceof Error ? error.message : String(error);
    if (this.disposed) {
      return this.result("busy", this.lastConfirmedTasks.length, EMPTY_COUNTERS, "Task coordinator is stopped");
    }
    if (this.hasConfirmedRemote) {
      tasksStore.set({
        ...defaultTaskSyncState,
        tasks: this.lastConfirmedTasks,
        ready: true,
        lastSyncTime: this.lastConfirmedAt,
        stale: true,
        error: message,
        warning: this.warningMessage(),
      });
    } else {
      tasksStore.set({
        ...defaultTaskSyncState,
        error: message,
        warning: this.warningMessage(),
      });
    }
    return this.result("failed", this.lastConfirmedTasks.length, EMPTY_COUNTERS, message);
  }

  private result(
    status: CoordinationStatus,
    remoteTaskCount: number,
    counters: Counters,
    error?: string,
  ): CoordinationResult {
    return { status, remoteTaskCount, ...counters, error };
  }

  private today(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  private visibleRecords(records: RemoteTaskRecord[]): RemoteTaskRecord[] {
    return records.filter((record) => record.visible);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Task coordinator is stopped");
  }

  private async flushState(): Promise<void> {
    if (!this.stateStore) return;
    this.assertActive();
    await this.stateStore.retrySave();
    this.assertActive();
  }

  private setMigrationWarning(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.migrationWarning = `Legacy CalDAV mapping could not be verified; local task publishing is paused: ${message}`;
    console.warn("[Work Assistant] Could not verify legacy CalDAV mapping:", error);
  }

  private warningMessage(): string | undefined {
    return [this.stateError, this.migrationWarning].filter(Boolean).join("\n") || undefined;
  }
}

function isUidCollision(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b409\b|\b412\b|if-none-match|already exists|precondition failed)/i.test(message);
}

function parseLegacyMappings(value: unknown, path: string): Record<string, string> {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid legacy CalDAV mapping in ${path}`);
  }
  const raw = value as {
    taskIdToCaldavUid?: unknown;
    tasks?: unknown;
  };
  if (raw.taskIdToCaldavUid !== undefined) {
    return stringRecord(raw.taskIdToCaldavUid, path);
  }
  if (raw.tasks !== undefined && raw.tasks && typeof raw.tasks === "object") {
    const mappings: Record<string, string> = {};
    for (const [localTaskId, entry] of Object.entries(raw.tasks as Record<string, unknown>)) {
      const remoteUid = entry && typeof entry === "object"
        ? (entry as { caldavUID?: unknown }).caldavUID
        : undefined;
      if (typeof remoteUid !== "string" || !remoteUid) {
        throw new Error(`Invalid legacy CalDAV mapping in ${path}`);
      }
      mappings[localTaskId] = remoteUid;
    }
    return mappings;
  }
  throw new Error(`Invalid legacy CalDAV mapping in ${path}`);
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid legacy CalDAV mapping in ${path}`);
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string" || !entry) {
      throw new Error(`Invalid legacy CalDAV mapping in ${path}`);
    }
    result[key] = entry;
  }
  return result;
}

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function pathMatchesOrDescends(path: string, prefix: string): boolean {
  const normalizedPath = normalizeVaultPath(path);
  return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  const normalizedPath = normalizeVaultPath(path);
  return normalizedPath === oldPrefix
    ? newPrefix
    : `${newPrefix}${normalizedPath.slice(oldPrefix.length)}`;
}
