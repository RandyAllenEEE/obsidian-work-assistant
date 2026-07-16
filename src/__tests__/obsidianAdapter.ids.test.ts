jest.mock("../services/caldav/utils/taskIdGenerator", () => {
  const actual = jest.requireActual("../services/caldav/utils/taskIdGenerator");
  return { ...actual, generateTaskId: jest.fn() };
});

import { ObsidianAdapter } from "../services/caldav/sync/obsidianAdapter";
import type { CommonTask } from "../services/caldav/sync/types";
import { generateTaskId } from "../services/caldav/utils/taskIdGenerator";

function task(uid: string): CommonTask {
  return {
    uid,
    title: uid,
    status: "TODO",
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    completedDate: null,
    priority: "none",
    tags: [],
    recurrenceRule: "",
    body: "",
  };
}

describe("ObsidianAdapter task ID allocation", () => {
  test("deduplicates generated IDs within a remote-create batch", async () => {
    const mockedGenerate = generateTaskId as jest.MockedFunction<typeof generateTaskId>;
    mockedGenerate
      .mockReturnValueOnce("20260715-aaaaaaaa")
      .mockReturnValueOnce("20260715-aaaaaaaa")
      .mockReturnValueOnce("20260715-bbbbbbbb");
    const wrapper = {
      getTasksPluginConfig: jest.fn(async () => ({ format: "emoji", globalFilter: "" })),
      createTask: jest.fn(async () => undefined),
    };
    const adapter = new ObsidianAdapter(wrapper as any, {
      newTasksDestination: "Inbox.md",
    });

    const result = await adapter.applyChanges([
      { type: "create", task: task("remote-1") },
      { type: "create", task: task("remote-2") },
    ]);

    expect(result.createdMappings).toEqual([
      { taskId: "20260715-aaaaaaaa", caldavUID: "remote-1" },
      { taskId: "20260715-bbbbbbbb", caldavUID: "remote-2" },
    ]);
    expect(wrapper.createTask).toHaveBeenCalledTimes(2);
  });
});
