import { CalDAVClientDirect, type CalDAVClient } from "./caldav/calDAVClientDirect";
import { VTODOMapper, type CalendarObject } from "./caldav/vtodoMapper";
import type { CalendarMapping } from "./types";
import type { CommonTask } from "./sync/types";
import {
  injectTagIdentifier,
  normalizeTagIdentifier,
  stripTagIdentifier,
} from "./utils/tagIdentifier";

export interface RemoteTaskRecord {
  task: CommonTask;
  object: CalendarObject;
  sourceId: string | null;
  /** Controls sidebar visibility only; ledger reconciliation sees every row. */
  visible: boolean;
}

/**
 * The only module allowed to read or mutate CalDAV task data. It always keeps
 * the CalDAV UID as `CommonTask.uid`; local task IDs live solely in the task
 * state ledger.
 */
export class RemoteTaskRepository {
  private readonly mapper: VTODOMapper;
  private readonly client: CalDAVClient;
  private readonly recordsByUid = new Map<string, RemoteTaskRecord>();

  constructor(
    private readonly calendar: CalendarMapping,
    client?: CalDAVClient,
    mapper?: VTODOMapper,
  ) {
    this.client = client ?? new CalDAVClientDirect(calendar);
    this.mapper = mapper ?? new VTODOMapper();
  }

  async fetch(): Promise<RemoteTaskRecord[]> {
    await this.client.connect();
    const objects = await this.client.fetchVTODOs();
    const records: RemoteTaskRecord[] = [];
    for (const object of objects) {
      const uid = this.mapper.extractUID(object.data);
      if (!uid) continue;
      const parsed = this.mapper.vtodoToTask(object);
      const task: CommonTask = {
        ...parsed,
        uid,
        completedDate: parsed.completedDate ? this.toLocalDate(parsed.completedDate) : null,
        tags: stripTagIdentifier(parsed.tags, this.calendar.caldavCategory),
      };
      records.push({
        task,
        object,
        sourceId: this.mapper.extractSourceId(object.data),
        visible: this.matchesCategory(parsed.tags),
      });
    }
    this.recordsByUid.clear();
    for (const record of records) this.recordsByUid.set(record.task.uid, record);
    return records;
  }

  async create(task: CommonTask, remoteUid: string, sourceId: string): Promise<void> {
    const tags = injectTagIdentifier(task.tags, this.calendar.caldavCategory);
    const payload: CommonTask = {
      ...task,
      uid: remoteUid,
      // Local recurring tasks create independent remote instances.
      recurrenceRule: "",
    };
    await this.client.createVTODO(
      this.mapper.taskToVTODO({ ...payload, tags }, remoteUid, sourceId),
      remoteUid,
    );
  }

  async complete(record: RemoteTaskRecord, completedDate: string): Promise<void> {
    const current = this.recordsByUid.get(record.task.uid) ?? record;
    await this.client.updateVTODO(
      current.object,
      this.mapper.completeVTODO(current.object.data, completedDate),
    );
  }

  private matchesCategory(tags: string[]): boolean {
    const required = normalizeTagIdentifier(this.calendar.caldavCategory);
    if (!required) return true;
    return tags.some((tag) => normalizeTagIdentifier(tag) === required);
  }

  private toLocalDate(isoDateTime: string): string {
    const date = new Date(isoDateTime);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
}
