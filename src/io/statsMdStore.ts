import { TFile } from "obsidian";
import type { App } from "obsidian";

import { normalizePathForStorage } from "../utils/path";

export interface WordCount {
  initial: number;
  current: number;
}

export interface WordCountSnapshot {
  settings: DailyStatsSettings;
  todaysAggregate: TodaysWordCountAggregate;
}

export interface TodaysWordCountStat {
  displayDelta: number;
}

export interface TodaysWordCountAggregate {
  total: number;
  byFile: Record<string, TodaysWordCountStat>;
}

interface NoteTableRow {
  path: string;
  noteLink: string;
  countsByDate: Record<string, number>;
  initialCount: number;
  currentCount: number;
}

interface TableModel {
  dates: string[];
  pomoByDate: Record<string, number>;
  brokenLinksByDate: Record<string, number>;
  noteRows: Map<string, NoteTableRow>;
}

export interface DailyStatsSettings {
  dayCounts: Record<string, number>;
  todaysWordCount: Record<string, WordCount>;
  pomoCounts: Record<string, number>;
}

function createDefaultSettings(): DailyStatsSettings {
  return {
    dayCounts: {},
    todaysWordCount: {},
    pomoCounts: {},
  };
}

export const DEFAULT_DAILY_STATS_SETTINGS: DailyStatsSettings = createDefaultSettings();

const DATE_COLUMN_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BROKEN_LINKS_DISPLAY = "失效链接";
const BROKEN_LINKS_KEY = "__BROKEN_LINKS__";

export class StatsMdStore {
  private readonly app: App;
  private readonly getStatsMdPath: () => string;
  private model: TableModel = this.createEmptyModel();
  private revision = 0;
  private persistedRevision = 0;
  private initialized = false;

  /** The single mutable runtime state shared with WordCountStats. */
  public readonly settings: DailyStatsSettings = createDefaultSettings();

  constructor(app: App, getStatsMdPath: () => string) {
    this.app = app;
    this.getStatsMdPath = getStatsMdPath;
  }

  public cleanup(): void {
    // Vault lifecycle events are owned by WordCountStats so they share one order.
  }

  public markRuntimeChanged(): void {
    this.revision++;
  }

  public hasUnpersistedChanges(): boolean {
    return this.revision > this.persistedRevision;
  }

  public getTodaysBrokenLinksCount(): number {
    const today = window.moment().format("YYYY-MM-DD");
    return this.model.brokenLinksByDate[today] ?? 0;
  }

  public async load(): Promise<WordCountSnapshot> {
    const statsPath = this.getStatsMdPath();
    const exists = await this.app.vault.adapter.exists(statsPath);

    if (!exists) {
      this.model = this.createEmptyModel();
      this.syncSettingsFromModel();
      this.revision = 1;
      await this.writeContent(this.serializeModel());
      this.persistedRevision = this.revision;
      this.initialized = true;
      return this.getSnapshot();
    }

    try {
      const content = await this.app.vault.adapter.read(statsPath);
      this.model = this.parseTable(content);
      this.revision = 0;
      this.persistedRevision = 0;

      const originalDates = [...this.model.dates];
      this.model.dates = this.sortDates(this.model.dates);
      if (!this.sameArray(originalDates, this.model.dates)) {
        this.markRuntimeChanged();
      }

      if (this.reconcileMissingRows()) {
        this.markRuntimeChanged();
      }
      this.syncSettingsFromModel();
      this.initialized = true;
      return this.getSnapshot();
    } catch (error) {
      this.initialized = false;
      console.error("[Work Assistant] Failed to read or parse stats.md", error);
      throw error;
    }
  }

  public async save(settings: DailyStatsSettings = this.settings): Promise<WordCountSnapshot> {
    const runtimeInput = this.cloneSettings(settings);
    if (!this.initialized) await this.load();
    this.replaceSettings(runtimeInput);

    const runtimeSnapshot = this.cloneSettings(this.settings);
    this.applyRuntimeSettings(runtimeSnapshot);
    this.markRuntimeChanged();

    const writeRevision = this.revision;
    const content = this.serializeModel();
    await this.writeContent(content);
    this.persistedRevision = Math.max(this.persistedRevision, writeRevision);
    return this.getSnapshot();
  }

