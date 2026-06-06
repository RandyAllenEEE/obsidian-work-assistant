import en from './en';
import zhCN from './zh-cn';

export interface Translation {
  // Plugin info
  "plugin-name": string;
  "plugin-description": string;

  // Commands
  "command-open-view": string;
  "command-open-weekly-note": string;
  "command-reveal-active-note": string;
  "command-pomo-start": string;
  "command-pomo-pause": string;
  "command-pomo-quit": string;
  "command-tasks-sync-now": string;
  "command-tasks-sync-preview": string;
  "command-tasks-sync-status": string;
  "command-tasks-refresh": string;

  "command-open-note": string;
  "command-next-note": string;
  "command-prev-note": string;
  "command-open-next-note": string;
  "command-open-prev-note": string;
  "notice-no-adjacent-periodic-note": string;
  "notice-direction-after": string;
  "notice-direction-before": string;

  "label-periodicity-daily": string;
  "label-periodicity-weekly": string;
  "label-periodicity-monthly": string;
  "label-periodicity-quarterly": string;
  "label-periodicity-yearly": string;

  // Settings - General
  "settings-general-title": string;
  "media-control-title": string;
  "settings-words-per-dot": string;
  "settings-words-per-dot-desc": string;
  "settings-start-week": string;
  "settings-start-week-desc": string;
  "settings-confirm-create": string;
  "settings-confirm-create-desc": string;
  "settings-show-week-number": string;
  "settings-show-week-number-desc": string;

  // Settings - Weather
  "settings-weather-title": string;
  "settings-weather-desc": string;
  "settings-weather-city": string;
  "settings-weather-city-desc": string;
  "settings-weather-token": string;
  "settings-weather-token-desc": string;
  "settings-weather-host": string;
  "settings-weather-host-desc": string;
  "settings-weather-interval": string;
  "settings-weather-interval-desc": string;
  "settings-weather-daily-interval": string;
  "settings-weather-daily-interval-desc": string;
  "settings-weather-warnings-enable": string;
  "settings-weather-warnings-desc": string;

  // Settings - Tasks
  "settings-tasks-title": string;
  "settings-tasks-sync-interval": string;
  "settings-tasks-sync-interval-desc": string;
  "settings-tasks-new-destination": string;
  "settings-tasks-new-destination-desc": string;
  "settings-tasks-new-section": string;
  "settings-tasks-new-section-desc": string;
  "settings-tasks-excluded-paths": string;
  "settings-tasks-excluded-paths-desc": string;
  "settings-tasks-obsidian-wins": string;
  "settings-tasks-obsidian-wins-desc": string;
  "settings-tasks-include-link": string;
  "settings-tasks-include-link-desc": string;
  "settings-tasks-auto-notices": string;
  "settings-tasks-auto-notices-desc": string;
  "settings-tasks-calendar": string;
  "settings-tasks-calendar-name": string;
  "settings-tasks-calendar-name-desc": string;
  "settings-tasks-server-url": string;
  "settings-tasks-server-url-desc": string;
  "settings-tasks-username": string;
  "settings-tasks-password": string;
  "settings-tasks-password-desc": string;
  "settings-tasks-secret-unavailable": string;
  "settings-tasks-obsidian-tag": string;
  "settings-tasks-obsidian-tag-desc": string;
  "settings-tasks-caldav-category": string;
  "settings-tasks-caldav-category-desc": string;

  // Settings - Weekly Note
  "settings-weekly-note-title": string;
  "settings-weekly-note-format": string;
  "settings-weekly-note-format-desc": string;
  "settings-weekly-note-template": string;
  "settings-weekly-note-template-desc": string;
  "settings-weekly-note-folder": string;
  "settings-weekly-note-folder-desc": string;

  // Settings - Word Count Background
  "settings-word-count-bg-title": string;
  "settings-color-range": string;
  "settings-color-range-desc": string;
  "settings-reset-ranges": string;
  "settings-reset-ranges-desc": string;

  // Settings - Word Count Additional Options
  "settings-word-count-stats-md-path": string;
  "settings-word-count-stats-md-path-desc": string;
  "settings-word-count-shock-threshold": string;
  "settings-word-count-shock-threshold-desc": string;
  "settings-word-count-debounce-delay": string;
  "settings-word-count-debounce-delay-desc": string;
  "settings-word-count-auto-save-interval": string;
  "settings-word-count-auto-save-interval-desc": string;
  "settings-word-count-ignored-files": string;
  "settings-word-count-ignored-files-desc": string;

  // Settings - Advanced
  "settings-override-locale": string;
  "settings-override-locale-desc": string;
  "settings-heatmap-refresh-interval": string;
  "settings-heatmap-refresh-interval-desc": string;

  // Settings - Placeholders
  "placeholder-min-value": string;
  "placeholder-max-value": string;
  "placeholder-opacity": string;
  "placeholder-reset": string;

