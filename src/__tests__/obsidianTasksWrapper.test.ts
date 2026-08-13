jest.mock("obsidian", () => {
  class TFile {
    constructor(public path: string) {}
  }
  return { TFile };
});

import {
  ObsidianTasksWrapper,
  type ObsidianTask,
} from "../services/caldav/tasks/obsidianTasksWrapper";

function createTask(path: string, lineNumber: number): ObsidianTask {
  return {
    description: "Same",
    status: { configuration: { symbol: " ", name: "Todo", type: "TODO" } },
    isDone: false,
    priority: "none",
    tags: [],
    taskLocation: { path, _lineNumber: lineNumber },
    originalMarkdown: "- [ ] Same",
    createdDate: null,
    startDate: null,
    scheduledDate: null,
    dueDate: null,
    doneDate: null,
    cancelledDate: null,
    recurrence: null,
    id: "",
  };
}

describe("ObsidianTasksWrapper task location", () => {
  test("reads duplicate rows once and atomically updates the requested row", async () => {
    const { TFile } = jest.requireMock("obsidian") as { TFile: new (path: string) => { path: string } };
    const file = new TFile("Tasks.md");
    let content = [
      "- [ ] Same",
      "  - first body",
      "- [ ] Same",
      "  - second body",
    ].join("\n");
    const tasks = [createTask(file.path, 0), createTask(file.path, 2)];
    const app = {
      plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => tasks } } },
      vault: {
        getAbstractFileByPath: jest.fn(() => file),
        read: jest.fn(async () => content),
        process: jest.fn(async (_file: unknown, update: (value: string) => string) => {
          content = update(content);
        }),
      },
    };
    const wrapper = new ObsidianTasksWrapper(app as any);
    expect(wrapper.initialize()).toBe(true);

    const withBodies = await wrapper.getTasksWithBody(tasks);
    expect(app.vault.read).toHaveBeenCalledTimes(1);
    expect(withBodies.map((entry) => entry.body)).toEqual(["first body", "second body"]);

    await wrapper.updateTaskInVault(tasks[1], "- [ ] Updated second");
    expect(app.vault.process).toHaveBeenCalledTimes(1);
    expect(content).toBe([
      "- [ ] Same",
      "  - first body",
      "- [ ] Updated second",
    ].join("\n"));
  });

  test("injecting an ID changes only the task line and preserves its notes", async () => {
    const { TFile } = jest.requireMock("obsidian") as { TFile: new (path: string) => { path: string } };
    const file = new TFile("Tasks.md");
    let content = [
      "- [ ] Same #sync",
      "  - keep this note",
      "  - and this subtask",
    ].join("\n");
    const task = createTask(file.path, 0);
    task.originalMarkdown = "- [ ] Same #sync";
    const app = {
      plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => [task] } } },
      vault: {
        getAbstractFileByPath: jest.fn(() => file),
        process: jest.fn(async (_file: unknown, update: (value: string) => string) => {
          content = update(content);
        }),
      },
    };
    const wrapper = new ObsidianTasksWrapper(app as any);

    await wrapper.updateTaskLineInVault(task, "- [ ] Same #sync 🆔 20260812-abcd1234");

    expect(content).toBe([
      "- [ ] Same #sync 🆔 20260812-abcd1234",
      "  - keep this note",
      "  - and this subtask",
    ].join("\n"));
  });

  test("finds a just-persisted ID before the Tasks cache has refreshed", async () => {
    const { TFile } = jest.requireMock("obsidian") as { TFile: new (path: string) => { path: string } };
    const file = new TFile("Tasks.md");
    const cachedTask = createTask(file.path, 0);
    let content = "- [ ] Same 🆔 20260812-abcd1234";
    const app = {
      plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => [cachedTask] } } },
      vault: {
        getAbstractFileByPath: jest.fn(() => file),
        read: jest.fn(async () => content),
      },
    };
    const wrapper = new ObsidianTasksWrapper(app as any);

    await expect(wrapper.getPersistedTaskIdentity(cachedTask)).resolves.toEqual({
      found: true,
      id: "20260812-abcd1234",
    });

    content = "- [ ] Changed entirely";
    await expect(wrapper.getPersistedTaskIdentity(cachedTask)).resolves.toEqual({ found: false, id: null });
  });

  test("a recurring toggle keeps existing notes with the completed task", async () => {
    const { TFile } = jest.requireMock("obsidian") as { TFile: new (path: string) => { path: string } };
    const file = new TFile("Tasks.md");
    let content = [
      "- [ ] Weekly 🆔 20260812-abcd1234",
      "  - original note",
      "- [ ] Later",
    ].join("\n");
    const task = createTask(file.path, 0);
    task.originalMarkdown = "- [ ] Weekly 🆔 20260812-abcd1234";
    task.id = "20260812-abcd1234";
    const app = {
      plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => [task] } } },
      vault: {
        getAbstractFileByPath: jest.fn(() => file),
        process: jest.fn(async (_file: unknown, update: (value: string) => string) => {
          content = update(content);
        }),
      },
    };
    const wrapper = new ObsidianTasksWrapper(app as any);

    await wrapper.applyToggleResult(task, [
      "- [x] Weekly 🆔 20260812-abcd1234 ✅ 2026-08-12",
      "- [ ] Weekly 🆔 20260819-ef012345",
    ].join("\n"));

    expect(content).toBe([
      "- [x] Weekly 🆔 20260812-abcd1234 ✅ 2026-08-12",
      "  - original note",
      "- [ ] Weekly 🆔 20260819-ef012345",
      "- [ ] Later",
    ].join("\n"));
  });
});
