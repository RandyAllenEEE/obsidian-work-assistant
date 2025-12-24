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

  "command-open-note": string;
  "command-next-note": string;
  "command-prev-note": string;
  "command-open-next-note": string;
  "command-open-prev-note": string;

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

  // Word Count Ranges
  "word-count-range-0": string;
  "word-count-range-150": string;
  "word-count-range-400": string;
  "word-count-range-750": string;
  "word-count-range-1500": string;
  "word-count-range-infinity": string;

  // Pomodoro
  "pomo-title": string;
  "settings-pomo-duration": string;
  "settings-pomo-duration-desc": string;
  "settings-short-break": string;
  "settings-short-break-desc": string;
  "settings-long-break": string;
  "settings-long-break-desc": string;
  "settings-long-break-interval": string;
  "settings-long-break-interval-desc": string;
  "settings-continuous-mode": string;
  "settings-continuous-mode-desc": string;
  "settings-pomo-num-auto-cycles": string;
  "settings-pomo-num-auto-cycles-desc": string;
  "settings-white-noise": string;
  "settings-white-noise-desc": string;
  "settings-pomo-background-noise": string;
  "settings-pomo-background-noise-desc": string;
  "settings-notification-sound": string;
  "settings-notification-sound-desc": string;
  "settings-use-system-notification": string;
  "settings-use-system-notification-desc": string;

  // Settings - Hierarchy Sections
  "settings-calendar-view-title": string;
  "settings-periodic-notes-section": string;
  "settings-calendar-linkage-title": string;
  "settings-calendar-linkage-desc": string;
  "settings-word-count-section-title": string;
  "settings-word-count-status-bar-title": string;
  "settings-word-count-status-bar-desc": string;
  "settings-word-count-heatmap-desc": string;
  "settings-requires-calendar-view": string;
  "settings-locale-default": string;

  "pomo-status-bar-aria": string;
  "pomo-notice-start": string;
  "pomo-notice-restart": string;
  "pomo-notice-quit": string;
  "pomo-mode-work": string;
  "pomo-mode-break": string;
  "pomo-unit-minute": string;
  "pomo-unit-minute-plural": string;
  "pomo-unit-second": string;
  "pomo-unit-second-plural": string;
  "command-pomo-start": string;
  "command-pomo-pause": string;
  "command-pomo-quit": string;
  "calendar-tooltip-words": string;
  "calendar-tooltip-pomo": string;

  "pomo-notice-paused": string;
  "pomo-sys-notif-pomo-end": string;
  "pomo-sys-notif-break-end": string;
  "pomo-sys-notif-title": string;

  // Weather
  "settings-weather-title": string;
  "settings-weather-enable": string;
  "settings-weather-enable-desc": string;
  "settings-weather-warnings-enable": string;
  "settings-weather-warnings-desc": string;
  "settings-weather-token": string;
  "settings-weather-token-desc": string;
  "settings-weather-city": string;
  "settings-weather-city-desc": string;
  "settings-weather-host": string;
  "settings-weather-host-desc": string;
  "settings-weather-interval": string;
  "settings-weather-interval-desc": string;
  "settings-weather-daily-interval": string;
  "settings-weather-daily-interval-desc": string;
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