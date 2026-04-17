const unsubscribeSpy = jest.fn();
const settingsSubscribeSpy: jest.Mock = jest.fn((_callback: (value: any) => void) => unsubscribeSpy);

jest.mock("obsidian", () => {
  class Component {}
  class ItemView {
    app: any;
    contentEl: any;
    containerEl: any;
    constructor(leaf: any) {
      this.app = leaf.app;
      this.contentEl = {};
      this.containerEl = { style: { setProperty: jest.fn() } };
    }
    registerEvent(_eventRef: any) {
      return _eventRef;
    }
  }
  class FileView {}
  return { Component, ItemView, FileView };
});

jest.mock("src/constants", () => ({
  TRIGGER_ON_OPEN: "trigger-on-open",
  VIEW_TYPE_CALENDAR: "calendar-view",
  DEFAULT_REFRESH_INTERVAL: 2000,
}));

jest.mock("../i18n", () => ({
  t: (key: string) => key,
}));

jest.mock("../ui/Calendar.svelte", () => ({}));
jest.mock("svelte", () => ({
  mount: jest.fn(() => ({})),
  unmount: jest.fn(),
}));

jest.mock("../ui/fileMenu", () => ({
  showFileMenu: jest.fn(),
}));

jest.mock("../ui/stores", () => ({
  activeFile: { setFile: jest.fn() },
  settings: {
    subscribe: (callback: (value: any) => void) => settingsSubscribeSpy(callback),
  },
}));

jest.mock("../ui/sources", () => ({
  customTagsSource: {},
  streakSource: {},
  wordCountSource: {},
  tasksSource: {},
  createWordCountBackgroundSource: jest.fn(() => ({})),
  createDailyStatsSource: jest.fn(() => ({})),
}));

jest.mock("../periodic/utils", () => ({
  isMetaPressed: jest.fn(() => false),
}));

import CalendarView from "../view";

describe("CalendarView subscriptions", () => {
  beforeEach(() => {
    unsubscribeSpy.mockClear();
    settingsSubscribeSpy.mockClear();
  });

  test("onClose unsubscribes settings listener", async () => {
    const app = {
      workspace: {
        on: jest.fn(() => ({})),
        trigger: jest.fn(),
        activeLeaf: { view: {} },
      },
      vault: {
        on: jest.fn(() => ({})),
      },
    };
    const leaf = { app } as any;
    const plugin = {
      wordCountStats: {},
      weatherService: {},
      options: {
        periodicNotes: { calendarLinkage: true, day: { format: "YYYY-MM-DD" }, week: { format: "gggg-[W]ww" } },
      },
      cache: {
        getPeriodicNote: jest.fn(() => null),
        find: jest.fn(() => null),
      },
      openPeriodicNote: jest.fn(),
    } as any;

    const view = new CalendarView(leaf, plugin);
    expect(settingsSubscribeSpy).toHaveBeenCalledTimes(1);
    await view.onClose();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });
});
