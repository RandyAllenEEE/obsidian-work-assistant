import type { CommonTask } from "../services/caldav/sync/types";

export type TaskGroup = "open" | "today" | "future";

export interface GroupedTasks {
  open: CommonTask[];
  today: CommonTask[];
  future: CommonTask[];
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isOpenTask(task: CommonTask): boolean {
  return task.status !== "DONE" && task.status !== "CANCELLED";
}

export function isValidTaskDate(value: string | null | undefined): value is string {
  if (!value) return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function getTaskActionDates(task: CommonTask): string[] {
  return [...new Set([
    task.startDate,
    task.scheduledDate,
    task.dueDate,
  ].filter(isValidTaskDate))].sort();
}

export function classifyTask(task: CommonTask, today: string): TaskGroup | null {
  if (!isOpenTask(task)) return null;

  const dates = getTaskActionDates(task);
  if (dates.includes(today)) return "today";
  if (dates.length === 0 || dates.some((date) => date < today)) return "open";
  return "future";
}

export function taskMatchesActionDate(task: CommonTask, date: string): boolean {
  return isOpenTask(task) && getTaskActionDates(task).includes(date);
}

export function getEarliestTaskActionDate(task: CommonTask): string | null {
  return getTaskActionDates(task)[0] ?? null;
}

export function groupTasks(tasks: CommonTask[], today: string): GroupedTasks {
  const grouped: GroupedTasks = { open: [], today: [], future: [] };
  for (const task of tasks) {
    const group = classifyTask(task, today);
    if (group) grouped[group].push(task);
  }

  grouped.open.sort(compareTasks);
  grouped.today.sort(compareTasks);
  grouped.future.sort(compareTasks);
  return grouped;
}

export function compareTasks(a: CommonTask, b: CommonTask): number {
  const dateComparison = (getEarliestTaskActionDate(a) ?? "9999-12-31")
    .localeCompare(getEarliestTaskActionDate(b) ?? "9999-12-31");
  if (dateComparison !== 0) return dateComparison;

  const priorityComparison = getPriorityWeight(b) - getPriorityWeight(a);
  if (priorityComparison !== 0) return priorityComparison;
  return a.title.localeCompare(b.title);
}

function getPriorityWeight(task: CommonTask): number {
  const weights: Record<CommonTask["priority"], number> = {
    none: 0,
    lowest: 1,
    low: 2,
    medium: 3,
    high: 4,
    highest: 5,
  };
  return weights[task.priority] ?? 0;
}
