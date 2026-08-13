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
