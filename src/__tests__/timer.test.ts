import moment from "moment";
import { Mode, Timer } from "../pomo/timer";

jest.mock("obsidian", () => ({
  Notice: class {
    // noop
    constructor(_msg: string) {
      // noop
    }
  },
}));

jest.mock("../services/audio/WhiteNoiseService", () => ({
  WhiteNoiseService: class {
    initialize = jest.fn();
    play = jest.fn();
    stop = jest.fn();
    setSMTC = jest.fn();
  },
}));

jest.mock("../utils/notifications", () => ({
  showNotification: jest.fn(),
}));

jest.mock("../i18n", () => ({
  t: (key: string) => key,
}));

describe("Timer", () => {
  beforeAll(() => {
    (global as any).window = { moment };
    (global as any).Audio = class {
      play = jest.fn().mockResolvedValue(undefined);
    };
  });

  function createPlugin(timerState: any = null) {
    return {
      options: {
        pomodoro: {
          work: 25,
          shortBreak: 5,
          longBreak: 15,
          longBreakInterval: 4,
          continuous: false,
          autoCycles: 0,
          notification: { sound: false, system: false },
        },
        media: {
          whiteNoise: false,
          backgroundNoiseFile: "",
        },
      },
      addChild: jest.fn(),
      cacheManager: {
        getTimer: jest.fn(() => timerState),
        updateTimer: jest.fn().mockResolvedValue(undefined),
      },
      wordCountStats: null,
    } as any;
  }

  test("loadState ignores invalid mode values", () => {
    const plugin = createPlugin({
      mode: 99,
      startTime: 1,
      endTime: 2,
      paused: false,
      pausedTime: 0,
      pomosSinceStart: 0,
      cyclesSinceLastAutoStop: 0,
    });
    const timer = new Timer(plugin);
    expect(timer.mode).toBe(Mode.NoTimer);
  });

  test("loadState restores valid mode", () => {
    const plugin = createPlugin({
      mode: Mode.Pomo,
      startTime: moment("2024-03-01T10:00:00").valueOf(),
      endTime: moment("2099-03-01T10:25:00").valueOf(),
      paused: false,
      pausedTime: 0,
      pomosSinceStart: 2,
      cyclesSinceLastAutoStop: 1,
    });
    const timer = new Timer(plugin);
    expect(timer.mode).toBe(Mode.Pomo);
    expect(timer.pomosSinceStart).toBe(2);
    expect(timer.cyclesSinceLastAutoStop).toBe(1);
  });

  test("startTimer with null starts Pomodoro from NoTimer", () => {
    const plugin = createPlugin();
    const timer = new Timer(plugin);
    timer.startTimer(null);
    expect(timer.mode).toBe(Mode.Pomo);
    expect(timer.paused).toBe(false);
  });

  test("getTotalModeMillisecs returns configured durations", () => {
    const plugin = createPlugin();
    const timer = new Timer(plugin);
    timer.mode = Mode.Pomo;
    expect(timer.getTotalModeMillisecs()).toBe(25 * 60 * 1000);
    timer.mode = Mode.ShortBreak;
    expect(timer.getTotalModeMillisecs()).toBe(5 * 60 * 1000);
    timer.mode = Mode.LongBreak;
    expect(timer.getTotalModeMillisecs()).toBe(15 * 60 * 1000);
  });

  test("setStatusBarText on NoTimer returns idle icon", async () => {
    const plugin = createPlugin();
    const timer = new Timer(plugin);
    timer.mode = Mode.NoTimer;
    await expect(timer.setStatusBarText()).resolves.toBe("🍅");
  });
});