  public handleRename(oldPath: string, newPath: string, isFolder = false): boolean {
    const normalizedOldPath = normalizePathForStorage(oldPath);
    const normalizedNewPath = normalizePathForStorage(newPath);
    const paths = [...this.model.noteRows.keys()].filter((path) =>
      this.matchesPath(path, normalizedOldPath, isFolder)
    );

    let changed = false;
    for (const path of paths) {
      const suffix = path.slice(normalizedOldPath.length);
      const nextPath = `${normalizedNewPath}${suffix}`;
      this.renameModelRow(path, nextPath);
      this.moveRuntimePath(path, nextPath);
      changed = true;
    }

    if (!isFolder && paths.length === 0) {
      changed = this.moveRuntimePath(normalizedOldPath, normalizedNewPath);
    }

    if (changed) {
      this.markRuntimeChanged();
      this.refreshDayCountsFromLiveState();
    }
    return changed;
  }

  public handleDelete(path: string, isFolder = false): boolean {
    const normalizedPath = normalizePathForStorage(path);
    const modelPaths = [...this.model.noteRows.keys()].filter((candidate) =>
      this.matchesPath(candidate, normalizedPath, isFolder)
    );
    const runtimePaths = Object.keys(this.settings.todaysWordCount).filter((candidate) =>
      this.matchesPath(normalizePathForStorage(candidate), normalizedPath, isFolder)
    );
    const paths = new Set([...modelPaths, ...runtimePaths.map(normalizePathForStorage)]);

    if (paths.size === 0) return false;

    for (const candidate of paths) {
      this.archivePath(candidate, true);
    }
    this.markRuntimeChanged();
    this.refreshDayCountsFromLiveState();
    return true;
  }

  public buildSnapshot(settings: DailyStatsSettings = this.settings): WordCountSnapshot {
    return {
      settings,
      todaysAggregate: this.getTodaysWordCountAggregate(settings.todaysWordCount),
    };
  }

  public getTodaysWordCountAggregate(
    todaysWordCount: Record<string, WordCount>
  ): TodaysWordCountAggregate {
    const byFile: Record<string, TodaysWordCountStat> = {};
    let total = 0;

    for (const [filePath, wordCount] of Object.entries(todaysWordCount ?? {})) {
      const normalizedPath = normalizePathForStorage(filePath);
      const displayDelta = wordCount.current - wordCount.initial;
      byFile[normalizedPath] = { displayDelta };
      total += displayDelta;
    }
    return { total, byFile };
  }

  private getSnapshot(): WordCountSnapshot {
    return this.buildSnapshot(this.settings);
  }

  private createEmptyModel(): TableModel {
    const today = window.moment().format("YYYY-MM-DD");
    return {
      dates: [today],
      pomoByDate: { [today]: 0 },
      brokenLinksByDate: {},
      noteRows: new Map(),
    };
  }

  private replaceSettings(next: DailyStatsSettings): void {
    this.settings.dayCounts = { ...(next.dayCounts ?? {}) };
    this.settings.todaysWordCount = Object.fromEntries(
      Object.entries(next.todaysWordCount ?? {}).map(([path, count]) => [
        normalizePathForStorage(path),
        { ...count },
      ])
    );
    this.settings.pomoCounts = { ...(next.pomoCounts ?? {}) };
  }

  private cloneSettings(settings: DailyStatsSettings): DailyStatsSettings {
    return {
      dayCounts: { ...(settings.dayCounts ?? {}) },
      todaysWordCount: Object.fromEntries(
        Object.entries(settings.todaysWordCount ?? {}).map(([path, count]) => [path, { ...count }])
      ),
      pomoCounts: { ...(settings.pomoCounts ?? {}) },
    };
  }

