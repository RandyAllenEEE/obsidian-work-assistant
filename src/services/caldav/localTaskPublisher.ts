import type { App } from "obsidian";

import { ObsidianTasksWrapper, type ObsidianTask } from "./tasks/obsidianTasksWrapper";
import { ObsidianMapper } from "./tasks/obsidianMapper";
import { extractTaskId, generateTaskId } from "./utils/taskIdGenerator";
import { normalizeTagIdentifier, stripTagIdentifier } from "./utils/tagIdentifier";
import { shouldExcludeTaskPath } from "./utils/taskPathFilter";
import type { CommonTask } from "./sync/types";

export interface LocalTaskPublisherSettings {
  syncTag?: string;
  excludedPaths?: string[];
  includeObsidianLink?: boolean;
  getVaultName: () => string;
}

export interface LocalTaskCandidate {
  localTaskId: string;
  task: CommonTask;
  original: ObsidianTask;
}

export interface LocalTaskSnapshot {
  available: boolean;
  candidates: LocalTaskCandidate[];
  tasksById: Map<string, ObsidianTask>;
  eligibleTaskIds: Set<string>;
  /** Completed local IDs that share their raw identity with a new open task. */
  completedTaskIds: Set<string>;
}

export interface LocalTaskInspection {
  available: boolean;
  openTasks: ObsidianTask[];
  tasksById: Map<string, ObsidianTask>;
  eligibleTaskIds: Set<string>;
  /** IDs that also belong to a completed local instance. */
  completedTaskIds: Set<string>;
}

/**
 * Reads locally authored Tasks and persists an ID before they become network
 * candidates. It deliberately has no API for importing remote VTODOs.
 */
export class LocalTaskPublisher {
  private readonly wrapper: ObsidianTasksWrapper;
  private readonly mapper = new ObsidianMapper();

  constructor(
    app: App,
    private readonly settings: LocalTaskPublisherSettings,
  ) {
    this.wrapper = new ObsidianTasksWrapper(app);
  }

  isAvailable(): boolean {
    return this.wrapper.initialize();
  }

  /** `isDone` includes cancellation in obsidian-tasks; only completion may
   * advance the one-way CalDAV completion state. */
  isCompleted(task: ObsidianTask): boolean {
    if (!task.isDone) return false;
    const type = task.status?.configuration?.type?.toUpperCase().replace(/[- ]/g, "_");
    return type !== "CANCELLED" && type !== "CANCELED";
  }

  /**
   * Cheap preflight for vault events. It consults only the Tasks cache and
   * never reads Markdown bodies, so unrelated edits do not start a full
   * reconciliation pass.
   */
  async hasEligibleTaskAtPaths(paths: ReadonlySet<string>): Promise<boolean> {
    if (paths.size === 0 || !this.isAvailable()) return false;
    const { globalFilter } = await this.wrapper.getTasksPluginConfig();
    const globalTag = normalizeTagIdentifier(globalFilter);
    const syncTag = normalizeTagIdentifier(this.settings.syncTag ?? "");
    return this.wrapper.getAllTasks().some((task) =>
      paths.has(task.taskLocation.path)
        && this.wrapper.hasMarkdownFileAtPath(task.taskLocation.path)
        && this.isEligibleTask(task, syncTag, globalTag),
    );
  }

  /** See ObsidianTasksWrapper.hasTaskIdentityAtPath for the tri-state result. */
  async hasTaskIdentityAtPath(path: string, taskId: string): Promise<boolean | null> {
    return this.wrapper.hasTaskIdentityAtPath(path, taskId);
  }

  /**
   * Revalidate publication candidates after the server query and immediately
   * before any remote create. Files are grouped by the wrapper, so this race
   * check costs one read per Markdown file rather than one read per task.
   */
  async confirmPresentCandidates(
    candidates: readonly LocalTaskCandidate[],
  ): Promise<Set<LocalTaskCandidate>> {
    const current = await this.wrapper.getTasksWithCurrentFileState(
      candidates.map((candidate) => candidate.original),
    );
    const identityByTask = new Map(current.map((entry) => [entry.task, entry.identity]));
    return new Set(candidates.filter((candidate) => {
      const identity = identityByTask.get(candidate.original);
      return identity?.found === true && identity.id === candidate.localTaskId;
    }));
  }

