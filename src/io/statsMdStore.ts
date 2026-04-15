import { TFile } from "obsidian";
import type { App, TAbstractFile } from "obsidian";

interface WordCount {
  accumulatedDelta: number;
  lastAcceptedCount: number;
}

interface WordCountTableRow extends WordCount {
  rowId: string;
  noteLink: string;
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
    if (!value || typeof value !== "object") {
      return acc;
    }

    const typed = value as Record<string, unknown>;

    if (
      typeof typed.accumulatedDelta === "number" &&
      Number.isFinite(typed.accumulatedDelta) &&
      typeof typed.lastAcceptedCount === "number" &&
      Number.isFinite(typed.lastAcceptedCount)
    ) {
      acc[key] = {
        accumulatedDelta: typed.accumulatedDelta,
        lastAcceptedCount: typed.lastAcceptedCount,
      };
      return acc;
    }

    // Backward compatibility: migrate legacy { initial, current } format.
    if (
      typeof typed.initial === "number" &&
      Number.isFinite(typed.initial) &&
      typeof typed.current === "number" &&
      Number.isFinite(typed.current)
    ) {
      acc[key] = {
        accumulatedDelta: typed.current - typed.initial,
        lastAcceptedCount: typed.current,
      };
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
    const existingContent = (await this.app.vault.adapter.exists(statsPath))
      ? await this.app.vault.adapter.read(statsPath)
      : "";
    await this.app.vault.adapter.write(statsPath, this.buildTemplate(settings, existingContent));
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
    const todaysWordCount = this.readTodaysWordCount(content);
    const pomoCounts = this.readSection(content, "Pomodoro Counts");

    return {
      dayCounts: normalizeRecord(dayCounts),
      todaysWordCount,
      pomoCounts: normalizeRecord(pomoCounts),
    };
  }

