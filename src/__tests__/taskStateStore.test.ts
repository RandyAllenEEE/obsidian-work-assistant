jest.mock("obsidian", () => ({
  normalizePath: (path: string) => path,
}));

import { TaskStateStore } from "../services/caldav/storage/taskStateStore";

function createStore(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  const adapter = {
    exists: jest.fn(async (path: string) => files.has(path)),
    read: jest.fn(async (path: string) => files.get(path) ?? ""),
    write: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
  };
  const store = new TaskStateStore({ vault: { adapter } } as any, ".obsidian/plugins/work-assistant");
  return { adapter, files, store, path: ".obsidian/plugins/work-assistant/task-state.json" };
}

describe("TaskStateStore", () => {
  test("serializes revisions made while a write is in flight", async () => {
    const { adapter, files, path, store } = createStore();
    await store.load();

    let releaseFirstWrite: (() => void) | undefined;
    let signalFirstWrite: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => { signalFirstWrite = resolve; });
    const firstWriteReleased = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    adapter.write.mockImplementationOnce(async (target: string, content: string) => {
      signalFirstWrite?.();
      await firstWriteReleased;
      files.set(target, content);
    });

    const first = store.updateCalendar("work", (calendar) => {
      calendar.pendingCreates.local = {
        localTaskId: "local",
        remoteUid: "remote",
        sourceId: "source",
        createdAt: "2026-08-12T00:00:00.000Z",
        remoteWriteAcceptedAt: "2026-08-12T00:00:01.000Z",
      };
    });
    await firstWriteStarted;
    const second = store.updateCalendar("work", (calendar) => {
      calendar.tombstones.retired = {
        localTaskId: "retired",
        remoteUid: "old-remote",
        sourceId: "old-source",
        retiredAt: "2026-08-12T00:01:00.000Z",
      };
    });
    releaseFirstWrite?.();
    await Promise.all([first, second]);

    const persisted = JSON.parse(files.get(path) ?? "{}");
    expect(persisted.calendars.work.pendingCreates.local.remoteUid).toBe("remote");
    expect(persisted.calendars.work.pendingCreates.local.remoteWriteAcceptedAt)
      .toBe("2026-08-12T00:00:01.000Z");
    expect(persisted.calendars.work.tombstones.retired.remoteUid).toBe("old-remote");
    expect(adapter.write).toHaveBeenCalledTimes(2);
  });

  test("retains a failed revision and retries an idempotent update", async () => {
    const { adapter, files, path, store } = createStore();
    await store.load();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    adapter.write.mockRejectedValueOnce(new Error("disk unavailable"));

    const mutation = (calendar: ReturnType<TaskStateStore["getCalendar"]>) => {
      calendar.migrationVersion = 1;
    };
    await expect(store.updateCalendar("work", mutation)).rejects.toThrow("disk unavailable");
    await store.updateCalendar("work", mutation);

    const persisted = JSON.parse(files.get(path) ?? "{}");
    expect(persisted.calendars.work.migrationVersion).toBe(1);
    expect(adapter.write).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  test("a malformed file remains untouched and blocks replacement writes", async () => {
    const path = ".obsidian/plugins/work-assistant/task-state.json";
    const malformed = "{ definitely not json";
    const { adapter, files, store } = createStore({ [path]: malformed });

    await expect(store.load()).rejects.toThrow();
    await expect(store.updateCalendar("work", (calendar) => {
      calendar.migrationVersion = 1;
    })).rejects.toThrow();

    expect(files.get(path)).toBe(malformed);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  test("rejects a superficially valid file with malformed nested ledger entries", async () => {
    const path = ".obsidian/plugins/work-assistant/task-state.json";
    const malformed = JSON.stringify({
      schemaVersion: 1,
      calendars: {
        work: {
          links: { local: { localTaskId: "local", remoteUid: 42, sourceId: "source" } },
          pendingCreates: {},
          pendingCompletions: {},
          tombstones: {},
          remoteTombstones: {},
        },
      },
    });
    const { adapter, files, store } = createStore({ [path]: malformed });

    await expect(store.load()).rejects.toThrow("Invalid JSON shape");
    await expect(store.retrySave()).rejects.toThrow("Invalid JSON shape");

    expect(files.get(path)).toBe(malformed);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  test("keeps correctness state isolated per calendar", async () => {
    const { store } = createStore();
    await store.load();
    await store.updateCalendar("work", (calendar) => {
      calendar.links.local = {
        localTaskId: "local",
        remoteUid: "work-remote",
        sourceId: "source",
      };
    });

    expect(store.getCalendar("work").links.local.remoteUid).toBe("work-remote");
    expect(store.getCalendar("personal").links).toEqual({});
  });

  test("returns calendar snapshots instead of mutable store internals", async () => {
    const { store } = createStore();
    await store.load();
    await store.updateCalendar("work", (calendar) => {
      calendar.links.local = {
        localTaskId: "local",
        remoteUid: "remote",
        sourceId: "source",
      };
    });

    const snapshot = store.getCalendar("work");
    snapshot.links.local.remoteUid = "mutated";

    expect(store.getCalendar("work").links.local.remoteUid).toBe("remote");
  });
});