  // Modals
  "modal-create-note-title": string;
  "modal-create-note-text": string;
  "modal-open-periodic-note-title": string;
  "modal-create-periodic-note-title": string;
  "modal-periodic-template-desc": string;
  "modal-periodic-template-missing": string;
  "modal-view-periodic-note-cta": string;
  "modal-create-periodic-note-cta": string;
  "settings-timeline-title": string;
  "settings-timeline-desc": string;
  "settings-periodic-notes-title": string;

  "modal-create-note-cta": string;
  "modal-cancel": string;


  // Periodic Notes Details
  "periodic-note-heading-day": string;
  "periodic-note-heading-week": string;
  "periodic-note-heading-month": string;
  "periodic-note-heading-quarter": string;
  "periodic-note-heading-year": string;

  "settings-common-open-startup": string;
  "settings-common-open-startup-desc": string;
  "settings-common-format": string;
  "settings-common-syntax-ref": string;
  "settings-common-syntax-preview": string;
  "settings-common-folder": string;
  "settings-common-template-desc": string;
  "settings-common-template-placeholder": string;
  "settings-common-folder-placeholder": string;

  "template-title-day": string;
  "template-title-week": string;
  "template-title-month": string;
  "template-title-quarter": string;
  "template-title-year": string;

  "folder-desc-day": string;
  "folder-desc-week": string;
  "folder-desc-month": string;
  "folder-desc-quarter": string;
  "folder-desc-year": string;

  "status-bar-words-today": string;
  "status-bar-words-today-detail": string;

  // Calendar UI
  "calendar-week": string;
  "calendar-tooltip-words": string;
  "calendar-tooltip-pomo": string;

  // Task list
  "tasks-title": string;
  "tasks-syncing": string;
  "tasks-loading": string;
  "tasks-error": string;
  "tasks-requires-tasks-plugin": string;
  "tasks-empty": string;
  "tasks-open": string;
  "tasks-today": string;
  "tasks-future": string;
  "tasks-group-empty": string;

  // Task sync UI
  "tasks-error-plugin-unavailable": string;
  "tasks-calendar-default-name": string;
  "tasks-calendar-missing-fields": string;
  "tasks-notice-calendar-skipped": string;
  "tasks-notice-status-not-ready": string;
  "tasks-notice-completion-requires-plugin": string;
  "tasks-notice-task-not-found": string;
  "tasks-notice-toggle-unavailable": string;
  "tasks-notice-update-failed": string;
  "tasks-notice-sync-configured-plugin-missing": string;
  "tasks-notice-migration-failed": string;
  "tasks-notice-no-calendar-ready": string;
  "tasks-notice-check-settings": string;
  "tasks-notice-plugin-not-ready": string;
  "tasks-notice-missing-password-secret": string;
  "tasks-notice-sync-requires-plugin": string;
  "tasks-notice-sync-starting": string;
  "tasks-sync-dry-run-prefix": string;
  "tasks-sync-status-last-sync": string;
  "tasks-sync-status-never": string;
  "tasks-sync-status-mapped": string;
  "tasks-sync-status-baseline": string;
  "tasks-sync-status-conflicts": string;
  "tasks-sync-message-dry-run": string;
  "tasks-sync-message-complete": string;
  "tasks-sync-message-reconciled-line": string;
  "tasks-sync-message-reconciled-suffix": string;
  "tasks-sync-error-unknown": string;
  "tasks-sync-message-failed": string;
  "tasks-sync-modal-preview-title": string;
  "tasks-sync-modal-results-title": string;
  "tasks-sync-modal-inputs": string;
  "tasks-sync-modal-obsidian-tasks": string;
  "tasks-sync-modal-calendar-tasks": string;
  "tasks-sync-modal-baseline-tasks": string;
  "tasks-sync-modal-changes": string;
  "tasks-sync-modal-to-obsidian": string;
  "tasks-sync-modal-to-calendar": string;
  "tasks-sync-modal-conflicts": string;
  "tasks-sync-modal-no-changes": string;
  "tasks-sync-modal-summary-created": string;
  "tasks-sync-modal-summary-updated": string;
  "tasks-sync-modal-summary-deleted": string;
  "tasks-sync-modal-summary-to-obsidian": string;
  "tasks-sync-modal-summary-to-calendar": string;
  "tasks-sync-modal-summary-conflicts": string;
  "tasks-sync-modal-summary-none": string;
  "tasks-sync-modal-summary-error": string;
  "tasks-sync-modal-no-tasks": string;
  "tasks-sync-modal-header-uid": string;
  "tasks-sync-modal-header-title": string;
  "tasks-sync-modal-header-status": string;
  "tasks-sync-modal-header-due": string;
  "tasks-sync-modal-header-priority": string;
  "tasks-sync-modal-task": string;
  "tasks-sync-modal-column-obsidian": string;
  "tasks-sync-modal-column-calendar": string;
  "tasks-sync-modal-column-baseline": string;
  "tasks-sync-modal-field-title": string;
  "tasks-sync-modal-field-status": string;
  "tasks-sync-modal-field-due": string;
  "tasks-sync-modal-field-priority": string;
  "tasks-sync-modal-field-tags": string;
  "tasks-sync-modal-change-create": string;
  "tasks-sync-modal-change-update": string;
  "tasks-sync-modal-change-delete": string;
  "tasks-sync-modal-change-complete": string;
  "tasks-sync-modal-change-reconcile": string;
  "tasks-sync-modal-diff-title": string;
  "tasks-sync-modal-diff-status": string;
  "tasks-sync-modal-diff-due": string;
  "tasks-sync-modal-diff-priority": string;
  "tasks-sync-modal-apply": string;
  "tasks-sync-modal-applying": string;
  "tasks-sync-modal-close": string;

