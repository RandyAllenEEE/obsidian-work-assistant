export default {
  // Plugin info
  "plugin-name": "Work Assistant",
  "plugin-description": "Calendar view with word count statistics for your daily notes",

  // Commands
  "command-open-view": "Open view",
  "command-open-weekly-note": "Open Weekly Note",
  "command-reveal-active-note": "Reveal active note",
  "command-pomo-start": "Start Pomodoro Timer",
  "command-pomo-pause": "Pause Pomodoro Timer", 
  "command-pomo-quit": "Stop Pomodoro Timer",

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

  // Settings - Weather
  "settings-weather-title": "Weather",
  "settings-weather-desc": "Enable weather widget in the assistant panel",
  "settings-weather-city": "City",
  "settings-weather-city-desc": "Enter your city name for weather information",
  "settings-weather-token": "Token Secret ID",
  "settings-weather-token-desc": "QWeather API token secret ID",
  "settings-weather-host": "Host Secret ID", 
  "settings-weather-host-desc": "QWeather API host secret ID",
  "settings-weather-interval": "Refresh Interval",
  "settings-weather-interval-desc": "Weather refresh interval in minutes",
  "settings-weather-daily-interval": "Daily Refresh Interval",
  "settings-weather-daily-interval-desc": "Daily weather data refresh interval in hours",
  "settings-weather-warnings-enable": "Weather Warnings",
  "settings-weather-warnings-desc": "Enable severe weather warnings",

  // Settings - Weekly Note
  "settings-weekly-note-title": "Weekly Note Settings",
  "settings-weekly-note-format": "Weekly note format",
  "settings-weekly-note-format-desc": "For more syntax help, refer to format reference",
  "settings-weekly-note-template": "Weekly note template",
  "settings-weekly-note-template-desc": "Choose the file you want to use as the template for your weekly notes",
  "settings-weekly-note-folder": "Weekly note folder",
  "settings-weekly-note-folder-desc": "New weekly notes will be placed here",

  // Settings - Word Count Background
  "settings-word-count-bg-title": "Word Count Heatmap",
  "settings-color-range": "Color Range",
  "settings-color-range-desc": "Min: {min}, Max: {max}, Opacity: {opacity} (Background color intensity based on daily note word count)",
  "settings-reset-ranges": "Reset to Default Ranges",
  "settings-reset-ranges-desc": "Restore the default word count color ranges",

  // Settings - Word Count Additional Options
  "settings-word-count-stats-md-path": "Stats file path",
  "settings-word-count-stats-md-path-desc": "Markdown file path used to persist word count stats. Cannot be empty. Default: stats.md.",
  "settings-word-count-shock-threshold": "Shock threshold",
  "settings-word-count-shock-threshold-desc": "When a single word count change exceeds this threshold, it will be ignored to prevent abnormal data. Set to -1 to disable this feature. Default: 1000.",
  "settings-word-count-debounce-delay": "Debounce delay",
  "settings-word-count-debounce-delay-desc": "Debounce delay time (milliseconds) after word count changes. Multiple changes within this time will only save the last one. Default: 2000ms.",
  "settings-word-count-auto-save-interval": "Auto-save interval",
  "settings-word-count-auto-save-interval-desc": "Auto-save interval for word count statistics (milliseconds). Saves periodically even without changes to ensure data safety. Default: 30000ms (30 seconds).",
  "settings-word-count-ignored-files": "Ignored files/folders",
  "settings-word-count-ignored-files-desc": "List of files or folders to exclude from word count (one per line). Supports exact paths and regex patterns. Paths are relative to vault root.",

  // Settings - Advanced
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
  "settings-periodic-notes-title": "Periodic Notes",
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


  // Status Bar
  "status-bar-words-today": "{count} words today",
  "status-bar-words-today-detail": "{file} / {total} words today",

  // Calendar UI
  "calendar-week": "W",
  "calendar-tooltip-words": "Words",
  "calendar-tooltip-pomo": "Pomodoros",

  // Word Count Ranges
  "word-count-range-0": "0",
  "word-count-range-150": "150",
  "word-count-range-400": "400",
  "word-count-range-750": "750",
  "word-count-range-1500": "1500",
  "word-count-range-infinity": "Infinity",

  // Pomodoro
  "pomo-title": "Pomodoro Timer",
  "pomo-notice-paused": "Pomodoro timer paused",
  "pomo-notice-start": "Starting {time} {unit} {mode}",
  "pomo-notice-quit": "Pomodoro timer stopped",
  "pomo-notice-restart": "Restarting {mode}",
  "pomo-mode-work": "work session",
  "pomo-mode-break": "break",
  "pomo-unit-minute": "minute",
  "pomo-unit-minute-plural": "minutes",
  "pomo-unit-second": "second",  
  "pomo-unit-second-plural": "seconds",
  "pomo-sys-notif-pomo-end": "🍅 Pomodoro completed! Time for a {emoji} break!",
  "pomo-sys-notif-break-end": "Break time's up! Back to work! {emoji}",
  "pomo-sys-notif-title": "Work Assistant {emoji}",
  "pomo-status-bar-aria": "Pomodoro timer status",
  "settings-pomo-time-settings": "Time Settings",
  "settings-pomo-work": "Pomodoro duration (minutes)",
  "settings-pomo-work-desc": "Length of a single pomodoro cycle",
  "settings-pomo-short-break": "Short break duration (minutes)",
  "settings-pomo-short-break-desc": "Length of a short break",
  "settings-pomo-long-break": "Long break duration (minutes)",
  "settings-pomo-long-break-desc": "Length of a long break",
  "settings-pomo-long-break-interval": "Long break interval",
  "settings-pomo-long-break-interval-desc": "Number of pomodoros before a long break",
  "settings-pomo-continuous": "Continuous Mode",
  "settings-pomo-continuous-desc": "Automatically start the next timer (25m work + 5m break + ...)",
  "settings-pomo-auto-cycles": "Cycles before pause",
  "settings-pomo-auto-cycles-desc": "Number of cycles to run automatically before stopping (0 for infinite if Continuous Mode is on)",
  "settings-notification-settings": "Notification Settings",
  "settings-white-noise": "White noise",
  "settings-white-noise-desc": "Play white noise while timer is active",
  "media-control-title": "Media Control",
  "settings-pomo-background-noise": "Background White Noise",
  "settings-pomo-background-noise-desc": "Select an audio file for background white noise",
  "settings-notification-sound": "Notification sound",
  "settings-notification-sound-desc": "Play a sound when timer ends",
  "settings-use-system-notification": "System Notification",
  "settings-use-system-notification-desc": "Use system notification when timer ends",

  "view-name-assistant": "Assistant",
  "settings-assistant-panel-title": "Assistant Panel",
  "settings-widgets-title": "Widgets",
  "settings-widget-order": "Widget Order",
  "settings-widget-order-desc": "Comma-separated list of widgets (flipClock, calendar, weather).",

  "settings-calendar-view-title": "Calendar view",
  "settings-show-flip-clock": "Show Flip Clock",
  "settings-show-flip-clock-desc": "Display a retro flip clock animation above the calendar.",
  "settings-periodic-notes-section": "Periodic notes",
  "settings-periodic-format": "Note format",
  "settings-periodic-format-desc": "Date format for the note name (e.g., YYYY-MM-DD)",
  "settings-periodic-folder": "Folder path",
  "settings-periodic-folder-desc": "Folder where notes will be created",
  "settings-periodic-open-at-startup": "Open at startup",
  "settings-periodic-open-at-startup-desc": "Automatically open this note when Obsidian starts",
  "settings-calendar-linkage-title": "Calendar Linkage",
  "settings-calendar-linkage-desc": "Enable interaction with the Calendar View (clicking days/weeks)",
  "settings-periodic-note-configs": "Note Configurations",
  "settings-word-count-section-title": "Word Count",
  "settings-word-count-status-bar-title": "Status Bar",
  "settings-word-count-status-bar-desc": "Show word count in the status bar",
  "settings-word-count-heatmap-desc": "Show word count intensity on the Calendar View",
  "settings-requires-calendar-view": "Requires Calendar View",
  "settings-locale-default": "Locale default ({day})",
  "settings-calendar-view-title-desc": "Calendar view",
}