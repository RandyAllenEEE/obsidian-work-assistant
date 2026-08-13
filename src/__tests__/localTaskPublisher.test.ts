jest.mock("obsidian", () => {
  class TFile {
    constructor(public path: string) {}
  }
  return { TFile };
});

import { LocalTaskPublisher } from "../services/caldav/localTaskPublisher";
import type { ObsidianTask } from "../services/caldav/tasks/obsidianTasksWrapper";

function localTask(path: string, id: string, overrides: Partial<ObsidianTask> = {}): ObsidianTask {
  return {
    description: "Local task #sync",
    status: { configuration: { symbol: " ", name: "Todo", type: "TODO" } },
    isDone: false,
    priority: "none",
    tags: ["sync"],
    taskLocation: { path, _lineNumber: 0 },
    originalMarkdown: `- [ ] Local task #sync 🆔 ${id}`,
    createdDate: null,
    startDate: null,
    scheduledDate: null,
    dueDate: null,
    doneDate: null,
    cancelledDate: null,
    recurrence: null,
    id,
    ...overrides,
  };
}

function createPublisher(
  tasks: ObsidianTask[],
  initialContent: Record<string, string>,
  options: { syncTag?: string; excludedPaths?: string[]; globalFilter?: string } = {},
) {
  const { TFile } = jest.requireMock("obsidian") as { TFile: new (path: string) => { path: string } };
  const files = new Map(
    Object.keys(initialContent).map((path) => [path, new TFile(path)]),
  );
  const content = new Map(Object.entries(initialContent));
  const tasksPlugin = {
    getTasks: jest.fn(() => tasks),
    loadData: jest.fn(async () => ({ taskFormat: "emoji", globalFilter: options.globalFilter ?? "" })),
    apiV1: { executeToggleTaskDoneCommand: jest.fn() },
  };
  const vault = {
    getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
    read: jest.fn(async (file: { path: string }) => content.get(file.path) ?? ""),
    process: jest.fn(async (file: { path: string }, update: (value: string) => string) => {
      content.set(file.path, update(content.get(file.path) ?? ""));
    }),
  };
  const app = {
    plugins: { plugins: { "obsidian-tasks-plugin": tasksPlugin } },
    vault,
  };
  const publisher = new LocalTaskPublisher(app as any, {
    syncTag: options.syncTag ?? "sync",
    excludedPaths: options.excludedPaths ?? [],
    includeObsidianLink: false,
    getVaultName: () => "Vault",
  });
  return { content, publisher, tasksPlugin, vault };
}