  private applyRuntimeSettings(runtime: DailyStatsSettings): void {
    const today = window.moment().format("YYYY-MM-DD");
    const isFirstWriteForToday = !this.model.dates.includes(today);
    const dateSet = new Set([
      ...this.model.dates,
      ...Object.keys(runtime.dayCounts ?? {}),
      ...Object.keys(runtime.pomoCounts ?? {}),
      ...Object.keys(this.model.brokenLinksByDate),
      today,
    ]);

    if (isFirstWriteForToday) {
      for (const row of this.model.noteRows.values()) {
        row.initialCount = 0;
        row.currentCount = 0;
        row.countsByDate[today] = 0;
      }
    }

    for (const date of dateSet) {
      if (!DATE_COLUMN_PATTERN.test(date)) continue;
      this.model.pomoByDate[date] = runtime.pomoCounts?.[date]
        ?? this.model.pomoByDate[date]
        ?? 0;
    }

    const normalizedRuntime: Record<string, WordCount> = {};
    for (const [rawPath, wordCount] of Object.entries(runtime.todaysWordCount ?? {})) {
      const path = normalizePathForStorage(rawPath);
      const file = this.resolveFile(path);
      const existingRow = this.model.noteRows.get(path);

      if (!file) {
        if (existingRow) {
          existingRow.initialCount = wordCount.initial;
          existingRow.currentCount = wordCount.current;
          existingRow.countsByDate[today] = wordCount.current - wordCount.initial;
          this.archivePath(path, false);
        }
        continue;
      }

      const row = existingRow ?? {
        path,
        noteLink: `[[${path}]]`,
        countsByDate: {},
        initialCount: wordCount.initial,
        currentCount: wordCount.current,
      };
      row.initialCount = wordCount.initial;
      row.currentCount = wordCount.current;
      row.countsByDate[today] = wordCount.current - wordCount.initial;
      this.model.noteRows.set(path, row);
      normalizedRuntime[path] = { ...wordCount };
    }

    this.settings.todaysWordCount = normalizedRuntime;
    this.settings.pomoCounts = { ...this.model.pomoByDate };
    this.model.dates = this.sortDates([...dateSet]);
    this.refreshDayCountsFromLiveState();
  }

  private reconcileMissingRows(): boolean {
    const markdownPaths = this.getMarkdownPathSet();
    let changed = false;

    for (const path of [...this.model.noteRows.keys()]) {
      const exists = markdownPaths
        ? markdownPaths.has(path)
        : this.resolveFile(path) !== null;
      if (!exists) {
        this.archivePath(path, false);
        changed = true;
      }
    }
    return changed;
  }

  private getMarkdownPathSet(): Set<string> | null {
    const vault = this.app.vault as App["vault"] & {
      getMarkdownFiles?: () => TFile[];
    };
    if (typeof vault.getMarkdownFiles !== "function") return null;
    return new Set(vault.getMarkdownFiles().map((file) => normalizePathForStorage(file.path)));
  }

  private archivePath(path: string, useLiveToday: boolean): void {
    const normalizedPath = normalizePathForStorage(path);
    const today = window.moment().format("YYYY-MM-DD");
    let row = this.model.noteRows.get(normalizedPath);
    const runtimeCount = this.settings.todaysWordCount[normalizedPath];

    if (!row && runtimeCount) {
      row = {
        path: normalizedPath,
        noteLink: `[[${normalizedPath}]]`,
        countsByDate: {},
        initialCount: runtimeCount.initial,
        currentCount: runtimeCount.current,
      };
    }
    if (!row) return;

    if (useLiveToday && runtimeCount) {
      row.initialCount = runtimeCount.initial;
      row.currentCount = runtimeCount.current;
      row.countsByDate[today] = runtimeCount.current - runtimeCount.initial;
    }

    for (const [date, value] of Object.entries(row.countsByDate)) {
      if (!DATE_COLUMN_PATTERN.test(date) || value === 0) continue;
      this.model.brokenLinksByDate[date] =
        (this.model.brokenLinksByDate[date] ?? 0) + value;
    }

    this.model.noteRows.delete(normalizedPath);
    delete this.settings.todaysWordCount[normalizedPath];
    this.model.dates = this.sortDates([
      ...this.model.dates,
      ...Object.keys(row.countsByDate),
      ...Object.keys(this.model.brokenLinksByDate),
    ]);
  }

