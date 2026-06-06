<script lang="ts">
  import type { CommonTask } from "src/services/caldav/sync/types";
  import type { TaskSyncManager } from "../services/caldav/TaskSyncManager";
  import { t } from "../i18n";
  import { tasksStore } from "./stores";

  export let taskSyncManager: TaskSyncManager | null = null;

  let toggling: Record<string, boolean> = {};

  $: today = window.moment().format("YYYY-MM-DD");
  $: openTasks = sortTasks(groupOpenTasks($tasksStore.tasks, today));
  $: todayTasks = sortTasks(groupTodayTasks($tasksStore.tasks, today));
  $: futureTasks = sortTasks(groupFutureTasks($tasksStore.tasks, today));
  $: groups = [
    { title: t("tasks-open"), tasks: openTasks },
    { title: t("tasks-today"), tasks: todayTasks },
    { title: t("tasks-future"), tasks: futureTasks },
  ];
  $: hasTasks = openTasks.length > 0 || todayTasks.length > 0 || futureTasks.length > 0;

  async function completeTask(task: CommonTask) {
    if (!taskSyncManager || toggling[task.uid]) return;
    toggling = { ...toggling, [task.uid]: true };
    try {
      await taskSyncManager.completeTask(task);
    } finally {
      const next = { ...toggling };
      delete next[task.uid];
      toggling = next;
    }
  }

  function groupOpenTasks(tasks: CommonTask[], date: string): CommonTask[] {
    return tasks.filter((task) => {
      if (!isOpen(task) || matchesDate(task, date)) return false;
      const primaryDate = getPrimaryDate(task);
      return !primaryDate || primaryDate < date;
    });
  }

  function groupTodayTasks(tasks: CommonTask[], date: string): CommonTask[] {
    return tasks.filter((task) => isOpen(task) && matchesDate(task, date));
  }

  function groupFutureTasks(tasks: CommonTask[], date: string): CommonTask[] {
    return tasks.filter((task) => {
      if (!isOpen(task) || matchesDate(task, date)) return false;
      const primaryDate = getPrimaryDate(task);
      return !!primaryDate && primaryDate > date;
    });
  }

  function isOpen(task: CommonTask): boolean {
    return task.status !== "DONE" && task.status !== "CANCELLED";
  }

  function matchesDate(task: CommonTask, date: string): boolean {
    return getTaskDates(task).includes(date);
  }

  function getPrimaryDate(task: CommonTask): string | null {
    return task.dueDate ?? task.scheduledDate ?? task.startDate ?? task.createdDate ?? null;
  }

  function getTaskDates(task: CommonTask): string[] {
    return [
      task.dueDate,
      task.scheduledDate,
      task.startDate,
      task.createdDate ?? null,
    ].filter((value): value is string => !!value);
  }

  function sortTasks(tasks: CommonTask[]): CommonTask[] {
    return [...tasks].sort((a, b) => {
      const dateComparison = getSortDate(a).localeCompare(getSortDate(b));
      if (dateComparison !== 0) return dateComparison;
      return getPriorityWeight(b) - getPriorityWeight(a);
    });
  }

  function getSortDate(task: CommonTask): string {
    return task.dueDate
      ?? task.scheduledDate
      ?? task.startDate
      ?? task.createdDate
      ?? "9999-12-31";
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

  function getDateRangeLabel(task: CommonTask): string {
    const start = task.startDate ?? task.scheduledDate ?? null;
    const due = task.dueDate ?? null;

    if (start && due) {
      const formattedStart = formatCompactDate(start);
      const formattedDue = formatCompactDate(due);
      return formattedStart === formattedDue ? formattedDue : `${formattedStart}~${formattedDue}`;
    }

    if (start) return `${formatCompactDate(start)}~`;
    if (due) return `~${formatCompactDate(due)}`;
    return "";
  }

  function formatCompactDate(date: string): string {
    const parsed = window.moment(date, "YYYY-MM-DD", true);
    return parsed.isValid() ? parsed.format("YY-MM-DD") : date;
  }

  function getTitleClass(task: CommonTask, date: string): string {
    if (task.dueDate && task.dueDate < date) return "is-overdue";
    if (task.priority === "highest") return "is-priority-highest";
    if (task.priority === "high") return "is-priority-high";
    if (task.priority === "medium") return "is-priority-medium";
    if (task.priority === "low" || task.priority === "lowest") return "is-priority-low";
    return "";
  }
</script>

<section class="task-list" aria-label={t("tasks-title")}>
  <div class="task-list-header">
    <div>
      <h3>{t("tasks-title")}</h3>
    </div>
    {#if $tasksStore.syncing}
      <span class="task-sync-state">{t("tasks-syncing")}</span>
    {:else if $tasksStore.loading}
      <span class="task-sync-state">{t("tasks-loading")}</span>
    {/if}
  </div>

  {#if $tasksStore.error}
    <p class="task-empty">{t("tasks-error")}: {$tasksStore.error}</p>
  {:else if !$tasksStore.ready && $tasksStore.tasks.length === 0}
    <p class="task-empty">{t("tasks-requires-tasks-plugin")}</p>
  {:else if !hasTasks}
    <p class="task-empty">{t("tasks-empty")}</p>
  {:else}
    {#each groups as group}
      <div class="task-group">
        <div class="task-group-title">
          <span>{group.title}</span>
          <span>{group.tasks.length}</span>
        </div>
        {#if group.tasks.length === 0}
          <p class="task-group-empty">{t("tasks-group-empty")}</p>
        {:else}
          <ul>
            {#each group.tasks as task (task.uid)}
              <li>
                <label class:toggling={toggling[task.uid]}>
                  <input
                    type="checkbox"
                    disabled={toggling[task.uid]}
                    on:change={() => completeTask(task)}
                  />
                  <span class="task-content">
                    <span class="task-title {getTitleClass(task, today)}">{task.title}</span>
                    <span class="task-meta">
                      {#if getDateRangeLabel(task)}
                        <span>{getDateRangeLabel(task)}</span>
                      {/if}
                    </span>
                  </span>
                </label>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}
  {/if}
</section>

<style>
  .task-list {
    border-top: 1px solid var(--background-modifier-border);
    margin: 8px 8px 0;
    padding-top: 10px;
  }

  .task-list-header {
    align-items: flex-start;
    display: flex;
    gap: 8px;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  h3 {
    color: var(--text-normal);
    font-size: 0.9rem;
    font-weight: 600;
    line-height: 1.2;
    margin: 0;
  }

  .task-list-header span,
  .task-sync-state,
  .task-meta,
  .task-group-title {
    color: var(--text-muted);
    font-size: 0.72rem;
  }

  .task-sync-state {
    white-space: nowrap;
  }

  .task-group {
    margin-top: 10px;
  }

  .task-group-title {
    align-items: center;
    display: flex;
    font-weight: 600;
    justify-content: space-between;
    margin-bottom: 4px;
    text-transform: uppercase;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li + li {
    margin-top: 2px;
  }

  label {
    align-items: flex-start;
    border-radius: 4px;
    display: flex;
    gap: 8px;
    padding: 4px 2px;
  }

  label:hover {
    background: var(--background-modifier-hover);
  }

  label.toggling {
    opacity: 0.6;
  }

  input {
    flex: 0 0 auto;
    margin-top: 2px;
  }

  .task-content {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
  }

  .task-title {
    color: var(--text-normal);
    font-size: 0.82rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .task-title.is-overdue,
  .task-title.is-priority-highest {
    color: var(--text-error);
  }

  .task-title.is-priority-high {
    color: var(--text-warning, var(--color-orange));
  }

  .task-title.is-priority-medium {
    color: var(--text-accent);
  }

  .task-title.is-priority-low {
    color: var(--text-muted);
  }

  .task-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    line-height: 1.3;
    margin-top: 2px;
  }

  .task-empty,
  .task-group-empty {
    color: var(--text-muted);
    font-size: 0.78rem;
    line-height: 1.4;
    margin: 6px 0 0;
  }

  .task-group-empty {
    font-size: 0.72rem;
  }
</style>
