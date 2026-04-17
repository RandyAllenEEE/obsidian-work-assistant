import { EventEmitter } from "events";
import { spawn } from "child_process";
import { SystemMediaMonitor, getActiveWindow } from "../smtc/SystemMediaMonitor";

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
  function readStoreValue<T>(store: { subscribe: (fn: (value: T) => void) => () => void }): T | undefined {
    let value: T | undefined;
    const unsubscribe = store.subscribe((v) => {
      value = v;
    });
    unsubscribe();
    return value;
  }

  function createMonitor() {
    const plugin = {
      app: {
        vault: {
          adapter: {
            getBasePath: () => "E:/vault",
          },
        },
      },
      manifest: {
        dir: ".obsidian/plugins/obsidian-work-assistant",
      },
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

  test("processBuffer parses JSON payload and updates store", () => {
    const monitor = createMonitor();
    monitor.buffer = 'noiseJSON_START{"Title":"Song","Artist":"A"}JSON_ENDtail';
    monitor.processBuffer();
    const state = readStoreValue<any>(monitor.mediaStore);
    expect(state?.Title).toBe("Song");
    expect(state?.Artist).toBe("A");
  });

  test("processBuffer handles null payload", () => {
    const monitor = createMonitor();
    monitor.buffer = "JSON_STARTnullJSON_END";
    monitor.processBuffer();
    expect(readStoreValue(monitor.mediaStore)).toBeNull();
  });

  test("processBuffer clears oversized buffer", () => {
    const monitor = createMonitor();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    monitor.buffer = "x".repeat(10001);
    monitor.processBuffer();
    expect(monitor.buffer).toBe("");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
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
    child.stdout.emit("data", Buffer.from("Obsidian Vault\n"));
    child.emit("close", 0);

    const result = await pending;
    expect((result as any).title).toBe("Obsidian Vault");
  });

  test("resolves empty title when process errors", async () => {
    const child = new MockChildProcess();
    (spawn as jest.Mock).mockReturnValueOnce(child as any);

    const pending = getActiveWindow();
    child.emit("error", new Error("spawn failed"));

    const result = await pending;
    expect((result as any).title).toBe("");
  });
});
