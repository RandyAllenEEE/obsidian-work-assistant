jest.mock("obsidian", () => ({
  normalizePath: (path: string) => path,
}));

import { SyncStorage } from "../services/caldav/storage/syncStorage";
import type { CommonTask } from "../services/caldav/sync/types";

function task(uid: string): CommonTask {
  return {
    uid,
    title: uid,
    status: "TODO",
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    completedDate: null,
    priority: "none",
    tags: [],
    recurrenceRule: "",
    body: "",
  };
}

describe("SyncStorage commit safety", () => {
  test("a partial persistence failure does not advance in-memory sync state", async () => {
    const adapter = {
      write: jest.fn(async (path: string) => {
        if (path.endsWith("baseline.json")) throw new Error("baseline write failed");
      }),
    };
    const storage = new SyncStorage({ vault: { adapter } } as any) as any;
    const oldState = { lastSyncTime: "2026-01-01T00:00:00.000Z", conflicts: [] };
    const oldBaseline = [task("old")];
    const oldMapping = {
      taskIdToCaldavUid: { old: "remote-old" },
      caldavUidToTaskId: { "remote-old": "old" },
    };
    storage.stateCache = oldState;
    storage.baselineCache = oldBaseline;
    storage.idMappingCache = oldMapping;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(storage.commitSuccessfulSync({
      taskIdToCaldavUid: { next: "remote-next" },
      caldavUidToTaskId: { "remote-next": "next" },
    }, [task("next")])).rejects.toThrow("baseline write failed");

    expect(storage.getState()).toBe(oldState);
    expect(storage.getBaseline()).toBe(oldBaseline);
    expect(storage.getIdMapping()).toBe(oldMapping);
    errorSpy.mockRestore();
  });
});
