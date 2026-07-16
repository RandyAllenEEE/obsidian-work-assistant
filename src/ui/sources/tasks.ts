import type { Moment } from "moment";
import type { ICalendarSource, IDayMetadata, IDot } from "obsidian-calendar-ui";
import { get } from "svelte/store";

import { tasksStore } from "../stores";
import type { CommonTask } from "../../services/caldav/sync/types";
import { getTaskActionDates, isOpenTask } from "../taskGrouping";

const TASK_DOT: IDot = {
  className: "caldav-task",
  color: "default",
  isFilled: false,
};

let indexedTasks: CommonTask[] | null = null;
let indexedDates = new Set<string>();

function getActionDateIndex(): Set<string> {
  const tasks = get(tasksStore).tasks;
  if (tasks === indexedTasks) return indexedDates;
  indexedTasks = tasks;
  indexedDates = new Set(
    tasks
      .filter(isOpenTask)
      .flatMap(getTaskActionDates)
  );
  return indexedDates;
}

export const tasksSource: ICalendarSource = {
  getDailyMetadata: async (date: Moment): Promise<IDayMetadata> => {
    const dateString = date.format("YYYY-MM-DD");
    const hasTasks = getActionDateIndex().has(dateString);
    return hasTasks ? { dots: [TASK_DOT] } : {};
  },

  getWeeklyMetadata: async (date: Moment): Promise<IDayMetadata> => {
    const start = date.clone().startOf("week");
    const dates = getActionDateIndex();
    const hasTasks = Array.from({ length: 7 }, (_, index) =>
      start.clone().add(index, "day").format("YYYY-MM-DD")
    ).some((dateString) => dates.has(dateString));
    return hasTasks ? { dots: [TASK_DOT] } : {};
  },
};
