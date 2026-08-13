jest.mock("obsidian", () => ({
  normalizePath: (path: string) => path,
  TFile: class TFile {},
}));

let mockTaskState: any;
const mockTasksStoreSet = jest.fn((next: any) => { mockTaskState = next; });
const mockTasksStoreUpdate = jest.fn((updater: (current: any) => any) => {
  mockTaskState = updater(mockTaskState);
});

jest.mock("../ui/stores", () => ({
  defaultTaskSyncState: {
    tasks: [],
    ready: false,
    loading: false,
    syncing: false,
    stale: false,
  },
  tasksStore: {
    set: mockTasksStoreSet,
    update: mockTasksStoreUpdate,
  },
}));

import { TaskCoordinator } from "../services/caldav/taskCoordinator";
import { TaskStateStore, type CalendarTaskState } from "../services/caldav/storage/taskStateStore";
import type { LocalTaskCandidate, LocalTaskSnapshot } from "../services/caldav/localTaskPublisher";
import type { RemoteTaskRecord } from "../services/caldav/remoteTaskRepository";
import type { CommonTask } from "../services/caldav/sync/types";

const CALENDAR_ID = "work";
const STATE_PATH = ".obsidian/plugins/work-assistant/task-state.json";

function task(overrides: Partial<CommonTask> = {}): CommonTask {
  return {
    uid: "remote-1",
    title: "Server task",
    status: "TODO",
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    createdDate: null,
    completedDate: null,
    priority: "none",
    tags: [],
    recurrenceRule: "",
    body: "",
    ...overrides,
  };
}

function record(
  remoteTask: CommonTask,
  sourceId: string | null = null,
  visible = true,
): RemoteTaskRecord {
  return {
    task: remoteTask,
    sourceId,
    visible,
    object: {
      data: `BEGIN:VTODO\nUID:${remoteTask.uid}\nEND:VTODO`,
      url: `https://example.test/${remoteTask.uid}.ics`,
      etag: `etag-${remoteTask.uid}`,
    },
  };
}

function localTask(id: string, isDone = false, path = "Tasks.md"): any {
  return {
    id,
    description: "Local task",
    isDone,
    status: { configuration: { type: "TODO" } },
    doneDate: isDone ? "2026-08-12" : null,
    taskLocation: { path, _lineNumber: 0 },
    originalMarkdown: `- [${isDone ? "x" : " "}] Local task`,
    tags: ["sync"],
  };
}

function candidate(id: string, overrides: Partial<CommonTask> = {}): LocalTaskCandidate {
  const original = localTask(id);
  return {
    localTaskId: id,
    original,
    task: task({ uid: id, title: "Local task", ...overrides }),
  };
}

function snapshot(
  candidates: LocalTaskCandidate[] = [],
  tasks: any[] = candidates.map((item) => item.original),
  completedTaskIds = new Set<string>(),
): LocalTaskSnapshot {
  return {
    available: true,
    candidates,
    tasksById: new Map(tasks.filter((item) => item.id).map((item) => [item.id, item])),
    eligibleTaskIds: new Set(tasks.filter((item) => item.id).map((item) => item.id)),
    completedTaskIds,
  };
}

function createDisk(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  const writes: string[] = [];
  const adapter = {
    exists: jest.fn(async (path: string) => files.has(path)),
    read: jest.fn(async (path: string) => files.get(path) ?? ""),
    write: jest.fn(async (path: string, content: string) => {
      writes.push(content);
      files.set(path, content);
    }),
  };
  const app = { vault: { adapter } } as any;
  return { adapter, app, files, writes };
}

async function createStateStore(
  disk: ReturnType<typeof createDisk>,
  seed?: (state: CalendarTaskState) => void,
): Promise<TaskStateStore> {
  const stateStore = new TaskStateStore(disk.app, ".obsidian/plugins/work-assistant");
  await stateStore.load();
  await stateStore.updateCalendar(CALENDAR_ID, (state) => {
    state.migrationVersion = 1;
    seed?.(state);
  });
  disk.adapter.write.mockClear();
  disk.writes.length = 0;
  return stateStore;
}