  private renameModelRow(oldPath: string, newPath: string): void {
    const row = this.model.noteRows.get(oldPath);
    if (!row) return;

    const entries = [...this.model.noteRows.entries()];
    this.model.noteRows = new Map(
      entries.map(([path, current]) => {
        if (path !== oldPath) return [path, current] as const;
        return [newPath, { ...current, path: newPath, noteLink: `[[${newPath}]]` }] as const;
      })
    );
  }

  private moveRuntimePath(oldPath: string, newPath: string): boolean {
    const value = this.settings.todaysWordCount[oldPath];
    if (!value) return false;
    delete this.settings.todaysWordCount[oldPath];
    this.settings.todaysWordCount[newPath] = value;
    return true;
  }

  private matchesPath(candidate: string, target: string, isFolder: boolean): boolean {
    return candidate === target || (isFolder && candidate.startsWith(`${target}/`));
  }

  private syncSettingsFromModel(): void {
    const todaysWordCount: Record<string, WordCount> = {};

    for (const [path, row] of this.model.noteRows) {
      todaysWordCount[path] = {
        initial: row.initialCount,
        current: row.currentCount,
      };
    }

    this.settings.todaysWordCount = todaysWordCount;
    this.settings.pomoCounts = { ...this.model.pomoByDate };
    this.model.dates = this.sortDates(this.model.dates);
    this.refreshDayCountsFromLiveState(false);
  }

  private refreshDayCountsFromLiveState(includeToday = true): void {
    const today = window.moment().format("YYYY-MM-DD");
    const dates = this.sortDates([
      ...this.model.dates,
      ...Object.keys(this.model.brokenLinksByDate),
      ...Object.keys(this.model.pomoByDate),
      ...(includeToday ? [today] : []),
    ]);
    const dayCounts: Record<string, number> = {};

    for (const date of dates) {
      let total = this.model.brokenLinksByDate[date] ?? 0;
      if (date === today) {
        for (const count of Object.values(this.settings.todaysWordCount)) {
          total += count.current - count.initial;
        }
      } else {
        for (const row of this.model.noteRows.values()) {
          total += row.countsByDate[date] ?? 0;
        }
      }
      dayCounts[date] = total;
    }

    this.model.dates = dates;
    this.settings.dayCounts = dayCounts;
  }

  private parseTable(content: string): TableModel {
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|"));
    if (lines.length < 3) {
      throw new Error("stats.md does not contain a complete statistics table");
    }

    const headerCells = this.parseTableCells(lines[0]);
    if (headerCells.length < 4 || headerCells[0].toLowerCase() !== "note") {
      throw new Error("stats.md has an invalid statistics table header");
    }

    const dates = headerCells.slice(3);
    if (dates.some((date) => !DATE_COLUMN_PATTERN.test(date))) {
      throw new Error("stats.md contains an invalid date column");
    }
    const model: TableModel = {
      dates,
      pomoByDate: Object.fromEntries(dates.map((date) => [date, 0])),
      brokenLinksByDate: {},
      noteRows: new Map(),
    };

    for (let index = 2; index < lines.length; index++) {
      const cells = this.parseTableCells(lines[index]);
      const label = cells[0];
      if (!label) continue;

      if (label === "🍅 POMO") {
        this.readDateCells(cells, dates, model.pomoByDate);
        continue;
      }
      if (label === BROKEN_LINKS_DISPLAY || label === BROKEN_LINKS_KEY) {
        this.readDateCells(cells, dates, model.brokenLinksByDate);
        continue;
      }

      const path = this.getPathFromNoteLink(label);
      if (!path) continue;
      const row: NoteTableRow = {
        path,
        noteLink: label,
        countsByDate: {},
        initialCount: this.readNumber(cells[1]),
        currentCount: this.readNumber(cells[2]),
      };
      this.readDateCells(cells, dates, row.countsByDate);
      model.noteRows.set(path, row);
    }
    return model;
  }

