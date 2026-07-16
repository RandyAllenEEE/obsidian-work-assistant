jest.mock("obsidian", () => ({
  requestUrl: jest.fn(),
  normalizePath: (path: string) => path,
}));

import { CalDAVClientDirect } from "../services/caldav/caldav/calDAVClientDirect";
import { VTODOMapper } from "../services/caldav/caldav/vtodoMapper";
import { diff, tasksEqual } from "../services/caldav/sync/diff";
import { CalDAVAdapter } from "../services/caldav/sync/caldavAdapter";
import { shouldExcludeTaskPath } from "../services/caldav/sync/obsidianAdapter";
import { generateTaskId, isValidTaskId } from "../services/caldav/utils/taskIdGenerator";
import type { CommonTask } from "../services/caldav/sync/types";

function task(overrides: Partial<CommonTask> = {}): CommonTask {
  return {
    uid: "task-1",
    title: "Prepare report",
    status: "TODO",
    dueDate: "2026-06-06",
    startDate: null,
    scheduledDate: null,
    completedDate: null,
    priority: "none",
    tags: [],
    recurrenceRule: "",
    body: "",
    ...overrides,
  };
}

describe("CalDAV sync core", () => {
  test("diff sends an Obsidian-only edit to CalDAV", () => {
    const baseline = [task()];
    const obsidian = [task({ title: "Prepare final report" })];
    const caldav = [task()];

    const changes = diff(obsidian, caldav, baseline, "caldav-wins");

    expect(changes.toCalDAV).toHaveLength(1);
    expect(changes.toCalDAV[0].type).toBe("update");
    expect(changes.toCalDAV[0].task.title).toBe("Prepare final report");
    expect(changes.toObsidian).toHaveLength(0);
  });

  test("vtodo mapper round-trips core task fields", () => {
    const mapper = new VTODOMapper();
    const ics = mapper.taskToVTODO(
      task({
        title: "Review CalDAV sync",
        dueDate: "2026-06-10",
        priority: "high",
        tags: ["work"],
        body: "Check edge cases",
      }),
      "caldav-1"
    );

    const parsed = mapper.vtodoToTask({ data: ics, url: "https://example.test/task.ics" });

    expect(mapper.extractUID(ics)).toBe("caldav-1");
    expect(parsed.title).toBe("Review CalDAV sync");
    expect(parsed.dueDate).toBe("2026-06-10");
    expect(parsed.priority).toBe("high");
    expect(parsed.tags).toContain("work");
    expect(parsed.body).toBe("Check edge cases");
  });

  test("vtodo mapper preserves distinct start and scheduled dates", () => {
    const mapper = new VTODOMapper();
    const ics = mapper.taskToVTODO(task({
      startDate: "2026-06-01",
      scheduledDate: "2026-06-03",
    }), "caldav-dates");

    const parsed = mapper.vtodoToTask({ data: ics, url: "https://example.test/dates.ics" });
    expect(parsed.startDate).toBe("2026-06-01");
    expect(parsed.scheduledDate).toBe("2026-06-03");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260601");
  });

  test("task equality treats tags as an unordered case-insensitive set", () => {
    expect(tasksEqual(
      task({ tags: ["#Work", "urgent"] }),
      task({ tags: ["URGENT", "work", "work"] })
    )).toBe(true);
  });

  test("new task IDs use eight hex digits while legacy IDs remain valid", () => {
    const generated = generateTaskId();
    expect(generated).toMatch(/^\d{8}-[0-9a-f]{8}$/);
    expect(isValidTaskId(generated)).toBe(true);
    expect(isValidTaskId("20250105-a4f")).toBe(true);
  });

  test("Basic Auth encodes non-ASCII credentials as UTF-8", () => {
    const client = new CalDAVClientDirect({
      serverUrl: "https://example.test",
      username: "用户",
      password: "päss",
      calendarName: "Tasks",
    });
    const expected = Buffer.from("用户:päss", "utf8").toString("base64");
    expect((client as any).authHeader).toBe(`Basic ${expected}`);
  });

  test("CalDAV adapter reuses the initial UID index for updates and deletes", async () => {
    const mapper = new VTODOMapper();
    const remote = {
      url: "https://example.test/cal/remote-1.ics",
      etag: "one",
      data: mapper.taskToVTODO(task({ tags: ["sync"] }), "remote-1"),
    };
    const client = {
      connect: jest.fn(async () => undefined),
      fetchVTODOs: jest.fn(async () => [remote]),
      createVTODO: jest.fn(async () => undefined),
      updateVTODO: jest.fn(async () => undefined),
      deleteVTODO: jest.fn(async () => undefined),
      deleteVTODOByUID: jest.fn(async () => undefined),
      fetchVTODOByUID: jest.fn(async () => null),
    };
    const adapter = new CalDAVAdapter(client, "sync", mapper);
    const mapping = {
      taskIdToCaldavUid: { "task-1": "remote-1" },
      caldavUidToTaskId: { "remote-1": "task-1" },
    };

    await adapter.fetchTasks(mapping);
    await adapter.applyChanges([
      { type: "update", task: task({ title: "Updated" }) },
      { type: "delete", task: task() },
    ], mapping);

    expect(client.fetchVTODOs).toHaveBeenCalledTimes(1);
    expect(client.fetchVTODOByUID).not.toHaveBeenCalled();
    expect(client.updateVTODO).toHaveBeenCalledTimes(1);
    expect(client.deleteVTODO).toHaveBeenCalledTimes(1);
  });

  test("CalDAV XML parser extracts VTODO calendar data and etags", () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
        <d:response>
          <d:href>/cal/task.ics</d:href>
          <d:propstat>
            <d:prop>
              <d:getetag>&quot;abc&quot;</d:getetag>
              <cal:calendar-data>BEGIN:VCALENDAR&#xA;BEGIN:VTODO&#xA;UID:abc&#xA;SUMMARY:Task&#xA;END:VTODO&#xA;END:VCALENDAR</cal:calendar-data>
            </d:prop>
          </d:propstat>
        </d:response>
      </d:multistatus>`;

    const vtodos = CalDAVClientDirect.parseVTODOsFromXML(xml, "https://example.test");

    expect(vtodos).toHaveLength(1);
    expect(vtodos[0].url).toBe("https://example.test/cal/task.ics");
    expect(vtodos[0].etag).toBe("abc");
    expect(vtodos[0].data).toContain("UID:abc");
  });

  test("task exclude paths support exact files, folders, and regex", () => {
    const patterns = ["Inbox/private.md", "Archive/", "/^tmp\\/.*\\.md$/"];

    expect(shouldExcludeTaskPath("Inbox/private.md", patterns)).toBe(true);
    expect(shouldExcludeTaskPath("Archive/tasks/today.md", patterns)).toBe(true);
    expect(shouldExcludeTaskPath("tmp/scratch.md", patterns)).toBe(true);
    expect(shouldExcludeTaskPath("Inbox/public.md", patterns)).toBe(false);
  });
});
