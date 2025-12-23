export default {
  // Plugin info
  "plugin-name": "Work Assistant",
  "plugin-description": "Calendar view with word count statistics for your daily notes",

  // Commands
  "command-open-view": "Open view",
  "command-open-weekly-note": "Open Weekly Note",
  "command-reveal-active-note": "Reveal active note",

  "command-open-note": "Open {periodicity} note",
  "command-next-note": "Jump forwards to closest {periodicity} note",
  "command-prev-note": "Jump backwards to closest {periodicity} note",
  "command-open-next-note": "Open next {periodicity} note",
  "command-open-prev-note": "Open previous {periodicity} note",

  "label-periodicity-daily": "daily",
  "label-periodicity-weekly": "weekly",
  "label-periodicity-monthly": "monthly",
  "label-periodicity-quarterly": "quarterly",
  "label-periodicity-yearly": "yearly",

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
  "placeholder-min-value": "Min value",
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

  "settings-timeline-title": "Show 'Timeline' complication on periodic notes",
  "settings-timeline-desc": "Adds a collapsible timeline to the top-right of all periodic notes",
  "modal-cancel": "Never mind",


  // Periodic Notes Details
  "periodic-note-heading-day": "Daily Notes",
  "periodic-note-heading-week": "Weekly Notes",
  "periodic-note-heading-month": "Monthly Notes",
  "periodic-note-heading-quarter": "Quarterly Notes",
  "periodic-note-heading-year": "Yearly Notes",

  "settings-common-open-startup": "Open on startup",
  "settings-common-open-startup-desc": "Opens your {noteType} note automatically whenever you open this vault",
  "settings-common-format": "Format",
  "settings-common-syntax-ref": "Syntax Reference",
  "settings-common-syntax-preview": "Your current syntax looks like this:",
  "settings-common-folder": "Note Folder",
  "settings-common-template-desc": "Choose the file to use as a template",
  "settings-common-template-placeholder": "e.g. templates/template-file",
  "settings-common-folder-placeholder": "e.g. folder 1/folder 2",

  "template-title-day": "Daily Note Template",
  "template-title-week": "Weekly Note Template",
  "template-title-month": "Monthly Note Template",
  "template-title-quarter": "Quarterly Note Template",
  "template-title-year": "Yearly Note Template",

  "folder-desc-day": "New daily notes will be placed here",
  "folder-desc-week": "New weekly notes will be placed here",
  "folder-desc-month": "New monthly notes will be placed here",
  "folder-desc-quarter": "New quarterly notes will be placed here",
  "folder-desc-year": "New yearly notes will be placed here",

  // Warnings
  "warning-loose-parsing": "Your filename format cannot be parsed. If you would still like to use this format for your {periodicity} notes, you will need to include the following in the frontmatter of your template file:",
  "warning-fragile-basename": "Your base filename is not uniquely identifiable. If you would still like to use this format, it is recommended that you include the following in the frontmatter of your daily note template:",

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