import { TFile } from "obsidian";
import type { App, TAbstractFile } from "obsidian";

interface WordCount {
  accumulatedDelta: number;
  lastAcceptedCount: number;
}

export interface WordCountSnapshot {
  settings: DailyStatsSettings;
  todaysAggregate: TodaysWordCountAggregate;
}

export interface TodaysWordCountStat {
  displayDelta: number;
  lastAcceptedCount: number;
}

export interface TodaysWordCountAggregate {
  total: number;
  byFile: Record<string, TodaysWordCountStat>;
}

interface NoteTableRow {
  rowId: string;
  noteLink: string;
  countsByDate: Record<string, number>;
}

interface TableModel {
  dates: string[];
  pomoByDate: Record<string, number>;
  noteRows: NoteTableRow[];
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

const DATE_COLUMN_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

export class StatsMdStore {
  private readonly filePathToRowId = new Map<string, string>();

  constructor(
    private readonly app: App,
    private readonly getPath: () => string,
  ) {
    this.app.vault.on("rename", this.handleRename);
  }

  async load(): Promise<WordCountSnapshot> {
    const statsPath = this.getPath();

    if (!(await this.app.vault.adapter.exists(statsPath))) {
      await this.ensureParentDirectory(statsPath);
      await this.app.vault.adapter.write(statsPath, this.buildTemplate(DEFAULT_SETTINGS));
      return this.buildSnapshot({ ...DEFAULT_SETTINGS });
    }

    try {
      const content = await this.app.vault.adapter.read(statsPath);
      return this.buildSnapshot(this.parse(content));
    } catch (error) {
      console.error("[Work Assistant] Failed to read stats.md, using defaults", error);
      return this.buildSnapshot({ ...DEFAULT_SETTINGS });
    }
  }

  async save(settings: DailyStatsSettings): Promise<WordCountSnapshot> {
    const statsPath = this.getPath();
    await this.ensureParentDirectory(statsPath);
    const existingContent = (await this.app.vault.adapter.exists(statsPath))
      ? await this.app.vault.adapter.read(statsPath)
      : "";
    const nextContent = this.buildTemplate(settings, existingContent);
    await this.app.vault.adapter.write(statsPath, nextContent);
    return this.buildSnapshot(this.parse(nextContent));
  }

  buildSnapshot(settings: DailyStatsSettings): WordCountSnapshot {
    const normalizedSettings = {
      dayCounts: settings.dayCounts ?? {},
      todaysWordCount: settings.todaysWordCount ?? {},
      pomoCounts: settings.pomoCounts ?? {},
    };

    const todaysAggregate = this.getTodaysWordCountAggregate(normalizedSettings.todaysWordCount);
    return {
      settings: normalizedSettings,
      todaysAggregate,
    };
  }

