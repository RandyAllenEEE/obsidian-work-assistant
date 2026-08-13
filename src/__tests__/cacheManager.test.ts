const pluginCacheSet = jest.fn();

jest.mock("../ui/stores", () => ({
  pluginCache: { set: pluginCacheSet },
}));

import { CacheManager } from "../services/CacheManager";

describe("CacheManager persistence", () => {
  beforeEach(() => {
    pluginCacheSet.mockClear();
  });

  function createManager(initialFiles: Record<string, string> = {}) {
    const files = new Map<string, string>(Object.entries(initialFiles));
    const adapter = {
      exists: jest.fn(async (path: string) => files.has(path)),
      read: jest.fn(async (path: string) => files.get(path) ?? ""),
      write: jest.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
    };
    const plugin = {
      manifest: { dir: ".obsidian/plugins/work-assistant" },
      app: { vault: { adapter } },
    } as any;
    return { manager: new CacheManager(plugin), adapter, files };
  }

  test("serializes concurrent domain updates without losing either patch", async () => {
    const { manager, adapter, files } = createManager();
    await manager.load();

    let releaseFirstWrite: (() => void) | undefined;
    let signalFirstWrite: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => { signalFirstWrite = resolve; });
    const firstWriteReleased = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    adapter.write.mockImplementationOnce(async (path: string, content: string) => {
      signalFirstWrite?.();
      await firstWriteReleased;
      files.set(path, content);
    });

    const weatherUpdate = manager.patchWeather({ locationName: "Shanghai" });
    await firstWriteStarted;
    const mediaUpdate = manager.updateMedia({ Title: "Now playing" });
    releaseFirstWrite?.();
    await Promise.all([weatherUpdate, mediaUpdate]);

    const persisted = JSON.parse(files.get(".obsidian/plugins/work-assistant/cache.json") ?? "{}");
    expect(persisted.weather.locationName).toBe("Shanghai");
    expect(persisted.media.Title).toBe("Now playing");
    expect(adapter.write).toHaveBeenCalledTimes(2);
  });

  test("retains a failed revision and retries it with the next update", async () => {
    const { manager, adapter, files } = createManager();
    await manager.load();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    adapter.write.mockRejectedValueOnce(new Error("disk unavailable"));

    await manager.patchWeather({ locationId: "101020100" });
    await manager.updateMedia({ Artist: "Artist" });

    const persisted = JSON.parse(files.get(".obsidian/plugins/work-assistant/cache.json") ?? "{}");
    expect(persisted.weather.locationId).toBe("101020100");
    expect(persisted.media.Artist).toBe("Artist");
    expect(adapter.write).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  test("does not replace the in-memory cache after a malformed disk cache fails to load", async () => {
    const path = ".obsidian/plugins/work-assistant/cache.json";
    const { manager, adapter, files } = createManager({ [path]: "{ malformed" });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await manager.load();
    await manager.patchWeather({ locationName: "Shanghai" });

    expect(manager.getWeather()).toEqual({});
    expect(files.get(path)).toBe("{ malformed");
    expect(adapter.write).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("drops legacy task snapshots while preserving the three cache domains", async () => {
    const path = ".obsidian/plugins/work-assistant/cache.json";
    const { manager, files } = createManager({
      [path]: JSON.stringify({
        weather: { locationName: "Shanghai" },
        media: { Title: "Track" },
        timer: { mode: 0, paused: true },
        syncedTasks: [{ uid: "stale-local-snapshot" }],
      }),
    });

    await manager.load();
    await manager.patchWeather({ locationId: "101020100" });

    const persisted = JSON.parse(files.get(path) ?? "{}");
    expect(persisted).toMatchObject({
      weather: { locationName: "Shanghai", locationId: "101020100" },
      media: { Title: "Track" },
      timer: { mode: 0, paused: true },
    });
    expect(persisted).not.toHaveProperty("syncedTasks");
  });

  test("protects cache.json when a known domain has an invalid shape", async () => {
    const path = ".obsidian/plugins/work-assistant/cache.json";
    const malformed = JSON.stringify({ weather: "not-an-object" });
    const { manager, adapter, files } = createManager({ [path]: malformed });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await manager.load();
    await manager.updateMedia({ Title: "Must not overwrite" });

    expect(files.get(path)).toBe(malformed);
    expect(adapter.write).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
