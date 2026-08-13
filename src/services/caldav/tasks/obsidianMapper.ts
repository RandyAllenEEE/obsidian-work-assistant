import type { CommonTask, TaskStatus, TaskPriority } from '../sync/types';
import type { ObsidianTask } from './obsidianTasksWrapper';
import { recurrenceTextToRule } from '../utils/rruleLite';

/**
 * Maps between obsidian-tasks Task objects and CommonTask.
 * Parallel to VTODOMapper on the CalDAV side.
 *
 * We cannot instantiate obsidian-tasks Task objects — they come from
 * the plugin's in-memory cache and are read through its public API.
 */
export class ObsidianMapper {
  /**
   * Parse: ObsidianTask → CommonTask.
   */
  /**
   * Note: the obsidian-tasks global filter is intentionally not re-added here.
   * obsidian-tasks strips it from `task.tags` (and `cleanDescription` drops
   * any stray text form). `toMarkdown` re-emits it on writeback so the
   * rewritten line stays recognised under the filter — issue #93.
   */
  toCommonTask(task: ObsidianTask, taskId: string, body = ''): CommonTask {
    return {
      uid: taskId,
      title: this.cleanDescription(task.description),
      status: this.mapStatus(task),
      dueDate: this.formatDate(task.dueDate),
      startDate: this.formatDate(task.startDate),
      scheduledDate: this.formatDate(task.scheduledDate),
      createdDate: this.formatDate(task.createdDate),
      completedDate: this.formatDate(task.doneDate),
      priority: this.mapPriority(task.priority),
      tags: this.cleanTags(task.tags || []),
      recurrenceRule: task.recurrence ? this.extractRecurrenceRule(task.recurrence) : '',
      body,
    };
  }

  /**
   * Clean description by removing metadata that belongs in other fields.
   */
  private cleanDescription(description: string): string {
    let cleaned = description;

    // Remove [id::xxx] (backwards compat for tasks indexed before migration)
    cleaned = cleaned.replace(/\[id::[^\]]+\]/g, '');
    // Remove hashtags (but not # followed by numbers like #42)
    cleaned = cleaned.replace(/#[a-zA-Z][\w-]*/g, '');
    // Clean up extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }

  private cleanTags(tags: string[]): string[] {
    return tags.map(tag => tag.replace(/^#/, ''));
  }

  private mapStatus(task: ObsidianTask): TaskStatus {
    const statusType = task.status?.configuration?.type?.toUpperCase().replace(/[- ]/g, '_');
    if (statusType === 'CANCELLED' || statusType === 'CANCELED') return 'CANCELLED';
    if (statusType === 'IN_PROGRESS' || statusType === 'INPROGRESS') return 'IN_PROGRESS';
    if (task.isDone) return 'DONE';
    return 'TODO';
  }

  private mapPriority(priority: string): TaskPriority {
    const map: Record<string, TaskPriority> = {
      '1': 'highest',
      '2': 'high',
      '3': 'medium',
      '4': 'medium',
      '5': 'low',
      '6': 'lowest',
    };
    return map[priority] || 'none';
  }

  /**
   * Extract RRULE string from obsidian-tasks Recurrence object.
   */
  private extractRecurrenceRule(recurrence: { toText(): string }): string {
    try {
      const text = recurrence.toText();
      if (!text) return '';
      // Strip "when done" suffix — obsidian-tasks specific, not part of RRULE
      const cleanText = text.replace(/\s+when\s+done\s*$/i, '');
      return recurrenceTextToRule(cleanText);
    } catch {
      return '';
    }
  }

  /**
   * Format obsidian-tasks date (moment-like with .format()) to YYYY-MM-DD string.
   */
  private formatDate(date: string | { format(fmt: string): string } | null | undefined): string | null {
    if (!date) return null;
    if (typeof date === 'string') return date;
    if (typeof date.format === 'function') return date.format('YYYY-MM-DD');
    return null;
  }

}