function createLocalPublisher(localSnapshot: LocalTaskSnapshot, available = true) {
  const inspection = {
    available,
    openTasks: [...localSnapshot.tasksById.values()].filter((item) => !item.isDone),
    tasksById: localSnapshot.tasksById,
    eligibleTaskIds: localSnapshot.eligibleTaskIds,
    completedTaskIds: localSnapshot.completedTaskIds,
  };
  return {
    isAvailable: jest.fn(() => available),
    hasEligibleTaskAtPaths: jest.fn(async () => false),
    hasTaskIdentityAtPath: jest.fn(async () => true),
    confirmPresentCandidates: jest.fn(async (candidates) => new Set(candidates)),
    scan: jest.fn(async () => localSnapshot),
    inspect: jest.fn(async () => inspection),
    complete: jest.fn(async () => undefined),
    completedDate: jest.fn(() => "2026-08-12"),
    isCompleted: jest.fn((task) => task.isDone && task.status?.configuration?.type !== "CANCELLED"),
  };
}

function createRepository(fetch: () => Promise<RemoteTaskRecord[]>) {
  return {
    fetch: jest.fn(fetch),
    create: jest.fn<Promise<void>, [CommonTask, string, string]>(async () => undefined),
    complete: jest.fn<Promise<void>, [RemoteTaskRecord, string]>(async () => undefined),
  };
}

function createCoordinator(
  disk: ReturnType<typeof createDisk>,
  repository: ReturnType<typeof createRepository>,
  localPublisher: ReturnType<typeof createLocalPublisher>,
  stateStore: TaskStateStore | null,
) {
  return new TaskCoordinator({
    app: disk.app,
    calendarId: CALENDAR_ID,
    vaultName: "Vault",
    repository: repository as any,
    localPublisher: localPublisher as any,
    stateStore,
  });
}

function persistedCalendar(disk: ReturnType<typeof createDisk>): CalendarTaskState {
  return JSON.parse(disk.files.get(STATE_PATH) ?? "{}").calendars[CALENDAR_ID];
}

