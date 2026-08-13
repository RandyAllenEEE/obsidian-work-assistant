jest.mock("obsidian", () => ({
  requestUrl: jest.fn(),
  normalizePath: (path: string) => path,
}));

import { CalDAVClientDirect } from "../services/caldav/caldav/calDAVClientDirect";
import { VTODOMapper } from "../services/caldav/caldav/vtodoMapper";
import { RemoteTaskRepository } from "../services/caldav/remoteTaskRepository";
import { shouldExcludeTaskPath } from "../services/caldav/utils/taskPathFilter";
import { generateTaskId, isValidTaskId } from "../services/caldav/utils/taskIdGenerator";
import { createSourceId } from "../services/caldav/utils/sourceId";
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

  test("vtodo mapper preserves server status and recurrence fields when completing", () => {
    const mapper = new VTODOMapper();
    const source = [
      "BEGIN:VCALENDAR",
      "BEGIN:VTODO",
      "UID:server-task",
      "STATUS:IN-PROCESS",
      "DTSTART;VALUE=DATE:20260810",
      "X-OBSIDIAN-SCHEDULED-DATE;VALUE=DATE:20260812",
      "RRULE:FREQ=WEEKLY",
      "X-SERVER-FLAG:keep-me",
      "END:VTODO",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = mapper.vtodoToTask({ data: source, url: "https://example.test/server-task.ics" });
    const completed = mapper.completeVTODO(source, "2026-08-12");

    expect(parsed.status).toBe("IN_PROGRESS");
    expect(parsed.startDate).toBeNull();
    expect(parsed.scheduledDate).toBe("2026-08-12");
    expect(completed).toContain("STATUS:COMPLETED");
    expect(completed).toContain("RRULE:FREQ=WEEKLY");
    expect(completed).toContain("X-SERVER-FLAG:keep-me");
  });

  test("new task IDs use eight hex digits while legacy IDs remain valid", () => {
    const generated = generateTaskId();
    expect(generated).toMatch(/^\d{8}-[0-9a-f]{8}$/);
    expect(isValidTaskId(generated)).toBe(true);
    expect(isValidTaskId("20250105-a4f")).toBe(true);
  });

  test("source identity is a deterministic truncated SHA-256 of vault and local IDs", async () => {
    await expect(createSourceId("Vault", "local-1"))
      .resolves.toBe("wa-7db700a24a224f1db02979c3b2ea82a6");
    await expect(createSourceId("Vault", "local-2"))
      .resolves.not.toBe("wa-7db700a24a224f1db02979c3b2ea82a6");
  });

  test("remote creation uses a normalized UID URL and create-only precondition", async () => {
    const request = jest.fn(async () => ({ status: 201, text: "", headers: {} }));
    const client = new CalDAVClientDirect({
      serverUrl: "https://example.test",
      username: "user",
      password: "password",
      calendarName: "Tasks",
    }, { request } as any);
    (client as any).calendarUrl = "https://example.test/calendars/tasks/";

    await client.createVTODO("BEGIN:VCALENDAR\r\nEND:VCALENDAR", "reserved-uid");

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://example.test/calendars/tasks/reserved-uid.ics",
      method: "PUT",
      headers: expect.objectContaining({ "If-None-Match": "*" }),
    }));
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

  test("remote repository keeps CalDAV UIDs and completes with the fetched ETag", async () => {
    const mapper = new VTODOMapper();
    const remote = {
      url: "https://example.test/cal/remote-1.ics",
      etag: "one",
      data: mapper.taskToVTODO(task({ tags: ["sync"], recurrenceRule: "FREQ=DAILY" }), "remote-1", "wa-source"),
    };
    const client = {
      connect: jest.fn(async () => undefined),
      fetchVTODOs: jest.fn(async () => [remote]),
      createVTODO: jest.fn(async () => undefined),
      updateVTODO: jest.fn(async () => undefined),
    };
    const repository = new RemoteTaskRepository({
      serverUrl: "https://example.test",
      username: "user",
      password: "secret",
      calendarName: "Tasks",
      obsidianTag: "sync",
      caldavCategory: "sync",
    }, client, mapper);

    const records = await repository.fetch();
    await repository.complete(records[0], "2026-08-12");

    expect(client.fetchVTODOs).toHaveBeenCalledTimes(1);
    expect(client.updateVTODO).toHaveBeenCalledTimes(1);
    expect(records[0].task.uid).toBe("remote-1");
    expect(records[0].sourceId).toBe("wa-source");
    expect(records[0].visible).toBe(true);
    const updateCall = (client.updateVTODO as jest.Mock).mock.calls[0];
    expect(updateCall[0]).toBe(remote);
    expect(updateCall[1]).toContain("STATUS:COMPLETED");
    expect(updateCall[1]).toContain("RRULE:FREQ=DAILY");
  });

  test("repository reuses its latest UID index for a completion request", async () => {
    const mapper = new VTODOMapper();
    const current = {
      url: "https://example.test/cal/current.ics",
      etag: "current-etag",
      data: mapper.taskToVTODO(task(), "remote-1"),
    };
    const stale = {
      url: "https://example.test/cal/stale.ics",
      etag: "stale-etag",
      data: mapper.taskToVTODO(task(), "remote-1"),
    };
    const client = {
      connect: jest.fn(async () => undefined),
      fetchVTODOs: jest.fn(async () => [current]),
      createVTODO: jest.fn(async () => undefined),
      updateVTODO: jest.fn(async () => undefined),
    };
    const repository = new RemoteTaskRepository({
      serverUrl: "https://example.test",
      username: "user",
      password: "secret",
      calendarName: "Tasks",
      obsidianTag: "sync",
      caldavCategory: "sync",
    }, client, mapper);

    await repository.fetch();
    await repository.complete({
      task: task({ uid: "remote-1" }),
      sourceId: null,
      visible: true,
      object: stale,
    }, "2026-08-12");

    expect(client.updateVTODO).toHaveBeenCalledWith(current, expect.any(String));
  });

  test("local recurrence is omitted on first remote creation and source ID is persisted", async () => {
    const mapper = new VTODOMapper();
    const client = {
      connect: jest.fn(async () => undefined),
      fetchVTODOs: jest.fn(async () => []),
      createVTODO: jest.fn(async () => undefined),
      updateVTODO: jest.fn(async () => undefined),
    };
    const repository = new RemoteTaskRepository({
      serverUrl: "https://example.test",
      username: "user",
      password: "secret",
      calendarName: "Tasks",
      obsidianTag: "sync",
      caldavCategory: "sync",
    }, client, mapper);

    await repository.create(task({ recurrenceRule: "FREQ=WEEKLY" }), "remote-new", "wa-local-source");

    const payload = (client.createVTODO as jest.Mock).mock.calls[0][0] as string;
    expect(payload).toContain("UID:remote-new");
    expect(payload).toContain("X-WORK-ASSISTANT-SOURCE-ID:wa-local-source");
    expect(payload).not.toContain("RRULE:");
  });

  test("keeps category-filtered server tasks for ledger reconciliation but marks them hidden", async () => {
    const mapper = new VTODOMapper();
    const client = {
      connect: jest.fn(async () => undefined),
      fetchVTODOs: jest.fn(async () => [{
        url: "https://example.test/cal/hidden.ics",
        data: mapper.taskToVTODO(task({ tags: ["personal"] }), "hidden-1", "wa-hidden"),
      }]),
      createVTODO: jest.fn(async () => undefined),
      updateVTODO: jest.fn(async () => undefined),
    };
    const repository = new RemoteTaskRepository({
      serverUrl: "https://example.test",
      username: "user",
      password: "secret",
      calendarName: "Tasks",
      obsidianTag: "sync",
      caldavCategory: "sync",
    }, client, mapper);

    const [record] = await repository.fetch();

    expect(record.task.uid).toBe("hidden-1");
    expect(record.sourceId).toBe("wa-hidden");
    expect(record.visible).toBe(false);
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