  private readDateCells(
    cells: string[],
    dates: string[],
    target: Record<string, number>
  ): void {
    dates.forEach((date, index) => {
      target[date] = this.readNumber(cells[index + 3]);
    });
  }

  private readNumber(value: string | undefined): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  private parseTableCells(line: string): string[] {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  private getPathFromNoteLink(noteLink: string): string {
    let path = noteLink;
    if (path.startsWith("[[") && path.endsWith("]]")) {
      path = path.slice(2, -2);
    }
    path = path.split("|")[0].split("#")[0].trim();
    return normalizePathForStorage(path);
  }

  private serializeModel(): string {
    const today = window.moment().format("YYYY-MM-DD");
    const dates = this.sortDates([
      ...this.model.dates,
      ...Object.keys(this.model.pomoByDate),
      ...Object.keys(this.model.brokenLinksByDate),
      today,
    ]);
    this.model.dates = dates;

    const headers = ["Note", "Initial", "Current", ...dates];
    const rows = [
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      `| ${["🍅 POMO", "", "", ...dates.map((date) => String(this.model.pomoByDate[date] ?? 0))].join(" | ")} |`,
      `| ${[BROKEN_LINKS_DISPLAY, "", "", ...dates.map((date) => String(this.model.brokenLinksByDate[date] ?? 0))].join(" | ")} |`,
    ];

    for (const row of this.model.noteRows.values()) {
      rows.push(`| ${[
        row.noteLink,
        String(row.initialCount),
        String(row.currentCount),
        ...dates.map((date) => String(row.countsByDate[date] ?? 0)),
      ].join(" | ")} |`);
    }

    return [
      "# Work Assistant Stats",
      "",
      "> This file is managed by Work Assistant. Edit with care.",
      "",
      rows.join("\n"),
      "",
    ].join("\n");
  }

  private sortDates(dates: string[]): string[] {
    const today = window.moment().format("YYYY-MM-DD");
    const sorted = [...new Set(dates)]
      .filter((date) => DATE_COLUMN_PATTERN.test(date))
      .sort((a, b) => b.localeCompare(a));
    return sorted.includes(today)
      ? [today, ...sorted.filter((date) => date !== today)]
      : sorted;
  }

  private sameArray(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  private resolveFile(path: string): TFile | null {
    const withExtension = path.endsWith(".md") ? path : `${path}.md`;
    const vault = this.app.vault as App["vault"] & {
      getFileByPath?: (candidate: string) => TFile | null;
    };
    const file = typeof vault.getFileByPath === "function"
      ? vault.getFileByPath(withExtension)
      : vault.getAbstractFileByPath(withExtension) ?? vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private async writeContent(content: string): Promise<void> {
    const path = this.getStatsMdPath();
    await this.ensureParentDirectory(path);
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile && typeof this.app.vault.process === "function") {
      await this.app.vault.process(existing, () => content);
      return;
    }

    const exists = await this.app.vault.adapter.exists(path);
    if (!exists && typeof this.app.vault.create === "function") {
      await this.app.vault.create(path, content);
      return;
    }
    await this.app.vault.adapter.write(path, content);
  }

  private async ensureParentDirectory(path: string): Promise<void> {
    const segments = path.split("/").filter(Boolean);
    let currentPath = "";
    for (let index = 0; index < segments.length - 1; index++) {
      currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];
      if (!(await this.app.vault.adapter.exists(currentPath))) {
        await this.app.vault.adapter.mkdir(currentPath);
      }
    }
  }
}
