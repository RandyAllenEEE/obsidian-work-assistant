import type { CommonTask } from "../services/caldav/sync/types";
import { classifyTask, getTaskActionDates, groupTasks } from "../ui/taskGrouping";

function task(overrides: Partial<CommonTask> = {}): CommonTask {
  return {
    uid: "task-1",
    title: "Task",
    status: "TODO",
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    createdDate: null,
    completedDate: null,
    priority: "none",
    tags: [],
    recurrenceRule: "",
    body: "",
    ...overrides,
  };
}

describe("task grouping", () => {
  const today = "2026-06-06";

  test("today wins when any actionable date is today", () => {
    expect(classifyTask(task({ startDate: today, dueDate: "2026-06-10" }), today)).toBe("today");
    expect(classifyTask(task({ scheduledDate: today, dueDate: "2026-06-10" }), today)).toBe("today");
  });

  test("started tasks are open even when their due date is in the future", () => {
    expect(classifyTask(task({ startDate: "2026-06-05", dueDate: "2026-06-10" }), today)).toBe("open");
  });

  test("only tasks whose actionable dates are all future are future", () => {
    expect(classifyTask(task({ startDate: "2026-06-07", dueDate: "2026-06-10" }), today)).toBe("future");
  });

  test("created date is metadata and does not make an undated task a today task", () => {
    expect(classifyTask(task({ createdDate: today }), today)).toBe("open");
    expect(getTaskActionDates(task({ createdDate: today }))).toEqual([]);
  });

  test("invalid dates are treated as undated", () => {
    expect(classifyTask(task({ dueDate: "2026-02-30" }), today)).toBe("open");
  });

  test("completed tasks are excluded", () => {
    expect(classifyTask(task({ status: "DONE", dueDate: today }), today)).toBeNull();
  });

  test("the supplied today value drives midnight rollover", () => {
    const rollingTask = task({ dueDate: "2026-06-07" });
    expect(classifyTask(rollingTask, "2026-06-06")).toBe("future");
    expect(classifyTask(rollingTask, "2026-06-07")).toBe("today");
  });

  test("groups sort by earliest action date then priority", () => {
    const grouped = groupTasks([
      task({ uid: "later", title: "Later", dueDate: "2026-06-10" }),
      task({ uid: "low", title: "Low", dueDate: today, priority: "low" }),
      task({ uid: "high", title: "High", dueDate: today, priority: "high" }),
    ], today);

    expect(grouped.today.map((item) => item.uid)).toEqual(["high", "low"]);
    expect(grouped.future.map((item) => item.uid)).toEqual(["later"]);
  });
});
