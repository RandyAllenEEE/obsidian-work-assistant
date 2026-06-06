import type { Moment } from "moment";
import type { ICalendarSource, IDayMetadata, IDot } from "obsidian-calendar-ui";
import { get } from "svelte/store";

import type { CommonTask } from "src/services/caldav/sync/types";
import { tasksStore } from "../stores";

const TASK_DOT: IDot = {
  className: "caldav-task",
  color: "default",
  isFilled: false,
};

export const tasksSource: ICalendarSource = {
  getDailyMetadata: async (date: Moment): Promise<IDayMetadata> => {
    const dateString = date.format("YYYY-MM-DD");
    const hasTasks = get(tasksStore).tasks.some((task) => taskIsOpen(task) && taskMatchesDate(task, dateString));
    return hasTasks ? { dots: [TASK_DOT] } : {};
  },

  getWeeklyMetadata: async (date: Moment): Promise<IDayMetadata> => {
    const start = date.clone().startOf("week");
    const end = date.clone().endOf("week");
    const hasTasks = get(tasksStore).tasks.some((task) => {
      if (!taskIsOpen(task)) return false;
      return getTaskDates(task).some((taskDate) => {
        const momentDate = window.moment(taskDate, "YYYY-MM-DD");
        return momentDate.isValid() && momentDate.isBetween(start, end, "day", "[]");
      });
    });
    return hasTasks ? { dots: [TASK_DOT] } : {};
  },
};

function taskIsOpen(task: CommonTask): boolean {
  return task.status !== "DONE" && task.status !== "CANCELLED";
}

function taskMatchesDate(task: CommonTask, date: string): boolean {
  return getTaskDates(task).includes(date);
}

function getTaskDates(task: CommonTask): string[] {
  return [
    task.dueDate,
    task.scheduledDate,
    task.startDate,
    task.createdDate ?? null,
  ].filter((value): value is string => !!value);
}
