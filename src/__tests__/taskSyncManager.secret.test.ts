jest.mock("obsidian", () => {
  class Component {
    registerEvent(eventRef: unknown) {
      return eventRef;
    }
  }
  class Modal {}
  class TFile {}
  return {
    Component,
    Modal,
    TFile,
    Notice: jest.fn(),
    debounce: (fn: (...args: unknown[]) => unknown) => fn,
    normalizePath: (path: string) => path,
    requestUrl: jest.fn(),
  };
});

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
            appliedMigrations: [],
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
});
