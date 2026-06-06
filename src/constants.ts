export const DEFAULT_WEEK_FORMAT = "gggg-[W]ww";
export const DEFAULT_WORDS_PER_DOT = 250;
export const VIEW_TYPE_ASSISTANT = "work-assistant-assistant";
export const VIEW_TYPE_CALENDAR = VIEW_TYPE_ASSISTANT;
export const LEGACY_VIEW_TYPE_CALENDAR = "calendar";
export const ASSISTANT_VIEW_TYPE_ALIASES = [
  VIEW_TYPE_ASSISTANT,
  LEGACY_VIEW_TYPE_CALENDAR,
] as const;
export const ASSISTANT_VIEW_DISPLAY_TEXT = "assistant";
export const ASSISTANT_VIEW_DISPLAY_TEXT_ALIASES = [
  ASSISTANT_VIEW_DISPLAY_TEXT,
  "Assistant",
  "助手",
] as const;

export const TRIGGER_ON_OPEN = "calendar:open";
export const DEFAULT_REFRESH_INTERVAL = 2000;