  async scan(
    continuedTaskIds: ReadonlySet<string> = new Set(),
    publishedTaskIds: ReadonlySet<string> = new Set(),
    publishedTaskPaths: ReadonlyMap<string, string | undefined> = new Map(),
  ): Promise<LocalTaskSnapshot> {
    const inspection = await this.inspect();
    if (!inspection.available) {
      return {
        available: false,
        candidates: [],
        tasksById: new Map(),
        eligibleTaskIds: new Set(),
        completedTaskIds: new Set(),
      };
    }

    const { format, globalFilter } = await this.wrapper.getTasksPluginConfig();
    const scannable = [...inspection.openTasks];
    for (const task of inspection.openTasks) {
      const localTaskId = this.wrapper.extractId(task);
      if (!localTaskId || !inspection.completedTaskIds.has(localTaskId)) continue;
      const completed = inspection.tasksById.get(localTaskId);
      if (completed?.isDone && !scannable.includes(completed)) scannable.push(completed);
    }
    for (const localTaskId of continuedTaskIds) {
      const task = inspection.tasksById.get(localTaskId);
      if (task && !task.isDone && inspection.eligibleTaskIds.has(localTaskId) && !scannable.includes(task)) {
        scannable.push(task);
      }
    }

    const tasksByIdentity = new Map<string, ObsidianTask[]>();
    for (const task of scannable) {
      const id = this.wrapper.extractId(task);
      if (!id) continue;
      const matching = tasksByIdentity.get(id) ?? [];
      matching.push(task);
      tasksByIdentity.set(id, matching);
    }
    const duplicateKeepers = new Map<string, ObsidianTask>();
    for (const [id, matching] of tasksByIdentity) {
      if (matching.length < 2) continue;
      const expectedPath = publishedTaskPaths.get(id);
      duplicateKeepers.set(
        id,
        matching.find((task) => this.isCompleted(task))
          ?? matching.find((task) => !!expectedPath && task.taskLocation.path === expectedPath)
          ?? matching[0],
      );
    }

    const eligible = scannable.filter((task) => {
      const localTaskId = this.wrapper.extractId(task);
      return !localTaskId
        || inspection.completedTaskIds.has(localTaskId)
        || !publishedTaskIds.has(localTaskId)
        || continuedTaskIds.has(localTaskId)
        || duplicateKeepers.get(localTaskId) !== undefined;
    });

    const assigned = new Set(inspection.tasksById.keys());
    const currentFileState = await this.wrapper.getTasksWithCurrentFileState(eligible);
    const fileStateByTask = new Map(currentFileState.map((entry) => [entry.task, entry]));
    const allocated: Array<{ original: ObsidianTask; localTaskId: string }> = [];
    for (const original of eligible) {
      let localTaskId = this.wrapper.extractId(original);
      const cachedTaskId = localTaskId;
      const duplicateNeedsIdentity = !!localTaskId
        && duplicateKeepers.has(localTaskId)
        && duplicateKeepers.get(localTaskId) !== original;
      // Candidate publication is deliberately stricter than ordinary cache
      // inspection. A deleted or renamed row may remain in Tasks' cache for a
      // short time; checking the current Markdown line prevents a stale ID
      // from creating a VTODO after the source file is gone.
      const persisted = fileStateByTask.get(original)?.identity;
      if (!persisted?.found) continue;
      if (!localTaskId || duplicateNeedsIdentity) {
        localTaskId = persisted.id;
        if (duplicateNeedsIdentity && localTaskId === cachedTaskId) localTaskId = null;
      }
      if (!localTaskId) {
        do localTaskId = generateTaskId(); while (assigned.has(localTaskId));
        assigned.add(localTaskId);
        await this.wrapper.updateTaskLineInVault(
          original,
          this.withTaskId(original.originalMarkdown, localTaskId, format),
        );
      }
      assigned.add(localTaskId);
      allocated.push({ original, localTaskId });
    }

    const tasksById = new Map(inspection.tasksById);
    const eligibleTaskIds = new Set(inspection.eligibleTaskIds);
    for (const item of allocated) {
      tasksById.set(item.localTaskId, item.original);
      eligibleTaskIds.add(item.localTaskId);
    }

    const candidatesToPublish = allocated.filter(({ localTaskId }) =>
      !publishedTaskIds.has(localTaskId) || continuedTaskIds.has(localTaskId),
    );
    const candidates: LocalTaskCandidate[] = [];
    for (const { original, localTaskId } of candidatesToPublish) {
      const task = this.mapper.toCommonTask(original, localTaskId, fileStateByTask.get(original)?.body ?? "");
      task.recurrenceRule = "";
      task.tags = stripTagIdentifier(stripTagIdentifier(task.tags, this.settings.syncTag ?? ""), globalFilter);
      if (this.settings.includeObsidianLink) {
        task.obsidianUrl = `obsidian://open?vault=${encodeURIComponent(this.settings.getVaultName())}&file=${encodeURIComponent(original.taskLocation.path)}`;
      }
      candidates.push({ localTaskId, task, original });
    }

    return {
      available: true,
      candidates,
      tasksById,
      eligibleTaskIds,
      completedTaskIds: new Set(inspection.completedTaskIds),
    };
  }

