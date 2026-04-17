import { WhiteNoiseService } from "../services/audio/WhiteNoiseService";

jest.mock("obsidian", () => {
  class Component {}
  return { Component };
});

describe("WhiteNoiseService", () => {
  class MockAudio {
    src: string;
    loop = false;
    currentTime = 0;
    onerror: ((e: unknown) => void) | null = null;
    play = jest.fn().mockResolvedValue(undefined);
    pause = jest.fn();

    constructor(url: string) {
      this.src = url;
    }
  }

  beforeAll(() => {
    (global as any).Audio = MockAudio;
  });

  function createService() {
    const plugin = {} as any;
    return new WhiteNoiseService(plugin);
  }

  test("initialize creates audio once", () => {
    const service = createService() as any;
    service.initialize("a.mp3");
    const first = service.audio;
    service.initialize("b.mp3");
    expect(service.audio).toBe(first);
    expect(service.audio.src).toBe("a.mp3");
  });

  test("setUrl reuses existing audio element", () => {
    const service = createService() as any;
    service.initialize("a.mp3");
    const first = service.audio;
    service.setUrl("b.mp3");
    expect(service.audio).toBe(first);
    expect(service.audio.src).toBe("b.mp3");
    expect(service.audio.loop).toBe(true);
  });

  test("play updates SMTC state to playing", async () => {
    const service = createService() as any;
    const smtc = { setPlaybackState: jest.fn() };
    service.setSMTC(smtc);
    service.initialize("a.mp3");
    service.play();
    await Promise.resolve();
    expect(smtc.setPlaybackState).toHaveBeenCalledWith("playing");
  });

  test("pause updates SMTC state to paused", () => {
    const service = createService() as any;
    const smtc = { setPlaybackState: jest.fn() };
    service.setSMTC(smtc);
    service.initialize("a.mp3");
    service.pause();
    expect(smtc.setPlaybackState).toHaveBeenCalledWith("paused");
  });

  test("stop resets currentTime and updates SMTC state to none", () => {
    const service = createService() as any;
    const smtc = { setPlaybackState: jest.fn() };
    service.setSMTC(smtc);
    service.initialize("a.mp3");
    service.stop();
    expect(service.audio.currentTime).toBe(0);
    expect(smtc.setPlaybackState).toHaveBeenCalledWith("none");
  });
});
