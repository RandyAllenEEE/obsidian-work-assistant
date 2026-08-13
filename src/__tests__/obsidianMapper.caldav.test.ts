import { ObsidianMapper } from "../services/caldav/tasks/obsidianMapper";
import type { ObsidianTask } from "../services/caldav/tasks/obsidianTasksWrapper";

function fakeTask(overrides: Partial<ObsidianTask> = {}): ObsidianTask {
  return {
    description: "Write proposal #sync",
    status: { configuration: { symbol: " ", name: "Todo", type: "TODO" } },
    isDone: false,
    priority: "2",
    tags: ["sync", "client"],
    taskLocation: { path: "Inbox.md" },
    originalMarkdown: "- [ ] Write proposal #sync",
    createdDate: { format: () => "2026-06-01" },
    startDate: null,
    scheduledDate: null,
    dueDate: { format: () => "2026-06-08" },
    doneDate: null,
    cancelledDate: null,
    recurrence: { toText: () => "every week" },
    id: "20260606-abc",
    ...overrides,
  };
}

describe("ObsidianMapper", () => {
  test("maps obsidian-tasks cache objects to CommonTask", () => {
    const mapper = new ObsidianMapper();

    const common = mapper.toCommonTask(fakeTask(), "20260606-abc", "Body line");

    expect(common.uid).toBe("20260606-abc");
    expect(common.title).toBe("Write proposal");
    expect(common.dueDate).toBe("2026-06-08");
    expect(common.createdDate).toBe("2026-06-01");
    expect(common.priority).toBe("high");
    expect(common.tags).toEqual(["sync", "client"]);
    expect(common.recurrenceRule).toBe("FREQ=WEEKLY");
    expect(common.body).toBe("Body line");
  });
});