describe("LocalTaskPublisher", () => {
  test("requires the sync tag while honoring Tasks global filters and excluded paths", async () => {
    const included = localTask("Work.md", "20260813-abcd1234");
    const untagged = localTask("Other.md", "20260813-bcde2345", { tags: [] });
    const excluded = localTask("Archive/Old.md", "20260813-cdef3456");
    const { publisher } = createPublisher([included, untagged, excluded], {
      "Work.md": included.originalMarkdown,
      "Other.md": untagged.originalMarkdown,
      "Archive/Old.md": excluded.originalMarkdown,
    }, { excludedPaths: ["Archive/"] });

    const inspection = await publisher.inspect();
    expect(inspection.openTasks).toEqual([included]);

    const globallyFiltered = localTask("Global.md", "20260813-defa4567", { tags: [] });
    const { publisher: globalPublisher } = createPublisher([globallyFiltered], {
      "Global.md": globallyFiltered.originalMarkdown,
    }, { syncTag: "global", globalFilter: "#global" });
    await expect(globalPublisher.inspect()).resolves.toMatchObject({ openTasks: [globallyFiltered] });
  });

  test("atomically assigns a stable ID before publishing a task without one", async () => {
    const withoutId = localTask("Tasks.md", "", {
      originalMarkdown: "- [ ] New local task #sync",
    });
    const { content, publisher, vault } = createPublisher([withoutId], {
      "Tasks.md": withoutId.originalMarkdown,
    });

    const result = await publisher.scan();

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].localTaskId).toMatch(/^\d{8}-[0-9a-f]{8}$/);
    expect(content.get("Tasks.md")).toContain(`🆔 ${result.candidates[0].localTaskId}`);
    expect(vault.process).toHaveBeenCalledTimes(1);
  });

  test("does not read bodies or republish ordinary edits of an associated task", async () => {
    const id = "20260812-abcd1234";
    const task = localTask("Tasks.md", id, {
      description: "Locally renamed #sync",
      dueDate: "2026-09-01",
    });
    const { publisher, vault } = createPublisher([task], {
      "Tasks.md": `${task.originalMarkdown}\n  - private body`,
    });

    const result = await publisher.scan(
      new Set(),
      new Set([id]),
      new Map([[id, "Tasks.md"]]),
    );

    expect(result.candidates).toEqual([]);
    expect(result.tasksById.get(id)).toBe(task);
    expect(vault.read).not.toHaveBeenCalled();
    expect(vault.process).not.toHaveBeenCalled();
  });

  test("keeps the associated path identity and gives a copied duplicate a fresh ID", async () => {
    const oldId = "20260812-abcd1234";
    const original = localTask("Original.md", oldId);
    const copied = localTask("Copy.md", oldId);
    const { content, publisher, vault } = createPublisher([copied, original], {
      "Original.md": original.originalMarkdown,
      "Copy.md": `${copied.originalMarkdown}\n  - copied body`,
    });

    const result = await publisher.scan(
      new Set(),
      new Set([oldId]),
      new Map([[oldId, "Original.md"]]),
    );

    expect(result.candidates).toHaveLength(1);
    const duplicate = result.candidates[0];
    expect(duplicate.original).toBe(copied);
    expect(duplicate.localTaskId).not.toBe(oldId);
    expect(duplicate.localTaskId).toMatch(/^\d{8}-[0-9a-f]{8}$/);
    expect(duplicate.task.body).toBe("copied body");
    expect(content.get("Original.md")).toBe(original.originalMarkdown);
    expect(content.get("Copy.md")).toContain(`🆔 ${duplicate.localTaskId}`);
    expect(content.get("Copy.md")).not.toContain(`🆔 ${oldId}`);
    expect(result.tasksById.get(oldId)).toBe(original);
    expect(vault.process).toHaveBeenCalledTimes(1);
  });

  test("does not publish a task completed before its first create was confirmed", async () => {
    const id = "20260812-abcd1234";
    const completed = localTask("Tasks.md", id, {
      isDone: true,
      doneDate: "2026-08-12",
      originalMarkdown: `- [x] Local task #sync 🆔 ${id} ✅ 2026-08-12`,
    });
    const { publisher } = createPublisher([completed], {
      "Tasks.md": completed.originalMarkdown,
    });

    const result = await publisher.scan(
      new Set([id]),
      new Set(),
      new Map(),
    );

    expect(result.candidates).toEqual([]);
    expect(result.tasksById.get(id)).toBe(completed);
  });

  test("does not publish a stale cached task whose Markdown file was deleted", async () => {
    const id = "20260812-abcd1234";
    const stale = localTask("Deleted.md", id);
    const { publisher, vault } = createPublisher([stale], {});

    const result = await publisher.scan(new Set(), new Set(), new Map());

    expect(result.candidates).toEqual([]);
    expect(vault.process).not.toHaveBeenCalled();
  });

  test("does not treat a deleted cached task as an actionable path event", async () => {
    const id = "20260812-abcd1234";
    const stale = localTask("Deleted.md", id);
    const { publisher, vault } = createPublisher([stale], {});

    await expect(publisher.hasEligibleTaskAtPaths(new Set(["Deleted.md"]))).resolves.toBe(false);

    expect(vault.read).not.toHaveBeenCalled();
  });

  test("reads a candidate file once for both bodies and persisted IDs", async () => {
    const first = localTask("Tasks.md", "20260812-abcd1234", {
      originalMarkdown: "- [ ] First #sync 🆔 20260812-abcd1234",
    });
    const second = localTask("Tasks.md", "20260812-ef012345", {
      description: "Second #sync",
      taskLocation: { path: "Tasks.md", _lineNumber: 1 },
      originalMarkdown: "- [ ] Second #sync 🆔 20260812-ef012345",
    });
    const { publisher, vault } = createPublisher([first, second], {
      "Tasks.md": [
        `${first.originalMarkdown}\n  - first body`,
        `${second.originalMarkdown}\n  - second body`,
      ].join("\n"),
    });

    const result = await publisher.scan(new Set(), new Set(), new Map());

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((item) => item.task.body)).toEqual(["first body", "second body"]);
    expect(vault.read).toHaveBeenCalledTimes(1);
  });

  test("revalidates multiple candidates in one file with a single read", async () => {
    const first = localTask("Tasks.md", "20260812-abcd1234", {
      originalMarkdown: "- [ ] First #sync 🆔 20260812-abcd1234",
    });
    const second = localTask("Tasks.md", "20260812-ef012345", {
      description: "Second #sync",
      taskLocation: { path: "Tasks.md", _lineNumber: 1 },
      originalMarkdown: "- [ ] Second #sync 🆔 20260812-ef012345",
    });
    const { publisher, vault } = createPublisher([first, second], {
      "Tasks.md": [first.originalMarkdown, second.originalMarkdown].join("\n"),
    });
    const candidates = [
      { localTaskId: first.id, original: first, task: {} as any },
      { localTaskId: second.id, original: second, task: {} as any },
    ];

    await expect(publisher.confirmPresentCandidates(candidates)).resolves.toEqual(new Set(candidates));
    expect(vault.read).toHaveBeenCalledTimes(1);
  });

  test("splits a manually completed recurring instance from its copied successor", async () => {
    const oldId = "20260812-abcd1234";
    const completed = localTask("Tasks.md", oldId, {
      isDone: true,
      doneDate: "2026-08-12",
      originalMarkdown: `- [x] Local task #sync 🆔 ${oldId} ✅ 2026-08-12`,
    });
    const successor = localTask("Tasks.md", oldId, {
      taskLocation: { path: "Tasks.md", _lineNumber: 1 },
      originalMarkdown: `- [ ] Local task #sync 🆔 ${oldId}`,
    });
    const { content, publisher } = createPublisher([completed, successor], {
      "Tasks.md": [completed.originalMarkdown, successor.originalMarkdown].join("\n"),
    });

    const result = await publisher.scan(
      new Set(),
      new Set([oldId]),
      new Map([[oldId, "Tasks.md"]]),
    );

    expect(result.completedTaskIds).toEqual(new Set([oldId]));
    expect(result.tasksById.get(oldId)).toBe(completed);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].original).toBe(successor);
    expect(result.candidates[0].localTaskId).not.toBe(oldId);
    expect(content.get("Tasks.md")).toContain(`🆔 ${oldId} ✅ 2026-08-12`);
    expect(content.get("Tasks.md")).toContain(`🆔 ${result.candidates[0].localTaskId}`);
  });
});