  // Periodic notices and relative labels
  "notice-periodic-template-read-failed": string;
  "notice-periodic-bundled-template-missing": string;
  "relative-this-week": string;
  "relative-last-week": string;
  "relative-next-week": string;
  "relative-yesterday": string;
  "relative-today": string;
  "relative-tomorrow": string;
  "relative-last-weekday": string;
  "file-menu-delete": string;
  "modal-create-weekly-note-title": string;
  "notice-smtc-security-violation": string;

  // Word Count Ranges
  "word-count-range-0": string;
  "word-count-range-150": string;
  "word-count-range-400": string;
  "word-count-range-750": string;
  "word-count-range-1500": string;
  "word-count-range-infinity": string;

  // Pomodoro
  "pomo-title": string;
  "pomo-notice-paused": string;
  "pomo-notice-start": string;
  "pomo-notice-quit": string;
  "pomo-notice-restart": string;
  "pomo-mode-work": string;
  "pomo-mode-break": string;
  "pomo-unit-minute": string;
  "pomo-unit-minute-plural": string;
  "pomo-unit-second": string;
  "pomo-unit-second-plural": string;
  "pomo-sys-notif-pomo-end": string;
  "pomo-sys-notif-break-end": string;
  "pomo-sys-notif-title": string;
  "pomo-status-bar-aria": string;
  "settings-pomo-work": string;
  "settings-pomo-work-desc": string;
  "settings-pomo-short-break": string;
  "settings-pomo-short-break-desc": string;
  "settings-pomo-long-break": string;
  "settings-pomo-long-break-desc": string;
  "settings-pomo-long-break-interval": string;
  "settings-pomo-long-break-interval-desc": string;
  "settings-pomo-continuous": string;
  "settings-pomo-continuous-desc": string;
  "settings-pomo-auto-cycles": string;
  "settings-pomo-auto-cycles-desc": string;
  "settings-pomo-time-settings": string;
  "settings-notification-settings": string;
  "settings-media-windows-only": string;
  "settings-notification-sound": string;
  "settings-notification-sound-desc": string;
  "settings-use-system-notification": string;
  "settings-use-system-notification-desc": string;

  // Settings - Hierarchy Sections
  "view-name-assistant": string;
  "settings-assistant-panel-title": string;
  "settings-widgets-title": string;
  "settings-widget-order": string;
  "settings-widget-order-desc": string;

  "settings-calendar-view-title": string;
  "settings-show-flip-clock": string;
  "settings-show-flip-clock-desc": string;
  "settings-periodic-notes-section": string;
  "settings-periodic-format": string;
  "settings-periodic-format-desc": string;
  "settings-periodic-folder": string;
  "settings-periodic-folder-desc": string;
  "settings-periodic-open-at-startup": string;
  "settings-periodic-open-at-startup-desc": string;
  "settings-calendar-linkage-title": string;
  "settings-calendar-linkage-desc": string;
  "settings-periodic-note-configs": string;
  "settings-word-count-section-title": string;
  "settings-word-count-status-bar-title": string;
  "settings-word-count-status-bar-desc": string;
  "settings-word-count-heatmap-desc": string;
  "settings-requires-calendar-view": string;
  "settings-locale-default": string;

  // 新增翻译键
  "settings-calendar-view-title-desc": string;
}

export type Language = 'en' | 'zh-cn';

export const translations: Record<Language, Translation> = {
  'en': en,
  'zh-cn': zhCN
};

export function getTranslation(lang: Language): Translation {
  return translations[lang] || translations['en'];
}

export function getLanguage(): Language {
  const momentLang = window.moment.locale();
  if (momentLang.startsWith('zh')) {
    return 'zh-cn';
  }
  return 'en';
}

export function t(key: keyof Translation, lang?: Language): string {
  const selectedLang = lang || getLanguage();
  const translation = getTranslation(selectedLang);
  return translation[key] || key;
}
