jest.mock("obsidian", () => {
  class Component {
    registerEvent(eventRef: unknown) {
      return eventRef;
    }
  }
  class Modal {}
  class TFile {
    extension: string;
    constructor(extension = "md") {
      this.extension = extension;
    }
  }
  class TFolder {}
  return {
    Component,
    Modal,
    TFile,
    TFolder,
    Notice: jest.fn(),
    debounce: (fn: (...args: unknown[]) => unknown) => fn,
    normalizePath: (path: string) => path,
    requestUrl: jest.fn(),
  };
});

jest.mock("svelte/store", () => ({
  writable: (initial: unknown) => {
    let value = initial;
    return {
      set: (next: unknown) => {
        value = next;
      },
      update: (updater: (current: unknown) => unknown) => {
        value = updater(value);
      },
      subscribe: (subscriber: (current: unknown) => void) => {
        subscriber(value);
        return () => undefined;
      },
      __get: () => value,
    };
  },
  get: (store: { __get: () => unknown }) => store.__get(),
}));

jest.mock("../ui/stores", () => ({
  defaultTaskSyncState: {
    syncedTasks: [],
    syncStatus: "idle",
  },
  tasksStore: {
    set: jest.fn(),
    update: jest.fn(),
    subscribe: jest.fn(() => () => undefined),
  },
}));

import { TaskSyncManager } from "../services/caldav/TaskSyncManager";

describe("TaskSyncManager secret handling", () => {
  test("runtime settings resolve password from secret storage without mutating saved settings", () => {
    const plugin = {
      app: {
        secretStorage: {
          getSecret: jest.fn(() => "real-password"),
        },
        vault: {
          getName: jest.fn(() => "Vault"),
          on: jest.fn(),
        },
      },
      options: {
        assistant: {
          tasks: {
            enabled: true,
            syncInterval: 5,
            newTasksDestination: "Inbox.md",
            newTasksSection: "",
            autoResolveObsidianWins: false,
            includeObsidianLink: false,
            showAutoSyncNotifications: false,
            excludedPaths: [],
            calendar: {
              obsidianTag: "sync",
              caldavCategory: "sync",
              calendarName: "Work",
              serverUrl: "https://caldav.example.test",
              username: "randy",
              passwordSecretId: "secret-id",
            },
          },
        },
      },
      registerInterval: jest.fn(),
      writeOptions: jest.fn(),
    };

    const manager = new TaskSyncManager(plugin as any);
    const runtime = (manager as any).buildRuntimeSettings();

    expect(runtime.settings.calendar.password).toBe("real-password");
    expect(plugin.app.secretStorage.getSecret).toHaveBeenCalledWith("secret-id");
    expect(plugin.options.assistant.tasks.calendar).not.toHaveProperty("password");
    expect(plugin.options.assistant.tasks.calendar.passwordSecretId).toBe("secret-id");
  });

  test("a Vault change schedules a debounced local inspection", () => {
    const plugin = {
      app: { vault: { on: jest.fn() } },
      options: { assistant: { tasks: { enabled: true } } },
    };
    const manager = new TaskSyncManager(plugin as any) as any;
    const inspect = jest.fn();
    manager.runLocalInspection = inspect;
    manager.configurationGeneration = 4;
    const { TFile } = jest.requireMock("obsidian") as { TFile: new () => unknown };

    const file = new TFile() as any;
    manager.onVaultChanged(file);

    expect(manager.localInspectionTimer).not.toBeNull();
    expect(inspect).not.toHaveBeenCalled();
  });

  test("refresh compatibility alias delegates to the server refresh", async () => {
    const plugin = {
      app: { vault: { on: jest.fn() } },
      options: {
        assistant: {
          tasks: {
            enabled: true,
            calendar: { calendarName: "Work" },
          },
        },
      },
    };
    const manager = new TaskSyncManager(plugin as any) as any;
    const refreshRemoteTasks = jest.fn(async () => undefined);
    manager.refreshRemoteTasks = refreshRemoteTasks;

    await manager.refreshLocalTasks();

    expect(refreshRemoteTasks).toHaveBeenCalledTimes(1);
  });
});


describe("TaskSyncManager non-blocking startup", () => {
  function fixture() {
    const callbacks: Array<() => void> = [];
    const plugin = {
      app: {
        workspace: { onLayoutReady: (callback: () => void) => callbacks.push(callback) },
        vault: { on: jest.fn() },
      },
      options: { assistant: { tasks: { enabled: false } } },
      taskSyncManager: null as TaskSyncManager | null,
    };
    const manager = new TaskSyncManager(plugin as unknown as ConstructorParameters<typeof TaskSyncManager>[0]);
    plugin.taskSyncManager = manager;
    return { plugin, manager, callbacks };
  }

  test("defers network work and returns while initial synchronization is pending", async () => {
    const { manager, callbacks } = fixture();
    let complete!: () => void;
    const configure = jest.spyOn(manager, "configure").mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    expect(manager.startAfterLayoutReady()).toBeUndefined();
    expect(configure).not.toHaveBeenCalled();
    expect(callbacks[0]()).toBeUndefined();
    expect(configure).toHaveBeenCalledTimes(1);
    complete();
    await Promise.resolve();
  });

  test("does not start synchronization after unload before layout readiness", () => {
    const { manager, callbacks } = fixture();
    const configure = jest.spyOn(manager, "configure").mockResolvedValue(undefined);
    manager.startAfterLayoutReady();
    manager.onunload();
    callbacks[0]();
    expect(configure).not.toHaveBeenCalled();
  });

  test("does not restart a manager already configured by a settings change", async () => {
    const { manager, callbacks } = fixture();
    const configure = jest.spyOn(manager, "configure");
    manager.startAfterLayoutReady();
    await manager.configure();
    callbacks[0]();
    expect(configure).toHaveBeenCalledTimes(1);
  });

  test("reports an active startup failure in the task panel without an unhandled rejection", async () => {
    const { manager, callbacks } = fixture();
    const { tasksStore } = jest.requireMock("../ui/stores");
    const error = new Error("fixture network failure");
    jest.spyOn(manager, "configure").mockRejectedValue(error);
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    tasksStore.set.mockClear();
    manager.startAfterLayoutReady();
    callbacks[0]();
    await Promise.resolve();
    expect(tasksStore.set).toHaveBeenCalledWith(expect.objectContaining({ error: error.message }));
    expect(log).toHaveBeenCalledWith("[Work Assistant] Initial task synchronization failed:", error);
    log.mockRestore();
  });

  test("ignores a failure from an unloaded manager after replacement", async () => {
    const { manager, plugin, callbacks } = fixture();
    const { tasksStore } = jest.requireMock("../ui/stores");
    let reject!: (error: Error) => void;
    jest.spyOn(manager, "configure").mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    manager.startAfterLayoutReady();
    callbacks[0]();
    manager.onunload();
    plugin.taskSyncManager = new TaskSyncManager(plugin as unknown as ConstructorParameters<typeof TaskSyncManager>[0]);
    tasksStore.set.mockClear();
    reject(new Error("stale failure"));
    await Promise.resolve();
    expect(tasksStore.set).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
