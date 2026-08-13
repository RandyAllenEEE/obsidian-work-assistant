import { normalizePath } from "obsidian";
import type { App } from "obsidian";

import { RevisionedJsonStore } from "../../RevisionedJsonStore";

export const TASK_STATE_SCHEMA_VERSION = 1;

export interface TaskLink {
  localTaskId: string;
  remoteUid: string;
  sourceId: string;
  localPath?: string;
  completed?: boolean;
}

export interface PendingCreateIntent {
  localTaskId: string;
  remoteUid: string;
  sourceId: string;
  localPath?: string;
  createdAt: string;
  /** Persisted only after the CalDAV server accepts the create request. */
  remoteWriteAcceptedAt?: string;
}

export interface PendingCompletion {
  remoteUid: string;
  localTaskId?: string;
  remoteCompleted: boolean;
  localCompleted: boolean;
  updatedAt: string;
}

export interface TaskTombstone {
  localTaskId: string;
  remoteUid: string;
  sourceId: string;
  retiredAt: string;
}

export interface RemoteDeletionTombstone {
  remoteUid: string;
  localTaskId?: string;
  deletedAt: string;
}

export interface CalendarTaskState {
  links: Record<string, TaskLink>;
  pendingCreates: Record<string, PendingCreateIntent>;
  pendingCompletions: Record<string, PendingCompletion>;
  tombstones: Record<string, TaskTombstone>;
  remoteTombstones: Record<string, RemoteDeletionTombstone>;
  migrationVersion?: number;
}

export interface TaskStateFile {
  schemaVersion: number;
  calendars: Record<string, CalendarTaskState>;
}

function createState(): TaskStateFile {
  return { schemaVersion: TASK_STATE_SCHEMA_VERSION, calendars: {} };
}

function normalizeCalendarState(value: Partial<CalendarTaskState> | undefined): CalendarTaskState {
  return {
    links: value?.links && typeof value.links === "object" ? value.links : {},
    pendingCreates: value?.pendingCreates && typeof value.pendingCreates === "object" ? value.pendingCreates : {},
    pendingCompletions: value?.pendingCompletions && typeof value.pendingCompletions === "object" ? value.pendingCompletions : {},
    tombstones: value?.tombstones && typeof value.tombstones === "object" ? value.tombstones : {},
    remoteTombstones: value?.remoteTombstones && typeof value.remoteTombstones === "object" ? value.remoteTombstones : {},
    migrationVersion: value?.migrationVersion,
  };
}

function isTaskState(value: unknown): value is TaskStateFile {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<TaskStateFile>;
  return candidate.schemaVersion === TASK_STATE_SCHEMA_VERSION
    && isRecord(candidate.calendars)
    && Object.values(candidate.calendars).every(isCalendarState);
}

function isCalendarState(value: unknown): value is CalendarTaskState {
  if (!isRecord(value)) return false;
  return isRecordOf(value.links, isTaskLink)
    && isRecordOf(value.pendingCreates, isPendingCreate)
    && isRecordOf(value.pendingCompletions, isPendingCompletion)
    && isRecordOf(value.tombstones, isTaskTombstone)
    && isRecordOf(value.remoteTombstones, isRemoteDeletionTombstone)
    && (value.migrationVersion === undefined || Number.isInteger(value.migrationVersion));
}

function isTaskLink(value: unknown): value is TaskLink {
  return isRecord(value)
    && isNonEmptyString(value.localTaskId)
    && isNonEmptyString(value.remoteUid)
    && isNonEmptyString(value.sourceId)
    && isOptionalString(value.localPath)
    && isOptionalBoolean(value.completed);
}

function isPendingCreate(value: unknown): value is PendingCreateIntent {
  return isRecord(value)
    && isNonEmptyString(value.localTaskId)
    && isNonEmptyString(value.remoteUid)
    && isNonEmptyString(value.sourceId)
    && isOptionalString(value.localPath)
    && isNonEmptyString(value.createdAt)
    && isOptionalString(value.remoteWriteAcceptedAt);
}

function isPendingCompletion(value: unknown): value is PendingCompletion {
  return isRecord(value)
    && isNonEmptyString(value.remoteUid)
    && isOptionalString(value.localTaskId)
    && typeof value.remoteCompleted === "boolean"
    && typeof value.localCompleted === "boolean"
    && isNonEmptyString(value.updatedAt);
}

function isTaskTombstone(value: unknown): value is TaskTombstone {
  return isRecord(value)
    && isNonEmptyString(value.localTaskId)
    && isNonEmptyString(value.remoteUid)
    && isNonEmptyString(value.sourceId)
    && isNonEmptyString(value.retiredAt);
}

function isRemoteDeletionTombstone(value: unknown): value is RemoteDeletionTombstone {
  return isRecord(value)
    && isNonEmptyString(value.remoteUid)
    && isOptionalString(value.localTaskId)
    && isNonEmptyString(value.deletedAt);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isRecordOf<T>(value: unknown, validator: (entry: unknown) => entry is T): value is Record<string, T> {
  return isRecord(value) && Object.values(value).every(validator);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

/**
 * Correctness-only task state. It intentionally does not cache remote task
 * payloads: the CalDAV query remains the sole source for the sidebar.
 */
export class TaskStateStore {
  private readonly store: RevisionedJsonStore<TaskStateFile>;

  constructor(app: App, pluginDir: string) {
    this.store = new RevisionedJsonStore(
      app.vault.adapter,
      normalizePath(`${pluginDir}/task-state.json`),
      {
        create: createState,
        validate: isTaskState,
        onWriteError: (error) => console.error("[Work Assistant] Failed to save task state:", error),
      },
    );
  }

  async load(): Promise<void> {
    await this.store.load();
  }

  getLoadError(): Error | null {
    return this.store.getLoadError();
  }

  getCalendar(calendarId: string): CalendarTaskState {
    const state = this.store.get();
    return cloneCalendarState(normalizeCalendarState(state.calendars[calendarId]));
  }

  async updateCalendar(
    calendarId: string,
    mutator: (state: CalendarTaskState) => void,
  ): Promise<void> {
    const state = this.store.get();
    const calendar = cloneCalendarState(normalizeCalendarState(state.calendars[calendarId]));
    const before = JSON.stringify(calendar);
    mutator(calendar);
    if (JSON.stringify(calendar) === before) {
      // A prior save may have failed after updating the in-memory model.
      // Retrying an idempotent mutation must still flush that dirty revision.
      await this.store.save();
      return;
    }
    this.store.replace({
      ...state,
      schemaVersion: TASK_STATE_SCHEMA_VERSION,
      calendars: { ...state.calendars, [calendarId]: calendar },
    });
    await this.store.save();
  }

  async retrySave(): Promise<void> {
    await this.store.save();
  }
}

function cloneCalendarState(state: CalendarTaskState): CalendarTaskState {
  return {
    links: Object.fromEntries(Object.entries(state.links).map(([key, value]) => [key, { ...value }])),
    pendingCreates: Object.fromEntries(
      Object.entries(state.pendingCreates).map(([key, value]) => [key, { ...value }]),
    ),
    pendingCompletions: Object.fromEntries(
      Object.entries(state.pendingCompletions).map(([key, value]) => [key, { ...value }]),
    ),
    tombstones: Object.fromEntries(
      Object.entries(state.tombstones).map(([key, value]) => [key, { ...value }]),
    ),
    remoteTombstones: Object.fromEntries(
      Object.entries(state.remoteTombstones).map(([key, value]) => [key, { ...value }]),
    ),
    migrationVersion: state.migrationVersion,
  };
}
