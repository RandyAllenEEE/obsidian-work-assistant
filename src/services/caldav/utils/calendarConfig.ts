import type { CalendarMapping } from '../types';
import { t } from '../../../i18n';

/** Calendar fields that must be set before a sync can be attempted, in display order. */
const REQUIRED_FIELDS: ReadonlyArray<{ key: keyof CalendarMapping; labelKey: Parameters<typeof t>[0] }> = [
  { key: 'serverUrl', labelKey: 'settings-tasks-server-url' },
  { key: 'username', labelKey: 'settings-tasks-username' },
  { key: 'calendarName', labelKey: 'settings-tasks-calendar-name' },
];

/** Labels of required fields that are empty (or whitespace-only). Empty array when fully configured. */
export function missingCalendarFields(calendar: CalendarMapping): string[] {
  return REQUIRED_FIELDS
    .filter(({ key }) => calendar[key].trim() === '')
    .map(({ labelKey }) => t(labelKey));
}

/** True when a calendar has every field required to attempt a sync. */
export function isCalendarConfigured(calendar: CalendarMapping): boolean {
  return missingCalendarFields(calendar).length === 0;
}

/**
 * Human-readable reason a calendar can't sync, or null when it is fully configured.
 * Names the calendar by its name, falling back to its server URL, then its position.
 */
export function describeIncompleteCalendar(calendar: CalendarMapping, index: number): string | null {
  const missing = missingCalendarFields(calendar);
  if (missing.length === 0) {
    return null;
  }
  const name = calendar.calendarName.trim()
    || calendar.serverUrl.trim()
    || t('tasks-calendar-default-name').replace('{index}', String(index + 1));
  return t('tasks-calendar-missing-fields')
    .replace('{calendar}', name)
    .replace('{fields}', missing.join(', '));
}
