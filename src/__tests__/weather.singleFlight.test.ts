jest.mock("obsidian", () => ({
  requestUrl: jest.fn(),
}));

import { QWeatherService } from "../weather/QWeatherService";

describe("QWeatherService single-flight", () => {
  test("coalesces callers and upgrades a queued warning request to full weather", async () => {
    const service = new QWeatherService({} as any) as any;
    let resolveFirst: ((value: null) => void) | undefined;
    const first = new Promise<null>((resolve) => { resolveFirst = resolve; });
    const fetchSpy = jest.spyOn(service, "fetchData")
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(null);

    const warnings = service.getWarnings();
    const weather = service.getWeather();
    const duplicateWeather = service.getWeather();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFirst?.(null);
    await Promise.all([warnings, weather, duplicateWeather]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenLastCalledWith(false, "all");
  });
});