  private readTodaysWordCount(content: string): Record<string, WordCount> {
    const parsedRows = this.parseWordCountTable(content);
    if (parsedRows.length > 0) {
      const dedupedRows = this.dedupeRows(parsedRows);
      const data: Record<string, WordCount> = {};
      dedupedRows.forEach((row) => {
        const file = this.resolveNoteLink(row.noteLink);
        if (!file) return;

        data[file.path] = {
          accumulatedDelta: row.accumulatedDelta,
          lastAcceptedCount: row.lastAcceptedCount,
        };
      });
      return data;
    }

    // Backward compatibility for old JSON format.
    const oldFormat = this.readSection(content, "Today's Word Count");
    return normalizeTodaysWordCount(oldFormat);
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
    const dayCounts = JSON.stringify(settings.dayCounts ?? {}, null, 2);
    const pomoCounts = JSON.stringify(settings.pomoCounts ?? {}, null, 2);
    const todaysWordCountRows = this.buildRowsForWrite(settings.todaysWordCount ?? {}, existingContent);
    const todaysWordCount = this.buildWordCountTable(todaysWordCountRows);

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
      todaysWordCount,
      "",
      "## Pomodoro Counts",
      "",
      "```json",
      pomoCounts,
      "```",
      "",
    ].join("\n");
  }

  private handleRename = (file: TAbstractFile, oldPath: string): void => {
    if (!("path" in file)) return;

    const rowId = this.filePathToRowId.get(oldPath);
    if (!rowId) return;

    this.filePathToRowId.delete(oldPath);
    this.filePathToRowId.set(file.path, rowId);
  };

  private parseWordCountTable(content: string): WordCountTableRow[] {
    const sectionRegex = /## Today's Word Count\s*\n([\s\S]*?)(\n## |\s*$)/m;
    const sectionMatch = content.match(sectionRegex);
    if (!sectionMatch || !sectionMatch[1]) {
      return [];
    }

    const lines = sectionMatch[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|"));

    if (lines.length < 3) return [];

    const rows: WordCountTableRow[] = [];
    for (let i = 2; i < lines.length; i++) {
      const cells = lines[i]
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);
      if (cells.length < 3) continue;

      const accumulatedDelta = Number(cells[1]);
      const lastAcceptedCount = Number(cells[2]);
      if (!Number.isFinite(accumulatedDelta) || !Number.isFinite(lastAcceptedCount)) {
        continue;
      }

      const rowId = this.getRowIdFromLink(cells[0], i);
      rows.push({
        rowId,
        noteLink: cells[0],
        accumulatedDelta,
        lastAcceptedCount,
      });

      const file = this.resolveNoteLink(cells[0]);
      if (file) {
        this.filePathToRowId.set(file.path, rowId);
      }
    }

    return rows;
  }

  private buildRowsForWrite(
    todaysWordCount: Record<string, WordCount>,
    existingContent: string,
  ): WordCountTableRow[] {
    const existingRows = this.parseWordCountTable(existingContent);
    const nextRows: WordCountTableRow[] = [...existingRows];

    for (const [filePath, wordCount] of Object.entries(todaysWordCount)) {
      const target = this.app.vault.getAbstractFileByPath(filePath);
      if (!(target instanceof TFile)) {
        continue;
      }

      const byLinkIdx = nextRows.findIndex((row) => {
        const resolved = this.resolveNoteLink(row.noteLink);
        return Boolean(resolved && resolved.path === target.path);
      });
      const byIndexRowId = this.filePathToRowId.get(target.path);
      const byIndexIdx = byIndexRowId
        ? nextRows.findIndex((row) => row.rowId === byIndexRowId)
        : -1;

      const foundIdx = byLinkIdx >= 0 ? byLinkIdx : byIndexIdx;

      if (foundIdx >= 0) {
        nextRows[foundIdx] = {
          ...nextRows[foundIdx],
          noteLink: this.toNoteLink(target),
          accumulatedDelta: wordCount.accumulatedDelta,
          lastAcceptedCount: wordCount.lastAcceptedCount,
        };
        this.filePathToRowId.set(target.path, nextRows[foundIdx].rowId);
        continue;
      }

      // New row is created only when link matching and in-memory index both fail.
      const rowId = this.createRowId(target.path);
      const row: WordCountTableRow = {
        rowId,
        noteLink: this.toNoteLink(target),
        accumulatedDelta: wordCount.accumulatedDelta,
        lastAcceptedCount: wordCount.lastAcceptedCount,
      };
      nextRows.push(row);
      this.filePathToRowId.set(target.path, rowId);
    }

    return this.dedupeRows(nextRows);
  }

  private dedupeRows(rows: WordCountTableRow[]): WordCountTableRow[] {
    const deduped = new Map<string, WordCountTableRow>();
    const unresolvedRows: WordCountTableRow[] = [];

    rows.forEach((row) => {
      const file = this.resolveNoteLink(row.noteLink);
      if (!file) {
        unresolvedRows.push(row);
        return;
      }

      const key = file.path;
      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, row);
        this.filePathToRowId.set(key, row.rowId);
        return;
      }

      deduped.set(key, {
        ...existing,
        noteLink: this.toNoteLink(file),
        accumulatedDelta: existing.accumulatedDelta + row.accumulatedDelta,
        lastAcceptedCount: Math.max(existing.lastAcceptedCount, row.lastAcceptedCount),
      });
    });

    return [...deduped.values(), ...unresolvedRows];
  }

  private buildWordCountTable(rows: WordCountTableRow[]): string {
    const tableRows = rows.map((row) => `| ${row.noteLink} | ${row.accumulatedDelta} | ${row.lastAcceptedCount} |`);
    return [
      "| Note | Accumulated Delta | Last Accepted Count |",
      "| --- | ---: | ---: |",
      ...tableRows,
    ].join("\n");
  }

  private resolveNoteLink(noteLink: string): TFile | null {
    const match = noteLink.match(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/);
    if (!match || !match[1]) return null;

    const path = match[1].trim();
    const file = this.app.metadataCache.getFirstLinkpathDest(path, "");
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
