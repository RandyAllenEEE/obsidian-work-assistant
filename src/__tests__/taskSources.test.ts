import moment from "moment";
import { get } from "svelte/store";

import { dailyNoteChecklistSource, getNumberOfRemainingTasks } from "../ui/sources/dailyNoteChecklist";
import { tasksSource } from "../ui/sources/tasks";
import { tasksStore } from "../ui/stores";

jest.mock("obsidian-daily-notes-interface", () => ({
  getDailyNote: jest.fn((_date, notes) => notes["2026-06-06"] ?? null),
  getWeeklyNote: jest.fn(() => null),
}));

describe("task calendar sources", () => {
  beforeEach(() => {
    (global as any).window = {
      app: {
        vault: {
          cachedRead: jest.fn(async () => "- [ ] open\n- [x] done\n* [ ] also open"),
        },
      },
      moment,
    };
    tasksStore.set({
      tasks: [],
      ready: true,
      loading: false,
      syncing: false,
    });
  });

  test("renamed daily note checklist source keeps old hollow dot behavior", async () => {
    const count = await getNumberOfRemainingTasks({ path: "Daily/2026-06-06.md" } as any);
    const metadata = await dailyNoteChecklistSource.getDailyMetadata(moment("2026-06-06"));

    expect(count).toBe(2);
    expect(metadata.dots).toHaveLength(1);
    expect(metadata.dots[0].className).toBe("task");
    expect(metadata.dots[0].isFilled).toBe(false);
  });

  test("new tasks source marks dates with open synced tasks", async () => {
    tasksStore.set({
      ready: true,
      loading: false,
      syncing: false,
      tasks: [
        {
          uid: "1",
          title: "Due today",
          status: "TODO",
          dueDate: "2026-06-06",
          startDate: null,
          scheduledDate: null,
          completedDate: null,
          priority: "none",
          tags: [],
          recurrenceRule: "",
          body: "",
        },
      ],
    });

    const metadata = await tasksSource.getDailyMetadata(moment("2026-06-06"));

    expect(get(tasksStore).tasks).toHaveLength(1);
    expect(metadata.dots).toHaveLength(1);
    expect(metadata.dots[0].className).toBe("caldav-task");
  });
});