  getTodaysWordCountAggregate(todaysWordCount: Record<string, WordCount>): TodaysWordCountAggregate {
    const byFile: Record<string, TodaysWordCountStat> = {};
    let total = 0;

    for (const [filePath, wordCount] of Object.entries(todaysWordCount ?? {})) {
      const displayDelta = Math.max(0, wordCount.accumulatedDelta);
      byFile[filePath] = {
        displayDelta,
        lastAcceptedCount: wordCount.lastAcceptedCount,
      };
      total += displayDelta;
    }

    return { total, byFile };
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
    const model = this.parseTable(content);
    const baselines = normalizeRecord(this.readSection(content, "Baselines"));

    const dayCounts: Record<string, number> = {};
    model.dates.forEach((date) => {
      let total = 0;
      model.noteRows.forEach((row) => {
        const raw = row.countsByDate[date] ?? 0;
        total += Math.max(0, raw);
      });
      dayCounts[date] = total;
    });

    const today = window.moment().format("YYYY-MM-DD");
    const todaysWordCount: Record<string, WordCount> = {};
    model.noteRows.forEach((row) => {
      const file = this.resolveNoteLink(row.noteLink);
      if (!file) return;
      const accumulatedDelta = row.countsByDate[today] ?? 0;
      const baseline = baselines[file.path];
      todaysWordCount[file.path] = {
        accumulatedDelta,
        lastAcceptedCount: Number.isFinite(baseline) ? baseline : accumulatedDelta,
      };
      this.filePathToRowId.set(file.path, row.rowId);
    });

    return {
      dayCounts,
      todaysWordCount,
      pomoCounts: model.pomoByDate,
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

  private buildTemplate(settings: DailyStatsSettings, existingContent = ""): string {
    const existingModel = this.parseTable(existingContent);
    const today = window.moment().format("YYYY-MM-DD");

    const dateSet = new Set<string>(existingModel.dates);
    Object.keys(settings.dayCounts ?? {}).forEach((date) => dateSet.add(date));
    Object.keys(settings.pomoCounts ?? {}).forEach((date) => dateSet.add(date));
    dateSet.add(today);

    const dates = [...dateSet].filter((date) => DATE_COLUMN_PATTERN.test(date)).sort();

    const rowById = new Map<string, NoteTableRow>();
    const rowByPath = new Map<string, NoteTableRow>();

    // keep existing rows and historical values
    existingModel.noteRows.forEach((row) => {
      const normalized = {
        ...row,
        countsByDate: { ...row.countsByDate },
      };
      rowById.set(normalized.rowId, normalized);
      const file = this.resolveNoteLink(normalized.noteLink);
      if (file) {
        rowByPath.set(file.path, normalized);
        this.filePathToRowId.set(file.path, normalized.rowId);
      }
    });

    // apply current-day values from runtime settings
    Object.entries(settings.todaysWordCount ?? {}).forEach(([filePath, wordCount]) => {
      const target = this.app.vault.getAbstractFileByPath(filePath);
      if (!(target instanceof TFile)) {
        return;
      }

      const knownRowId = this.filePathToRowId.get(target.path);
      let row = (knownRowId ? rowById.get(knownRowId) : undefined) ?? rowByPath.get(target.path);

      if (!row) {
        row = {
          rowId: this.createRowId(target.path),
          noteLink: this.toNoteLink(target),
          countsByDate: {},
        };
      }

      row.noteLink = this.toNoteLink(target);
      row.countsByDate[today] = wordCount.accumulatedDelta;
      rowById.set(row.rowId, row);
      rowByPath.set(target.path, row);
      this.filePathToRowId.set(target.path, row.rowId);
    });

    const noteRows = this.dedupeRows([...rowById.values()]);

    const pomoByDate: Record<string, number> = {};
    dates.forEach((date) => {
      pomoByDate[date] = settings.pomoCounts?.[date] ?? existingModel.pomoByDate[date] ?? 0;
    });

    const baselinePayload = Object.entries(settings.todaysWordCount ?? {}).reduce<Record<string, number>>((acc, [path, stat]) => {
      if (Number.isFinite(stat.lastAcceptedCount)) {
        acc[path] = stat.lastAcceptedCount;
      }
      return acc;
    }, {});

    const table = this.buildMainTable(dates, noteRows, pomoByDate);

    return [
      "# Work Assistant Stats",
      "",
      "> This file is managed by Work Assistant. Edit with care.",
      "",
      table,
      "",
      "## Baselines",
      "",
      "```json",
      JSON.stringify(baselinePayload, null, 2),
      "```",
      "",
    ].join("\n");
  }

  private handleRename = (file: TAbstractFile, oldPath: string): void => {
    if (!(file instanceof TFile)) return;

    const rowId = this.filePathToRowId.get(oldPath);
    if (!rowId) return;

    this.filePathToRowId.delete(oldPath);
    this.filePathToRowId.set(file.path, rowId);
  };

  private parseTable(content: string): TableModel {
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|"));

    if (lines.length < 3) {
      return { dates: [], pomoByDate: {}, noteRows: [] };
    }

    const headerCells = this.parseTableCells(lines[0]);
    if (headerCells.length < 2 || headerCells[0].toLowerCase() !== "note") {
      return { dates: [], pomoByDate: {}, noteRows: [] };
    }

    const dates = headerCells.slice(1).filter((date) => DATE_COLUMN_PATTERN.test(date));
    if (dates.length === 0) {
      return { dates: [], pomoByDate: {}, noteRows: [] };
    }

    const pomoByDate: Record<string, number> = {};
    dates.forEach((date) => {
      pomoByDate[date] = 0;
    });

    const noteRows: NoteTableRow[] = [];

    for (let i = 2; i < lines.length; i++) {
      const cells = this.parseTableCells(lines[i]);
      if (cells.length === 0) continue;

      const label = cells[0];
      if (!label) continue;

      if (label === "🍅 POMO") {
        dates.forEach((date, idx) => {
          const raw = Number(cells[idx + 1]);
          if (Number.isFinite(raw)) {
            pomoByDate[date] = raw;
          }
        });
        continue;
      }

      const row: NoteTableRow = {
        rowId: this.getRowIdFromLink(label, i),
        noteLink: label,
        countsByDate: {},
      };

      dates.forEach((date, idx) => {
        const raw = Number(cells[idx + 1]);
        if (Number.isFinite(raw)) {
          row.countsByDate[date] = raw;
        }
      });

      noteRows.push(row);
    }

    return {
      dates,
      pomoByDate,
      noteRows: this.dedupeRows(noteRows),
    };
  }

  private parseTableCells(line: string): string[] {
    return line
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);
  }

  private dedupeRows(rows: NoteTableRow[]): NoteTableRow[] {
    const deduped = new Map<string, NoteTableRow>();

    rows.forEach((row) => {
      const file = this.resolveNoteLink(row.noteLink);
      const key = file ? `file:${file.path}` : `link:${row.noteLink}`;
      // later row wins
      deduped.set(key, row);
      if (file) {
        this.filePathToRowId.set(file.path, row.rowId);
      }
    });

    return [...deduped.values()];
  }

  private buildMainTable(
    dates: string[],
    noteRows: NoteTableRow[],
    pomoByDate: Record<string, number>,
  ): string {
    const header = `| Note | ${dates.join(" | ")} |`;
    const separator = `| --- | ${dates.map(() => "---:").join(" | ")} |`;
    const pomoRow = `| 🍅 POMO | ${dates.map((date) => String(pomoByDate[date] ?? 0)).join(" | ")} |`;

    const bodyRows = noteRows.map((row) => {
      const values = dates.map((date) => String(row.countsByDate[date] ?? 0));
      return `| ${row.noteLink} | ${values.join(" | ")} |`;
    });

    return [header, separator, pomoRow, ...bodyRows].join("\n");
  }

  private resolveNoteLink(noteLink: string): TFile | null {
    const match = noteLink.match(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/);
    if (!match || !match[1]) return null;

    const path = match[1].trim();
    const file = this.app.metadataCache.getFirstLinkpathDest(path, this.getPath());
    return file ?? null;
  }

  private toNoteLink(file: TFile): string {
    const linkPath = file.path.replace(/\.md$/i, "");
    return `[[${linkPath}]]`;
  }

  private createRowId(filePath: string): string {
    return `${filePath}::${Date.now()}`;
  }

  private getRowIdFromLink(noteLink: string, rowIndex: number): string {
    const file = this.resolveNoteLink(noteLink);
    if (file) {
      const known = this.filePathToRowId.get(file.path);
      if (known) return known;
      return this.createRowId(file.path);
    }
    return `row::${rowIndex}`;
  }
}

export const DEFAULT_DAILY_STATS_SETTINGS = DEFAULT_SETTINGS;
