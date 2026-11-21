import { EventEmitter } from "events";
import { spawn } from "child_process";
import { SystemMediaMonitor, getActiveWindow } from "../smtc/SystemMediaMonitor";
import type { MediaCache } from "../ui/stores";

jest.mock("svelte/store", () => ({
  writable: (initial: unknown) => {
    let value = initial;
    return {
      set: (next: unknown) => {
        value = next;
      },
      subscribe: (fn: (v: unknown) => void) => {
        fn(value);
        return () => undefined;
      },
    };
  },
}));

jest.mock("obsidian", () => {
  class Component {}
  const debounce = <T extends (...args: any[]) => any>(fn: T) => fn;
  return {
    Component,
    Platform: { isWin: true },
    debounce,
    Notice: class {
      constructor(_msg: string) {
        // noop
      }
    },
  };
});

jest.mock("child_process", () => ({
  spawn: jest.fn(),
}));

jest.mock("fs", () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(),
}));

jest.mock("crypto", () => ({
  createHash: jest.fn(() => ({
    update: jest.fn(),
    digest: jest.fn(() => "HASH"),
  })),
}));

describe("SystemMediaMonitor process buffer", () => {
  class MockChildProcess extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    stdin = {
      writable: true,
      destroyed: false,
      write: jest.fn(),
    };
    kill = jest.fn();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).window = globalThis;
  });

  function readStoreValue<T>(store: { subscribe: (fn: (value: T) => void) => () => void }): T | undefined {
    let value: T | undefined;
    const unsubscribe = store.subscribe((v) => {
      value = v;
    });
    unsubscribe();
    return value;
  }

  function createMonitor(manifest: { id: string; dir?: string } = {
    id: "obsidian-work-assistant",
    dir: ".obsidian/plugins/obsidian-work-assistant",
  }) {
    const plugin = {
      app: {
        vault: {
          configDir: ".obsidian",
          adapter: {
            getBasePath: () => "E:/vault",
          },
        },
      },
      manifest,
      options: {
        media: {
          trustedExeHash: "",
        },
      },
      writeOptions: jest.fn(),
    } as any;

    const cacheManager = {
      getMedia: jest.fn(() => null),
      updateMedia: jest.fn(),
    } as any;

    return new SystemMediaMonitor(plugin, cacheManager) as any;
  }

  test("resolves the media bridge from the current plugin ID when dir is absent", () => {
    const monitor = createMonitor({ id: "obsidian-work-assistant" });
    expect(monitor.bridgePath).toBe("E:/vault/.obsidian/plugins/obsidian-work-assistant/bin/SMTCBridge.exe");
  });

  test("preserves a custom manifest directory rather than guessing from the ID", () => {
    const monitor = createMonitor({ id: "obsidian-work-assistant", dir: ".custom/plugins/existing-install" });
    expect(monitor.bridgePath).toBe("E:/vault/.custom/plugins/existing-install/bin/SMTCBridge.exe");
  });

  test("processBuffer parses JSON payload and updates store", () => {
    const monitor = createMonitor();
    monitor.buffer = 'noiseJSON_START{"Title":"Song","Artist":"A"}JSON_ENDtail';
    monitor.processBuffer();
    const state = readStoreValue<MediaCache>(monitor.mediaStore);
    expect(state?.Title).toBe("Song");
    expect(state?.Artist).toBe("A");
  });

  test("processBuffer handles null payload", () => {
    const monitor = createMonitor();
    monitor.buffer = "JSON_STARTnullJSON_END";
    monitor.processBuffer();
    expect(readStoreValue(monitor.mediaStore)).toBeNull();
    expect(monitor.cacheManager.updateMedia).toHaveBeenCalledWith({
      lastUpdate: expect.any(Number),
    });
  });

  test("processBuffer preserves large thumbnail payload until complete", () => {
    const monitor = createMonitor();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const thumbnail = `data:image/jpeg;base64,${"a".repeat(30000)}`;

    monitor.buffer = `JSON_START{"Title":"Song","Artist":"A","Thumbnail":"${thumbnail}`;
    monitor.processBuffer();

    expect(monitor.buffer).toContain("JSON_START");
    expect(warnSpy).not.toHaveBeenCalled();

    monitor.buffer += '"}JSON_END';
    monitor.processBuffer();

    const state = readStoreValue<any>(monitor.mediaStore);
    expect(state?.Title).toBe("Song");
    expect(state?.Thumbnail).toBe(thumbnail);
    expect(monitor.buffer).toBe("");
    warnSpy.mockRestore();
  });

  test("processBuffer clears oversized buffer", () => {
    const monitor = createMonitor();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    monitor.buffer = "x".repeat(1024 * 1024 + 1);
    monitor.processBuffer();
    expect(monitor.buffer).toBe("");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("controlMedia writes to monitor stdin when available", async () => {
    const monitor = createMonitor();
    await monitor.loadDesktopRuntime();
    const child = new MockChildProcess();
    monitor.process = child;

    monitor.controlMedia("Next");

    expect(child.stdin.write).toHaveBeenCalledWith("control next\n");
    expect(spawn).not.toHaveBeenCalled();
  });

  test("controlMedia falls back to one-shot process when stdin is unavailable", async () => {
    const monitor = createMonitor();
    await monitor.loadDesktopRuntime();
    const monitorChild = new MockChildProcess();
    monitorChild.stdin.writable = false;
    monitor.process = monitorChild;
    const fallbackChild = new MockChildProcess();
    (spawn as jest.Mock).mockReturnValueOnce(fallbackChild as any);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    monitor.controlMedia("PlayPause");

    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining("SMTCBridge.exe"),
      ["control", "playpause"],
      expect.objectContaining({ windowsHide: true })
    );
    warnSpy.mockRestore();
  });

  test("unexpected monitor exit schedules a backoff restart", async () => {
    jest.useFakeTimers();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const monitor = createMonitor();
      await monitor.loadDesktopRuntime();
      jest.spyOn(monitor, "ensureBridge").mockResolvedValue(true);
      const child = new MockChildProcess();
      (spawn as jest.Mock).mockReturnValue(child as any);
      const restartSpy = jest.spyOn(monitor, "startMonitoring");

      await monitor.startMonitoring();
      child.emit("close", 1);
      expect(restartSpy).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(restartSpy).toHaveBeenCalledWith(false);
      monitor.stopMonitoring();
    } finally {
      warnSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  test("runtime initialization failure is handled without rejecting onload work", async () => {
    const monitor = createMonitor();
    jest.spyOn(monitor, "ensureBridge").mockRejectedValue(new Error("require unavailable"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(monitor.startMonitoring()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[SMTC] Desktop runtime initialization failed:",
      expect.objectContaining({ message: "require unavailable" })
    );
    errorSpy.mockRestore();
  });
});

describe("getActiveWindow", () => {
  class MockChildProcess extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
  }

  test("resolves with title when process closes normally", async () => {
    const child = new MockChildProcess();
    (spawn as jest.Mock).mockReturnValueOnce(child as any);

    const pending = getActiveWindow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    child.stdout.emit("data", Buffer.from("Obsidian Vault\n"));
    child.emit("close", 0);

    const result = await pending;
    expect((result as any).title).toBe("Obsidian Vault");
  });

  test("resolves empty title when process errors", async () => {
    const child = new MockChildProcess();
    (spawn as jest.Mock).mockReturnValueOnce(child as any);

    const pending = getActiveWindow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    child.emit("error", new Error("spawn failed"));

    const result = await pending;
    expect((result as any).title).toBe("");
  });
});
