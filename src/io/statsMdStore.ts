import type { App } from "obsidian";

interface WordCount {
  initial: number;
  current: number;
}

export interface DailyStatsSettings {
  dayCounts: Record<string, number>;
  todaysWordCount: Record<string, WordCount>;
  pomoCounts: Record<string, number>;
}

const DEFAULT_SETTINGS: DailyStatsSettings = {
  dayCounts: {},
  todaysWordCount: {},
  pomoCounts: {},
};

function normalizeRecord(values: unknown): Record<string, number> {
  if (!values || typeof values !== "object") {
    return {};
  }

  return Object.entries(values as Record<string, unknown>).reduce<Record<string, number>>((acc, [key, value]) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function normalizeTodaysWordCount(values: unknown): Record<string, WordCount> {
  if (!values || typeof values !== "object") {
    return {};
  }

  return Object.entries(values as Record<string, unknown>).reduce<Record<string, WordCount>>((acc, [key, value]) => {
    if (
      value &&
      typeof value === "object" &&
      typeof (value as WordCount).initial === "number" &&
      typeof (value as WordCount).current === "number"
    ) {
      acc[key] = {
        initial: (value as WordCount).initial,
        current: (value as WordCount).current,
      };
    }
    return acc;
  }, {});
}

export class StatsMdStore {
  constructor(
    private readonly app: App,
    private readonly getPath: () => string,
  ) {}

  async load(): Promise<DailyStatsSettings> {
    const statsPath = this.getPath();

    if (!(await this.app.vault.adapter.exists(statsPath))) {
      await this.ensureParentDirectory(statsPath);
      await this.app.vault.adapter.write(statsPath, this.buildTemplate(DEFAULT_SETTINGS));
      return { ...DEFAULT_SETTINGS };
    }

    try {
      const content = await this.app.vault.adapter.read(statsPath);
      return this.parse(content);
    } catch (error) {
      console.error("[Work Assistant] Failed to read stats.md, using defaults", error);
      return { ...DEFAULT_SETTINGS };
    }
  }

  async save(settings: DailyStatsSettings): Promise<void> {
    const statsPath = this.getPath();
    await this.ensureParentDirectory(statsPath);
    await this.app.vault.adapter.write(statsPath, this.buildTemplate(settings));
  }

  private async ensureParentDirectory(path: string): Promise<void> {
    const segments = path.split("/").filter(Boolean);
    if (segments.length <= 1) {
      return;
    }

    let currentPath = "";
    for (let i = 0; i < segments.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${segments[i]}` : segments[i];
      if (!(await this.app.vault.adapter.exists(currentPath))) {
        await this.app.vault.adapter.mkdir(currentPath);
      }
    }
  }

  private parse(content: string): DailyStatsSettings {
    const dayCounts = this.readSection(content, "Day Counts");
    const todaysWordCount = this.readSection(content, "Today's Word Count");
    const pomoCounts = this.readSection(content, "Pomodoro Counts");

    return {
      dayCounts: normalizeRecord(dayCounts),
      todaysWordCount: normalizeTodaysWordCount(todaysWordCount),
      pomoCounts: normalizeRecord(pomoCounts),
    };
  }

  private readSection(content: string, sectionName: string): unknown {
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const fence = "```";
    const regex = new RegExp(`## ${escaped}\\n\\n${fence}json\\n([\\s\\S]*?)\\n${fence}`, "m");
    const match = content.match(regex);

    if (!match || !match[1]) {
      return {};
    }

    try {
      return JSON.parse(match[1]);
    } catch (error) {
      console.warn(`[Work Assistant] Invalid JSON in stats.md section: ${sectionName}`, error);
      return {};
    }
  }

  private buildTemplate(settings: DailyStatsSettings): string {
    const dayCounts = JSON.stringify(settings.dayCounts ?? {}, null, 2);
    const todaysWordCount = JSON.stringify(settings.todaysWordCount ?? {}, null, 2);
    const pomoCounts = JSON.stringify(settings.pomoCounts ?? {}, null, 2);

    return [
      "# Work Assistant Stats",
      "",
      "> This file is managed by Work Assistant. Edit with care.",
      "",
      "## Day Counts",
      "",
      "```json",
      dayCounts,
      "```",
      "",
      "## Today's Word Count",
      "",
      "```json",
      todaysWordCount,
      "```",
      "",
      "## Pomodoro Counts",
      "",
      "```json",
      pomoCounts,
      "```",
      "",
    ].join("\n");
  }
}

export const DEFAULT_DAILY_STATS_SETTINGS = DEFAULT_SETTINGS;
