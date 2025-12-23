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
  "settings-weekly-note-warning": string;
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
  "settings-advanced-title": string;
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

  // Warnings
  "warning-loose-parsing": string;
  "warning-fragile-basename": string;
  "status-bar-words-today": string;

  // Calendar UI
  "calendar-week": string;

  // Word Count Ranges
  "word-count-range-0": string;
  "word-count-range-150": string;
  "word-count-range-400": string;
  "word-count-range-750": string;
  "word-count-range-1500": string;
  "word-count-range-infinity": string;
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