describe("TaskCoordinator CalDAV authority", () => {
  beforeEach(() => {
    mockTaskState = {
      tasks: [],
      ready: false,
      loading: false,
      syncing: false,
      stale: false,
    };
    mockTasksStoreSet.mockClear();
    mockTasksStoreUpdate.mockClear();
  });

  test("publishes only visible server tasks and never imports third-party tasks into Markdown", async () => {
    const disk = createDisk();
    const localPublisher = createLocalPublisher(snapshot(), false);
    const visible = record(task({ uid: "third-party", title: "Third party" }));
    const hidden = record(task({ uid: "other-category", title: "Other" }), null, false);
    const repository = createRepository(async () => [visible, hidden]);
    const coordinator = createCoordinator(disk, repository, localPublisher, null);

    const result = await coordinator.coordinate();

    expect(result).toMatchObject({ status: "success", remoteTaskCount: 1 });
    expect(mockTaskState.tasks.map((item: CommonTask) => item.uid)).toEqual(["third-party"]);
    expect(localPublisher.scan).not.toHaveBeenCalled();
    expect(localPublisher.complete).not.toHaveBeenCalled();
    expect(disk.adapter.write).not.toHaveBeenCalled();
  });

  test("persists a create intent before network I/O and publishes only the final query", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk);
    const localCandidate = candidate("local-1");
    const localPublisher = createLocalPublisher(snapshot([localCandidate]));
    let serverRecords: RemoteTaskRecord[] = [];
    const repository = createRepository(async () => [...serverRecords]);
    repository.create.mockImplementation(async (local: CommonTask, remoteUid: string, sourceId: string) => {
      const persisted = persistedCalendar(disk);
      expect(remoteUid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(persisted.pendingCreates["local-1"]).toMatchObject({ remoteUid, sourceId });
      expect(persisted.links["local-1"]).toBeUndefined();
      serverRecords = [record({ ...local, uid: remoteUid }, sourceId)];
    });
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    const result = await coordinator.coordinate();

    expect(result).toMatchObject({ status: "success", created: 1, remoteTaskCount: 1 });
    expect(repository.fetch).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(mockTaskState.tasks[0].uid).toBe(serverRecords[0].task.uid);
    expect(persistedCalendar(disk).pendingCreates).toEqual({});
    expect(persistedCalendar(disk).links["local-1"].remoteUid).toBe(serverRecords[0].task.uid);
  });

  test("keeps a pending create when final confirmation fails and does not create a duplicate", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk);
    const localCandidate = candidate("local-1");
    const localPublisher = createLocalPublisher(snapshot([localCandidate]));
    let createdRecord: RemoteTaskRecord | null = null;
    let fetchCount = 0;
    const repository = createRepository(async () => {
      fetchCount++;
      if (fetchCount === 1) return [];
      if (fetchCount === 2) throw new Error("confirmation offline");
      return createdRecord ? [createdRecord] : [];
    });
    repository.create.mockImplementation(async (local: CommonTask, remoteUid: string, sourceId: string) => {
      createdRecord = record({ ...local, uid: remoteUid }, sourceId);
    });
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    const failed = await coordinator.coordinate();
    expect(failed.status).toBe("failed");
    expect(mockTaskState.tasks).toEqual([]);
    expect(persistedCalendar(disk).pendingCreates["local-1"]).toBeDefined();

    const recovered = await coordinator.coordinate();
    expect(recovered.status).toBe("success");
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(mockTaskState.tasks[0].uid).toBe(createdRecord?.task.uid);
    expect(persistedCalendar(disk).pendingCreates).toEqual({});
  });

  test("confirms an accepted create by its persisted UUID when the server strips the source property", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk);
    const localCandidate = candidate("local-1");
    const localPublisher = createLocalPublisher(snapshot([localCandidate]));
    let serverRecord: RemoteTaskRecord | null = null;
    const repository = createRepository(async () => serverRecord ? [serverRecord] : []);
    repository.create.mockImplementation(async (local, remoteUid) => {
      serverRecord = record({ ...local, uid: remoteUid }, null);
    });
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.coordinate();

    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(persistedCalendar(disk).pendingCreates).toEqual({});
    expect(persistedCalendar(disk).links["local-1"].remoteUid).toBe(serverRecord?.task.uid);
  });

  test("does not create when a candidate disappears after the local scan", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk);
    const localCandidate = candidate("local-1");
    const localPublisher = createLocalPublisher(snapshot([localCandidate]));
    localPublisher.confirmPresentCandidates = jest.fn(async (_candidates: any[]) => new Set());
    const repository = createRepository(async () => []);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.coordinate();

    expect(repository.create).not.toHaveBeenCalled();
    expect(persistedCalendar(disk).pendingCreates).toEqual({});
  });

  test("does not link a create intent to a same-UID third-party task", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk);
    const localCandidate = candidate("local-1");
    const localPublisher = createLocalPublisher(snapshot([localCandidate]));
    let collidingUid: string | undefined;
    const repository = createRepository(async () => (
      collidingUid
        ? [record(task({ uid: collidingUid, title: "Third-party collision" }))]
        : []
    ));
    repository.create.mockImplementation(async (_local, remoteUid) => {
      collidingUid = remoteUid;
      throw new Error("Create VTODO failed: 412 Precondition Failed");
    });
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    const result = await coordinator.coordinate();

    expect(result.status).toBe("success");
    const persisted = persistedCalendar(disk);
    expect(persisted.links["local-1"]).toBeUndefined();
    expect(persisted.pendingCreates["local-1"].remoteUid).not.toBe(collidingUid);
    expect(mockTaskState.tasks).toMatchObject([{ uid: collidingUid, title: "Third-party collision" }]);
  });

  test("does not upload ordinary local edits after the initial association", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk, (state) => {
      state.links["local-1"] = {
        localTaskId: "local-1",
        remoteUid: "remote-1",
        sourceId: "source-1",
        localPath: "Tasks.md",
      };
    });
    const changed = candidate("local-1", { title: "Locally renamed", dueDate: "2026-09-01" });
    const localPublisher = createLocalPublisher(snapshot([changed]));
    const repository = createRepository(async () => [
      record(task({ uid: "remote-1", title: "Server title", dueDate: "2026-08-20" }), "source-1"),
    ]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.coordinate();

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(mockTaskState.tasks[0]).toMatchObject({ title: "Server title", dueDate: "2026-08-20" });
  });

  test("uses a cache-only preflight for an unrelated local file", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk, (state) => {
      state.links["local-1"] = {
        localTaskId: "local-1",
        remoteUid: "remote-1",
        sourceId: "source-1",
        localPath: "Tracked.md",
      };
    });
    const localPublisher = createLocalPublisher(snapshot());
    localPublisher.hasEligibleTaskAtPaths = jest.fn(async () => false);
    const repository = createRepository(async () => [record(task({ uid: "remote-1" }), "source-1")]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await expect(coordinator.hasActionableLocalChangesAtPaths(new Set(["Unrelated.md"]))).resolves.toBe(false);

    expect(localPublisher.inspect).not.toHaveBeenCalled();
    expect(localPublisher.hasEligibleTaskAtPaths).toHaveBeenCalledWith(new Set(["Unrelated.md"]));
  });

  test("creates identical-content local tasks independently by stable identity", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk);
    const first = candidate("local-1", { title: "Same", body: "Same body" });
    const second = candidate("local-2", { title: "Same", body: "Same body" });
    const localPublisher = createLocalPublisher(snapshot([first, second]));
    const serverRecords: RemoteTaskRecord[] = [];
    const repository = createRepository(async () => [...serverRecords]);
    repository.create.mockImplementation(async (local, remoteUid, sourceId) => {
      serverRecords.push(record({ ...local, uid: remoteUid }, sourceId));
    });
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.coordinate();

    expect(repository.create).toHaveBeenCalledTimes(2);
    const calls = repository.create.mock.calls;
    expect(calls[0][1]).not.toBe(calls[1][1]);
    expect(calls[0][2]).not.toBe(calls[1][2]);
    expect(Object.keys(persistedCalendar(disk).links)).toEqual(expect.arrayContaining(["local-1", "local-2"]));
  });

  test("imports only verified legacy mappings and leaves legacy files untouched", async () => {
    const legacyPath = `.caldav-sync/calendars/${CALENDAR_ID}/id-mapping.json`;
    const legacy = JSON.stringify({
      taskIdToCaldavUid: {
        "local-1": "remote-1",
        missingLocal: "remote-2",
        missingRemote: "not-on-server",
      },
    });
    const disk = createDisk({ [legacyPath]: legacy });
    const stateStore = new TaskStateStore(disk.app, ".obsidian/plugins/work-assistant");
    await stateStore.load();
    const localOne = localTask("local-1");
    const localPublisher = createLocalPublisher(snapshot([], [localOne]));
    const repository = createRepository(async () => [
      record(task({ uid: "remote-1" })),
      record(task({ uid: "remote-2" })),
    ]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.coordinate();

    const persisted = persistedCalendar(disk);
    expect(persisted.migrationVersion).toBe(1);
    expect(persisted.links["local-1"]).toMatchObject({ remoteUid: "remote-1" });
    expect(persisted.links.missingLocal).toBeUndefined();
    expect(persisted.links.missingRemote).toBeUndefined();
    expect(disk.files.get(legacyPath)).toBe(legacy);
    expect(repository.create).not.toHaveBeenCalled();
  });

  test("pauses local publication and retries when a legacy mapping is unreadable", async () => {
    const legacyPath = `.caldav-sync/calendars/${CALENDAR_ID}/id-mapping.json`;
    const disk = createDisk({ [legacyPath]: "{ broken" });
    const stateStore = new TaskStateStore(disk.app, ".obsidian/plugins/work-assistant");
    await stateStore.load();
    const localCandidate = candidate("local-1");
    const localPublisher = createLocalPublisher(snapshot([localCandidate]));
    const repository = createRepository(async () => [record(task({ uid: "third-party" }))]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);
    const warningSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const first = await coordinator.coordinate();
    expect(first.status).toBe("success");
    expect(repository.create).not.toHaveBeenCalled();
    expect(mockTaskState.tasks[0].uid).toBe("third-party");
    expect(mockTaskState.warning).toContain("local task publishing is paused");
    expect(stateStore.getCalendar(CALENDAR_ID).migrationVersion).toBeUndefined();

    disk.files.set(legacyPath, JSON.stringify({ taskIdToCaldavUid: {} }));
    await coordinator.coordinate();
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(stateStore.getCalendar(CALENDAR_ID).migrationVersion).toBe(1);
    warningSpy.mockRestore();
  });

  test("pauses local publication when a legacy mapping contains a malformed entry", async () => {
    const legacyPath = `.caldav-sync/calendars/${CALENDAR_ID}/mapping.json`;
    const disk = createDisk({
      [legacyPath]: JSON.stringify({
        tasks: {
          "local-1": { caldavUID: "remote-1" },
          malformed: {},
        },
      }),
    });
    const stateStore = new TaskStateStore(disk.app, ".obsidian/plugins/work-assistant");
    await stateStore.load();
    const localPublisher = createLocalPublisher(snapshot([candidate("local-1")]));
    const repository = createRepository(async () => [record(task({ uid: "remote-1" }))]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);
    const warningSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await coordinator.coordinate();

    expect(repository.create).not.toHaveBeenCalled();
    expect(stateStore.getCalendar(CALENDAR_ID).migrationVersion).toBeUndefined();
    expect(mockTaskState.warning).toContain("local task publishing is paused");
    warningSpy.mockRestore();
  });

  test("turns a removed local association into a tombstone without deleting the cloud task", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk, (state) => {
      state.links["local-1"] = {
        localTaskId: "local-1",
        remoteUid: "remote-1",
        sourceId: "source-1",
        localPath: "Tasks.md",
      };
    });
    const localPublisher = createLocalPublisher(snapshot());
    localPublisher.hasTaskIdentityAtPath = jest.fn(async () => false);
    const repository = createRepository(async () => [record(task(), "source-1")]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.coordinate();

    const persisted = persistedCalendar(disk);
    expect(persisted.links["local-1"]).toBeUndefined();
    expect(persisted.tombstones["local-1"]).toMatchObject({ remoteUid: "remote-1" });
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(mockTaskState.tasks[0].uid).toBe("remote-1");

    const reappearedPublisher = createLocalPublisher(snapshot([candidate("local-1")]));
    const restartedCoordinator = createCoordinator(disk, repository, reappearedPublisher, stateStore);
    await restartedCoordinator.coordinate();
    expect(repository.create).not.toHaveBeenCalled();
  });

  test("updates chained renamed paths without querying CalDAV while the Tasks cache is stale", async () => {
    const disk = createDisk();
    (disk.app.vault as { getAbstractFileByPath?: (path: string) => unknown }).getAbstractFileByPath =
      jest.fn((path: string) => path === "New/Tasks.md" ? {} : null);
    const stateStore = await createStateStore(disk, (state) => {
      state.links["local-1"] = {
        localTaskId: "local-1",
        remoteUid: "remote-1",
        sourceId: "source-1",
        localPath: "Old/Tasks.md",
      };
    });
    const stale = localTask("local-1", false, "Old/Tasks.md");
    const localPublisher = createLocalPublisher(snapshot([], [stale]));
    const repository = createRepository(async () => [record(task({ uid: "remote-1" }), "source-1")]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    const first = coordinator.handleLocalRename("Old", "New");
    const second = coordinator.handleLocalRename("New", "Newest");
    await Promise.all([first, second]);

    expect(persistedCalendar(disk).links["local-1"].localPath).toBe("Newest/Tasks.md");
    expect(repository.fetch).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  test("does not retire a linked task while the Tasks cache temporarily omits its Markdown identity", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk, (state) => {
      state.links["local-1"] = {
        localTaskId: "local-1",
        remoteUid: "remote-1",
        sourceId: "source-1",
        localPath: "Tasks.md",
      };
    });
    const localPublisher = createLocalPublisher(snapshot());
    localPublisher.hasTaskIdentityAtPath = jest.fn(async () => true);
    const repository = createRepository(async () => [record(task({ uid: "remote-1" }), "source-1")]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.coordinate();

    expect(localPublisher.hasTaskIdentityAtPath).toHaveBeenCalledWith("Tasks.md", "local-1");
    expect(persistedCalendar(disk).links["local-1"]).toMatchObject({ remoteUid: "remote-1" });
    expect(persistedCalendar(disk).tombstones["local-1"]).toBeUndefined();
  });

  test("retires a completed pending create instead of publishing it after the fact", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk, (state) => {
      state.pendingCreates["local-1"] = {
        localTaskId: "local-1",
        remoteUid: "reserved-remote",
        sourceId: "source-1",
        localPath: "Tasks.md",
        createdAt: "2026-08-12T00:00:00.000Z",
      };
    });
    const completed = localTask("local-1", true);
    const localPublisher = createLocalPublisher(snapshot([], [completed]));
    const repository = createRepository(async () => []);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.coordinate();

    const persisted = persistedCalendar(disk);
    expect(persisted.pendingCreates["local-1"]).toBeUndefined();
    expect(persisted.tombstones["local-1"]).toMatchObject({ remoteUid: "reserved-remote" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  test("completes the old remote recurrence instance while creating its new local successor", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk, (state) => {
      state.links["old-local"] = {
        localTaskId: "old-local",
        remoteUid: "remote-old",
        sourceId: "source-old",
        localPath: "Tasks.md",
      };
    });
    const completedOld = localTask("old-local", true);
    const next = candidate("next-local");
    const localPublisher = createLocalPublisher(
      snapshot([next], [completedOld, next.original], new Set(["old-local"])),
    );
    let records: RemoteTaskRecord[] = [record(task({ uid: "remote-old" }), "source-old")];
    const repository = createRepository(async () => [...records]);
    repository.create.mockImplementation(async (local: CommonTask, remoteUid: string, sourceId: string) => {
      records = [...records, record({ ...local, uid: remoteUid }, sourceId)];
    });
    repository.complete.mockImplementation(async () => {
      records = records.map((item) => item.task.uid === "remote-old"
        ? record({ ...item.task, status: "DONE", completedDate: "2026-08-12" }, item.sourceId)
        : item);
    });
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    const result = await coordinator.coordinate();

    expect(result).toMatchObject({ status: "success", created: 1, completedRemote: 1 });
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.complete).toHaveBeenCalledTimes(1);
    expect(persistedCalendar(disk).links["old-local"].completed).toBe(true);
    expect(persistedCalendar(disk).links["next-local"]).toBeDefined();
  });

  test("persists sidebar completion, confirms it by query, and retries confirmation without a second write", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk);
    let serverRecord = record(task({ uid: "remote-only" }));
    let fetchCount = 0;
    const repository = createRepository(async () => {
      fetchCount++;
      if (fetchCount === 2) throw new Error("final query failed");
      return [serverRecord];
    });
    repository.complete.mockImplementation(async () => {
      expect(persistedCalendar(disk).pendingCompletions["remote-only"]).toBeDefined();
      serverRecord = record(task({ uid: "remote-only", status: "DONE", completedDate: "2026-08-12" }));
    });
    const localPublisher = createLocalPublisher(snapshot(), false);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    const failed = await coordinator.completeTask(serverRecord.task);
    expect(failed.status).toBe("failed");
    expect(persistedCalendar(disk).pendingCompletions["remote-only"]).toBeDefined();
    expect(mockTaskState.tasks).toEqual([]);

    const recovered = await coordinator.coordinate();
    expect(recovered.status).toBe("success");
    expect(repository.complete).toHaveBeenCalledTimes(1);
    expect(persistedCalendar(disk).pendingCompletions).toEqual({});
    expect(mockTaskState.tasks[0].status).toBe("DONE");
  });

  test("still completes a remote-only sidebar task when the local ledger is unavailable", async () => {
    const disk = createDisk();
    let serverRecord = record(task({ uid: "remote-only" }));
    const repository = createRepository(async () => [serverRecord]);
    repository.complete.mockImplementation(async () => {
      serverRecord = record(task({ uid: "remote-only", status: "DONE", completedDate: "2026-08-12" }));
    });
    const localPublisher = createLocalPublisher(snapshot(), false);
    const coordinator = createCoordinator(disk, repository, localPublisher, null);

    const result = await coordinator.completeTask(serverRecord.task);

    expect(result).toMatchObject({ status: "success", completedRemote: 1 });
    expect(repository.complete).toHaveBeenCalledTimes(1);
    expect(localPublisher.complete).not.toHaveBeenCalled();
    expect(mockTaskState.tasks).toMatchObject([{ uid: "remote-only", status: "DONE" }]);
  });

  test("propagates third-party DONE to a linked local task but ignores CANCELLED", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk, (state) => {
      state.links["local-1"] = {
        localTaskId: "local-1",
        remoteUid: "remote-1",
        sourceId: "source-1",
        localPath: "Tasks.md",
      };
      state.links["local-2"] = {
        localTaskId: "local-2",
        remoteUid: "remote-2",
        sourceId: "source-2",
        localPath: "Tasks.md",
      };
    });
    const localOne = localTask("local-1");
    const localTwo = localTask("local-2");
    const localPublisher = createLocalPublisher(snapshot([], [localOne, localTwo]));
    const repository = createRepository(async () => [
      record(task({ uid: "remote-1", status: "DONE", completedDate: "2026-08-12" }), "source-1"),
      record(task({ uid: "remote-2", status: "CANCELLED" }), "source-2"),
    ]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.coordinate();

    expect(localPublisher.complete).toHaveBeenCalledTimes(1);
    expect(localPublisher.complete).toHaveBeenCalledWith("local-1");
    expect(repository.complete).not.toHaveBeenCalled();
  });

  test("does not complete an excluded local task during a remote-only refresh", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk, (state) => {
      state.links["local-1"] = {
        localTaskId: "local-1",
        remoteUid: "remote-1",
        sourceId: "source-1",
        localPath: "Tasks.md",
      };
    });
    const local = localTask("local-1");
    const localSnapshot = snapshot([], [local]);
    localSnapshot.eligibleTaskIds.clear();
    const localPublisher = createLocalPublisher(localSnapshot);
    const repository = createRepository(async () => [
      record(task({ uid: "remote-1", status: "DONE", completedDate: "2026-08-12" }), "source-1"),
    ]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.refreshRemote();

    expect(localPublisher.complete).not.toHaveBeenCalled();
    expect(mockTaskState.tasks).toMatchObject([{ uid: "remote-1", status: "DONE" }]);
    expect(persistedCalendar(disk).links["local-1"].completed).toBe(true);
    expect(persistedCalendar(disk).pendingCompletions).toEqual({});
  });

  test("does not turn a locally cancelled task into a remote completion", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk, (state) => {
      state.links["local-1"] = {
        localTaskId: "local-1",
        remoteUid: "remote-1",
        sourceId: "source-1",
        localPath: "Tasks.md",
      };
    });
    const cancelled = localTask("local-1", true, "Tasks.md");
    cancelled.status.configuration.type = "CANCELLED";
    const localPublisher = createLocalPublisher(snapshot([], [cancelled]));
    const repository = createRepository(async () => [record(task({ uid: "remote-1" }), "source-1")]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.coordinate();

    expect(repository.complete).not.toHaveBeenCalled();
    expect(persistedCalendar(disk).pendingCompletions).toEqual({});
  });

  test("cancels a local completion retry when that task is removed from the sync scope", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk, (state) => {
      state.links["local-1"] = {
        localTaskId: "local-1",
        remoteUid: "remote-1",
        sourceId: "source-1",
        localPath: "Tasks.md",
      };
      state.pendingCompletions["remote-1"] = {
        remoteUid: "remote-1",
        localTaskId: "local-1",
        remoteCompleted: false,
        localCompleted: true,
        updatedAt: "2026-08-12T00:00:00.000Z",
      };
    });
    const completed = localTask("local-1", true);
    const localSnapshot = snapshot([], [completed]);
    localSnapshot.eligibleTaskIds.clear();
    const localPublisher = createLocalPublisher(localSnapshot);
    const repository = createRepository(async () => [record(task({ uid: "remote-1" }), "source-1")]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.coordinate();

    expect(repository.complete).not.toHaveBeenCalled();
    expect(persistedCalendar(disk).links["local-1"]).toBeUndefined();
    expect(persistedCalendar(disk).pendingCompletions).toEqual({});
    expect(persistedCalendar(disk).tombstones["local-1"]).toMatchObject({ remoteUid: "remote-1" });
  });

  test("keeps the sidebar empty when the first live CalDAV query fails", async () => {
    const disk = createDisk();
    const localPublisher = createLocalPublisher(snapshot(), false);
    const repository = createRepository(async () => {
      throw new Error("cold-start offline");
    });
    const coordinator = createCoordinator(disk, repository, localPublisher, null);

    const result = await coordinator.coordinate();

    expect(result.status).toBe("failed");
    expect(mockTaskState).toMatchObject({
      tasks: [],
      ready: false,
      stale: false,
      error: "cold-start offline",
    });
  });

  test("shows a remote-only task as open again when the server reopens it", async () => {
    const disk = createDisk();
    const localPublisher = createLocalPublisher(snapshot(), false);
    const repository = createRepository(jest.fn()
      .mockResolvedValueOnce([record(task({ uid: "remote-only", status: "DONE" }))])
      .mockResolvedValueOnce([record(task({ uid: "remote-only", status: "TODO", completedDate: null }))]));
    const coordinator = createCoordinator(disk, repository, localPublisher, null);

    await coordinator.coordinate();
    await coordinator.refreshRemote();

    expect(repository.complete).not.toHaveBeenCalled();
    expect(mockTaskState.tasks).toMatchObject([{ uid: "remote-only", status: "TODO" }]);
  });

  test("completion wins when a linked task is reopened on both sides", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk, (state) => {
      state.links["local-1"] = {
        localTaskId: "local-1",
        remoteUid: "remote-1",
        sourceId: "source-1",
        localPath: "Tasks.md",
        completed: true,
      };
    });
    const local = localTask("local-1");
    const localPublisher = createLocalPublisher(snapshot([], [local]));
    let remote = record(task({ uid: "remote-1", status: "TODO" }), "source-1");
    const repository = createRepository(async () => [remote]);
    repository.complete.mockImplementation(async () => {
      remote = record(task({ uid: "remote-1", status: "DONE", completedDate: "2026-08-13" }), "source-1");
    });
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);

    await coordinator.coordinate();

    expect(repository.complete).toHaveBeenCalledTimes(1);
    expect(localPublisher.complete).toHaveBeenCalledWith("local-1");
    expect(mockTaskState.tasks).toMatchObject([{ uid: "remote-1", status: "DONE" }]);
  });

  test("retries only the local side after a remote completion was confirmed", async () => {
    const disk = createDisk();
    const stateStore = await createStateStore(disk, (state) => {
      state.links["local-1"] = {
        localTaskId: "local-1",
        remoteUid: "remote-1",
        sourceId: "source-1",
        localPath: "Tasks.md",
      };
    });
    const local = localTask("local-1");
    const localPublisher = createLocalPublisher(snapshot([], [local]));
    localPublisher.complete
      .mockRejectedValueOnce(new Error("vault write failed"))
      .mockResolvedValueOnce(undefined);
    const repository = createRepository(async () => [
      record(task({ uid: "remote-1", status: "DONE", completedDate: "2026-08-13" }), "source-1"),
    ]);
    const coordinator = createCoordinator(disk, repository, localPublisher, stateStore);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await coordinator.coordinate();
    expect(persistedCalendar(disk).pendingCompletions["remote-1"]).toMatchObject({
      remoteCompleted: true,
      localCompleted: false,
    });

    await coordinator.refreshRemote();

    expect(repository.complete).not.toHaveBeenCalled();
    expect(localPublisher.complete).toHaveBeenCalledTimes(2);
    expect(persistedCalendar(disk).pendingCompletions).toEqual({});
    errorSpy.mockRestore();
  });

  test("retains the last server-confirmed in-memory list as stale after a later query failure", async () => {
    const disk = createDisk();
    const localPublisher = createLocalPublisher(snapshot(), false);
    const repository = createRepository(jest.fn()
      .mockResolvedValueOnce([record(task({ uid: "confirmed" }))])
      .mockRejectedValueOnce(new Error("server offline")));
    const coordinator = createCoordinator(disk, repository, localPublisher, null);

    await coordinator.coordinate();
    const failed = await coordinator.refreshRemote();

    expect(failed.status).toBe("failed");
    expect(mockTaskState).toMatchObject({
      ready: true,
      stale: true,
      error: "server offline",
    });
    expect(mockTaskState.tasks[0].uid).toBe("confirmed");
  });

  test("coalesces background requests while a manual request reports busy", async () => {
    const disk = createDisk();
    const localPublisher = createLocalPublisher(snapshot(), false);
    let releaseFetch: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => { releaseFetch = resolve; });
    let signalFetch: (() => void) | undefined;
    const fetchEntered = new Promise<void>((resolve) => { signalFetch = resolve; });
    const repository = createRepository(async () => {
      signalFetch?.();
      await fetchStarted;
      return [record(task({ uid: "remote-1" }))];
    });
    const coordinator = createCoordinator(disk, repository, localPublisher, null);

    const background = coordinator.coordinate();
    await fetchEntered;
    const manual = await coordinator.coordinateManually();
    const refresh = coordinator.refreshRemote();
    releaseFetch?.();

    expect(manual.status).toBe("busy");
    await Promise.all([background, refresh]);
    expect(repository.fetch).toHaveBeenCalledTimes(2);
  });
});
