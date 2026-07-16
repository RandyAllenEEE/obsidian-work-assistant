jest.mock("obsidian", () => {
  class TFile {
    path: string;
    constructor(path: string) {
      this.path = path;
    }
  }
  return { TFile };
});

import { ObsidianTasksWrapper, type ObsidianTask } from "../services/caldav/tasks/obsidianTasksWrapper";

function task(path: string, lineNumber: number): ObsidianTask {
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
  test("assigns duplicate Markdown rows to their own bodies and updates the requested row", async () => {
    const { TFile } = jest.requireMock("obsidian") as { TFile: new (path: string) => any };
    const file = new TFile("Tasks.md");
    let content = [
      "- [ ] Same",
      "  - first body",
      "- [ ] Same",
      "  - second body",
    ].join("\n");
    const tasks = [task(file.path, 0), task(file.path, 2)];
    const app = {
      plugins: { plugins: { "obsidian-tasks-plugin": { getTasks: () => tasks } } },
      vault: {
        getAbstractFileByPath: jest.fn(() => file),
        read: jest.fn(async () => content),
        modify: jest.fn(async (_file: unknown, next: string) => { content = next; }),
      },
    } as any;
    const wrapper = new ObsidianTasksWrapper(app);
    expect(wrapper.initialize()).toBe(true);

    const withBodies = await wrapper.getTasksWithBody(tasks);
    expect(app.vault.read).toHaveBeenCalledTimes(1);
    expect(withBodies.map((entry) => entry.body)).toEqual(["first body", "second body"]);

    await wrapper.updateTaskInVault(tasks[1], "- [ ] Updated second");
    expect(content).toBe([
      "- [ ] Same",
      "  - first body",
      "- [ ] Updated second",
    ].join("\n"));
  });
});
