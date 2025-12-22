export default {
  // Plugin info
  "plugin-name": "Work Assistant",
  "plugin-description": "Calendar view with word count statistics for your daily notes",

  // Commands
  "command-open-view": "Open view",
  "command-open-weekly-note": "Open Weekly Note",
  "command-reveal-active-note": "Reveal active note",

  // Settings - General
  "settings-general-title": "General Settings",
  "settings-words-per-dot": "Words per dot",
  "settings-words-per-dot-desc": "How many words should be represented by a single dot? (Each dot represents the word count of your daily note file)",
  "settings-start-week": "Start week on:",
  "settings-start-week-desc": "Choose what day of the week to start. Select 'Locale default' to use the default specified by moment.js",
  "settings-confirm-create": "Confirm before creating new note",
  "settings-confirm-create-desc": "Show a confirmation modal before creating a new note",
  "settings-show-week-number": "Show week number",
  "settings-show-week-number-desc": "Enable this to add a column with the week number",

  // Settings - Weekly Note
  "settings-weekly-note-title": "Weekly Note Settings",
  "settings-weekly-note-warning": "Note: Weekly Note settings are moving. You are encouraged to install the 'Periodic Notes' plugin to keep the functionality in the future.",
  "settings-weekly-note-format": "Weekly note format",
  "settings-weekly-note-format-desc": "For more syntax help, refer to format reference",
  "settings-weekly-note-template": "Weekly note template",
  "settings-weekly-note-template-desc": "Choose the file you want to use as the template for your weekly notes",
  "settings-weekly-note-folder": "Weekly note folder",
  "settings-weekly-note-folder-desc": "New weekly notes will be placed here",

  // Settings - Word Count Background
  "settings-word-count-bg-title": "Word Count Background Settings",
  "settings-color-range": "Color Range",
  "settings-color-range-desc": "Min: {min}, Max: {max}, Opacity: {opacity} (Background color intensity based on daily note word count)",
  "settings-reset-ranges": "Reset to Default Ranges",
  "settings-reset-ranges-desc": "Restore the default word count color ranges",

  // Settings - Advanced
  "settings-advanced-title": "Advanced Settings",
  "settings-override-locale": "Override locale:",
  "settings-override-locale-desc": "Set this if you want to use a locale different from the default",

  // Settings - Placeholders
  "placeholder-max-value": "Min value",
  "placeholder-max-value": "Max value",
  "placeholder-opacity": "Opacity (0-1)",
  "placeholder-reset": "Reset",

  // Settings - Refresh Interval
  "settings-heatmap-refresh-interval": "Heatmap Refresh Interval (ms)",
  "settings-heatmap-refresh-interval-desc": "Time in milliseconds to wait before refreshing the heatmap. Default is 2000ms.",

  // Modals
  "modal-create-note-title": "New Daily Note",
  "modal-create-note-text": "File {filename} does not exist. Would you like to create it?",
  "modal-create-note-cta": "Create",
  "modal-cancel": "Never mind",

  // Status Bar
  "status-bar-words-today": "{count} words today",

  // Calendar UI
  "calendar-week": "W",

  // Word Count Ranges
  "word-count-range-0": "0",
  "word-count-range-150": "150",
  "word-count-range-400": "400",
  "word-count-range-750": "750",
  "word-count-range-1500": "1500",
  "word-count-range-infinity": "Infinity"
};