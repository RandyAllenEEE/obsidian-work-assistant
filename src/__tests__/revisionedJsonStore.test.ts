import { RevisionedJsonStore } from "../services/RevisionedJsonStore";

describe("RevisionedJsonStore", () => {
  function createStore() {
    const files = new Map<string, string>();
    const adapter = {
      exists: jest.fn(async (path: string) => files.has(path)),
      read: jest.fn(async (path: string) => files.get(path) ?? ""),
      write: jest.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
    };
    const store = new RevisionedJsonStore(adapter, "state.json", {
      create: () => ({ values: [] as string[] }),
      validate: (value): value is { values: string[] } => !!value && typeof value === "object",
    });
    return { adapter, files, store };
  }

  test("drains a revision made while the previous write is in flight", async () => {
    const { adapter, files, store } = createStore();
    await store.load();

    let releaseFirstWrite: (() => void) | undefined;
    let signalFirstWrite: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => { signalFirstWrite = resolve; });
    const firstWriteReleased = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    adapter.write.mockImplementationOnce(async (path: string, content: string) => {
      signalFirstWrite?.();
      await firstWriteReleased;
      files.set(path, content);
    });

    store.update((state) => ({ values: [...state.values, "first"] }));
    const firstSave = store.save();
    await firstWriteStarted;
    store.update((state) => ({ values: [...state.values, "second"] }));
    const secondSave = store.save();
    releaseFirstWrite?.();
    await Promise.all([firstSave, secondSave]);

    expect(JSON.parse(files.get("state.json") ?? "{}")).toEqual({ values: ["first", "second"] });
    expect(adapter.write).toHaveBeenCalledTimes(2);
    expect(store.isDirty()).toBe(false);
  });

  test("does not overwrite malformed existing JSON", async () => {
    const { adapter, files, store } = createStore();
    files.set("state.json", "{ not json");

    await expect(store.load()).rejects.toThrow();
    expect(() => store.replace({ values: ["new"] })).toThrow();
    expect(adapter.write).not.toHaveBeenCalled();
    expect(files.get("state.json")).toBe("{ not json");
  });

  test("keeps a failed revision dirty for a later retry", async () => {
    const { adapter, files, store } = createStore();
    await store.load();
    adapter.write.mockRejectedValueOnce(new Error("disk unavailable"));

    store.update((state) => ({ values: [...state.values, "retry"] }));
    await expect(store.save()).rejects.toThrow("disk unavailable");
    expect(store.isDirty()).toBe(true);

    await store.save();
    expect(JSON.parse(files.get("state.json") ?? "{}")).toEqual({ values: ["retry"] });
    expect(store.isDirty()).toBe(false);
  });
});