  async inspect(): Promise<LocalTaskInspection> {
    if (!this.isAvailable()) {
      return {
        available: false,
        openTasks: [],
        tasksById: new Map(),
        eligibleTaskIds: new Set(),
        completedTaskIds: new Set(),
      };
    }

    const { globalFilter } = await this.wrapper.getTasksPluginConfig();
    const globalTag = normalizeTagIdentifier(globalFilter);
    const syncTag = normalizeTagIdentifier(this.settings.syncTag ?? "");
    const allTasks = this.wrapper.getAllTasks();
    const eligible = allTasks.filter((task) => this.isEligibleTask(task, syncTag, globalTag));
    const tasksById = new Map<string, ObsidianTask>();
    const eligibleTaskIds = new Set<string>();
    const completedTaskIds = new Set<string>();
    for (const task of allTasks) {
      const id = this.wrapper.extractId(task);
      if (!id) continue;
      const existing = tasksById.get(id);
      // A manually completed recurring instance and its new open successor
      // can briefly share one ID. Preserve the completed one for the old
      // remote link while scan assigns the successor a fresh identity.
      if (!existing || (this.isCompleted(task) && !this.isCompleted(existing))) tasksById.set(id, task);
      if (this.isCompleted(task)) completedTaskIds.add(id);
    }
    for (const task of eligible) {
      const id = this.wrapper.extractId(task);
      if (id) eligibleTaskIds.add(id);
    }
    return {
      available: true,
      openTasks: eligible.filter((task) => !task.isDone),
      tasksById,
      eligibleTaskIds,
      completedTaskIds,
    };
  }

  completedDate(task: ObsidianTask): string {
    const date = task.doneDate;
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    if (date && typeof date !== "string" && typeof date.format === "function") {
      return date.format("YYYY-MM-DD");
    }
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  async complete(localTaskId: string): Promise<void> {
    if (!this.isAvailable()) throw new Error("Tasks plugin is not available");
    const task = this.wrapper.findTaskById(localTaskId);
    if (!task || task.isDone) return;
    const toggle = this.wrapper.getToggleCommand();
    if (!toggle) throw new Error("Tasks plugin completion API is not available");
    const { format } = await this.wrapper.getTasksPluginConfig();
    const knownIds = new Set(
      this.wrapper.getAllTasks().map((candidate) => this.wrapper.extractId(candidate)).filter((id): id is string => !!id),
    );
    const toggled = toggle(task.originalMarkdown, task.taskLocation.path);
    await this.wrapper.applyToggleResult(
      task,
      this.assignFreshRecurringId(toggled, localTaskId, format, knownIds),
    );
  }

  private assignFreshRecurringId(
    content: string,
    completedTaskId: string,
    format: "emoji" | "dataview",
    knownIds: Set<string>,
  ): string {
    const lines = content.split("\n");
    let taskLinesSeen = 0;
    for (let index = 0; index < lines.length; index++) {
      if (!/^\s*-\s+\[[^\]]*\]\s+/.test(lines[index])) continue;
      taskLinesSeen++;
      if (taskLinesSeen === 1) continue;

      const existingId = extractTaskId(lines[index]);
      if (existingId && existingId !== completedTaskId && !knownIds.has(existingId)) break;
      let nextId: string;
      do nextId = generateTaskId(); while (knownIds.has(nextId));
      lines[index] = this.withTaskId(lines[index], nextId, format);
      break;
    }
    return lines.join("\n");
  }

  private withTaskId(line: string, taskId: string, format: "emoji" | "dataview"): string {
    if (/\[id::\s*[^\]]+\]/.test(line)) {
      return line.replace(/\[id::\s*[^\]]+\]/, `[id:: ${taskId}]`);
    }
    if (/🆔\s+\S+/.test(line)) {
      return line.replace(/🆔\s+\S+/, `🆔 ${taskId}`);
    }
    return format === "dataview" ? `${line} [id:: ${taskId}]` : `${line} 🆔 ${taskId}`;
  }

  private isEligibleTask(
    task: ObsidianTask,
    syncTag: string,
    globalTag: string,
  ): boolean {
    if (shouldExcludeTaskPath(task.taskLocation.path, this.settings.excludedPaths ?? [])) return false;
    if (!syncTag || syncTag === globalTag) return true;
    return task.tags?.some((tag) => normalizeTagIdentifier(tag) === syncTag) ?? false;
  }
}
