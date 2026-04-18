import { TFile } from "obsidian";
import type { App, TAbstractFile } from "obsidian";

interface WordCount {
  initial: number;    // 文件当天首次记录时的字数（基准）
  current: number;    // 文件当前的字数
}

export interface WordCountSnapshot {
  settings: DailyStatsSettings;
  todaysAggregate: TodaysWordCountAggregate;
}

export interface TodaysWordCountStat {
  displayDelta: number;
  // 移除lastAcceptedCount字段
}

export interface TodaysWordCountAggregate {
  total: number;
  byFile: Record<string, TodaysWordCountStat>;
}

interface NoteTableRow {
  rowId: string;
  noteLink: string;
  countsByDate: Record<string, number>;
  lastModified: number;
  initialCount?: number;   // 基准字数
  currentCount?: number;   // 当前字数
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

export const DEFAULT_DAILY_STATS_SETTINGS = DEFAULT_SETTINGS;

const DATE_COLUMN_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class StatsMdStore {
  private readonly app: App;
  private readonly getStatsMdPath: () => string;
  private filePathToRowId = new Map<string, string>();
  private fileLastModified = new Map<string, number>();
  // 添加settings属性
  public settings: DailyStatsSettings;
  // 添加renameHandlerRef属性
  private renameHandlerRef: ((file: TAbstractFile, oldPath: string) => void) | null = null;

  constructor(app: App, getStatsMdPath: () => string) {
    this.app = app;
    this.getStatsMdPath = getStatsMdPath;
    this.settings = Object.assign({}, DEFAULT_DAILY_STATS_SETTINGS);
    this.renameHandlerRef = this.handleRename;
    this.app.vault.on("rename", this.renameHandlerRef);
  }

  // 添加getPath方法
  private getPath(): string {
    return this.getStatsMdPath();
  }

  // 添加清理方法
  cleanup(): void {
    if (this.renameHandlerRef) {
      this.app.vault.off("rename", this.renameHandlerRef);
      this.renameHandlerRef = null;
    }
    this.filePathToRowId.clear();
    this.fileLastModified.clear();
  }

  // 添加一个方法来获取文件的最后修改时间
  private getFileLastModified(filePath: string): number {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file && file instanceof TFile) {
      return file.stat.mtime; // 返回文件的实际修改时间
    }
    return Date.now(); // 默认使用当前时间
  }

  async load(): Promise<WordCountSnapshot> {
    const statsPath = this.getPath();

    if (!(await this.app.vault.adapter.exists(statsPath))) {
      await this.ensureParentDirectory(statsPath);
      await this.app.vault.adapter.write(statsPath, this.buildTemplate(DEFAULT_SETTINGS).content);
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
    const { content: nextContent, model: nextModel } = this.buildTemplate(settings, existingContent);
    await this.app.vault.adapter.write(statsPath, nextContent);
    // Reuse the model returned by buildTemplate instead of re-parsing
    return this.buildSnapshot(this.normalizeParsedModel(nextModel));
  }

  private normalizeParsedModel(model: TableModel): DailyStatsSettings {
    this.filePathToRowId.clear();
    this.fileLastModified.clear();

    const dayCounts: Record<string, number> = {};
    model.dates.forEach((date) => {
      let total = 0;
      model.noteRows.forEach((row) => {
        const raw = row.countsByDate[date] ?? 0;
        total += raw;
      });
      dayCounts[date] = total;
    });

    const todaysWordCount: Record<string, WordCount> = {};
    model.noteRows.forEach((row) => {
      const file = this.resolveNoteLink(row.noteLink);
      if (!file) return;

      const initial = row.initialCount ?? 0;
      const current = row.currentCount ?? 0;
      const normalizedPath = this.normalizePathForStorage(file.path);

      todaysWordCount[normalizedPath] = {
        initial: initial,
        current: current,
      };
      this.filePathToRowId.set(normalizedPath, row.rowId);
      this.fileLastModified.set(normalizedPath, row.lastModified || Date.now());
    });

    return {
      dayCounts,
      todaysWordCount,
      pomoCounts: model.pomoByDate,
    };
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
      // 计算当天的净变化量
      // 允许负数显示（用户删除内容时），以提供完整的统计信息
      const netChange = wordCount.current - wordCount.initial;
      byFile[filePath] = {
        displayDelta: netChange,  // 显示实际的增/减量，不做下限限制
      };
      total += netChange;
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
    this.filePathToRowId.clear();
    this.fileLastModified.clear();

    const dayCounts: Record<string, number> = {};
    model.dates.forEach((date) => {
      let total = 0;
      model.noteRows.forEach((row) => {
        const raw = row.countsByDate[date] ?? 0;
        total += raw;
      });
      dayCounts[date] = total;
    });

    const todaysWordCount: Record<string, WordCount> = {};
    model.noteRows.forEach((row) => {
      const file = this.resolveNoteLink(row.noteLink);
      if (!file) return;

      // 从解析的表格数据中获取initial和current值
      const initial = row.initialCount ?? 0;
      const current = row.currentCount ?? 0;
      const normalizedPath = this.normalizePathForStorage(file.path);

      todaysWordCount[normalizedPath] = {
        initial: initial,
        current: current,
      };
      this.filePathToRowId.set(normalizedPath, row.rowId);
      this.fileLastModified.set(normalizedPath, row.lastModified || Date.now());
    });

    return {
      dayCounts,
      todaysWordCount,
      pomoCounts: model.pomoByDate,
    };
  }

  private buildTemplate(settings: DailyStatsSettings, existingContent = ""): { content: string; model: TableModel } {
    // 更新实例的settings以供buildMainTable使用
    this.settings = settings;
    this.filePathToRowId.clear();
    this.fileLastModified.clear();

    const existingModel = this.parseTable(existingContent);
    const today = window.moment().format("YYYY-MM-DD");
    const isFirstWriteForToday = !existingModel.dates.includes(today);

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
        const normalizedPath = this.normalizePathForStorage(file.path);
        rowByPath.set(normalizedPath, normalized);
        this.filePathToRowId.set(normalizedPath, normalized.rowId);
      }
    });

    if (isFirstWriteForToday) {
      rowById.forEach((row) => {
        // Reset runtime baseline on day boundary so old initial/current do not leak.
        row.initialCount = 0;
        row.currentCount = 0;
        row.countsByDate[today] = 0;
      });
    }

    // apply current-day values from runtime settings
    Object.entries(settings.todaysWordCount ?? {}).forEach(([filePath, wordCount]) => {
      const target = this.app.vault.getAbstractFileByPath(filePath);
      if (!(target instanceof TFile)) {
        return;
      }

      const normalizedPath = this.normalizePathForStorage(target.path);
      const knownRowId = this.filePathToRowId.get(normalizedPath);
      let row = (knownRowId ? rowById.get(knownRowId) : undefined) ?? rowByPath.get(normalizedPath);

      if (!row) {
        // 新行：设置 Initial 和 Current 都为当前字数
        row = {
          rowId: this.createRowId(normalizedPath),
          noteLink: this.toNoteLink(target),
          countsByDate: {},
          lastModified: this.getFileLastModified(target.path),
          initialCount: wordCount.initial,
          currentCount: wordCount.current,
        };
      } else {
        // 既有行：保留旧的 Initial（历史数据），只更新 Current
        // ✅ 关键修复：不覆盖 initialCount，只更新 currentCount
        row.initialCount = row.initialCount ?? wordCount.initial;
        row.currentCount = wordCount.current;
        row.lastModified = this.getFileLastModified(target.path);
      }

      row.noteLink = this.toNoteLink(target);
      // 计算当天的净增量（基于 initial/current 的差）
      const netChange = wordCount.current - wordCount.initial;
      row.countsByDate[today] = netChange;
      rowById.set(row.rowId, row);
      rowByPath.set(normalizedPath, row);
      this.filePathToRowId.set(normalizedPath, row.rowId);
    });

    const noteRows = this.dedupeRows([...rowById.values()]);

    const pomoByDate: Record<string, number> = {};
    dates.forEach((date) => {
      pomoByDate[date] = settings.pomoCounts?.[date] ?? existingModel.pomoByDate[date] ?? 0;
    });

    const table = this.buildMainTable(dates, noteRows, pomoByDate, today);

    const content = [
      "# Work Assistant Stats",
      "",
      "> This file is managed by Work Assistant. Edit with care.",
      "",
      table,
      ""
    ].join("\n");

    // Build the model to return without re-parsing the content
    const model: TableModel = {
      dates,
      pomoByDate,
      noteRows,
    };

    return { content, model };
  }

  private buildMainTable(
    dates: string[],
    noteRows: NoteTableRow[],
    pomoByDate: Record<string, number>,
    today: string
  ): string {
    if (dates.length === 0) return "";

    // Build header including Initial and Current columns
    const headers = ["Note", "Initial", "Current", ...dates];
    const headerRow = `| ${headers.join(" | ")} |`;
    const separatorRow = `| ${headers.map(() => "---").join(" | ")} |`;

    const rows: string[] = [];

    // Add POMO row
    const pomoCells = ["🍅 POMO", "", "", ...dates.map((date) => String(pomoByDate[date] ?? 0))];
    rows.push(`| ${pomoCells.join(" | ")} |`);

    // Add note rows
    for (const row of noteRows) {
      const file = this.resolveNoteLink(row.noteLink);
      let initial = row.initialCount ?? 0;
      let current = row.currentCount ?? 0;

      
      if (file) {
        const normalizedPath = this.normalizePathForStorage(file.path);
        const wordCount = this.settings.todaysWordCount?.[normalizedPath];
        if (wordCount) {
          initial = wordCount.initial;
          current = wordCount.current;
        }
      }

      const noteCells = [
        row.noteLink,
        String(initial),
        String(current),
        ...dates.map((date) => {
          // 对于当前日期，显示净变化（允许负数）；对于历史日期，显示存储的值
          if (date === today) {
            const normalizedPath = file ? this.normalizePathForStorage(file.path) : null;
            if (!file || !this.settings.todaysWordCount?.[normalizedPath]) {
              return "0";
            }
            // ✅ 修复：当天增量 = current - initial（不再使用 Math.max）
            return String(current - initial);
          } else {
            return String(row.countsByDate[date] ?? 0);
          }
        }),
      ];
      rows.push(`| ${noteCells.join(" | ")} |`);
    }

    return [headerRow, separatorRow, ...rows].join("\n");
  }

  private handleRename = (file: TAbstractFile, oldPath: string): void => {
    if (!(file instanceof TFile)) return;

    const normalizedOldPath = this.normalizePathForStorage(oldPath);
    const normalizedNewPath = this.normalizePathForStorage(file.path);
    const rowId = this.filePathToRowId.get(normalizedOldPath);
    if (!rowId) return;

    this.filePathToRowId.delete(normalizedOldPath);
    this.filePathToRowId.set(normalizedNewPath, rowId);
  };

  private dedupeRows(rows: NoteTableRow[]): NoteTableRow[] {
    const deduped = new Map<string, {row: NoteTableRow, timestamp: number}>();

    rows.forEach((row) => {
      const file = this.resolveNoteLink(row.noteLink);
      // 使用规范化后的路径作为 key
      const normalizedPath = file ? this.normalizePathForStorage(file.path) : null;
      const key = normalizedPath ? `file:${normalizedPath}` : `link:${row.noteLink}`;

      // 获取文件的最后修改时间进行比较
      const currentTimestamp = row.lastModified || Date.now();

      const existing = deduped.get(key);
      // 按照更新时间覆盖，而不是简单的"后出现行覆盖"
      if (!existing || currentTimestamp > existing.timestamp) {
        deduped.set(key, { row, timestamp: currentTimestamp });
        if (normalizedPath) {
          this.filePathToRowId.set(normalizedPath, row.rowId);
        }
      } else {
        // 如果发现重复项，可以考虑记录日志
        console.debug(`[Work Assistant] Duplicate entry detected for key ${key}, keeping newer entry`);
      }
    });

    return [...deduped.values()].map(item => item.row);
  }

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

    // Identify date columns. Note that columns 1 and 2 are Initial and Current.
    const dates = headerCells.slice(3).filter((date) => DATE_COLUMN_PATTERN.test(date));
    if (dates.length === 0 && headerCells.length > 3) {
       // Fallback or strict check? Let's stick to finding dates after Initial/Current
    }
    
    // If no dates found after Initial/Current, maybe the table format is different (legacy?)
    // For now, assume standard format: Note | Initial | Current | Date1 | Date2 ...
    
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
        // POMO row: cells[1]=Initial(empty), cells[2]=Current(empty), cells[3]=Date1...
        dates.forEach((date, idx) => {
          const raw = Number(cells[idx + 3]);
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
        lastModified: Date.now(),
        initialCount: 0,
        currentCount: 0,
      };

      // Parse Initial and Current
      if (cells.length > 1) {
        const initialVal = Number(cells[1]);
        if (Number.isFinite(initialVal)) {
          row.initialCount = initialVal;
        }
      }
      if (cells.length > 2) {
        const currentVal = Number(cells[2]);
        if (Number.isFinite(currentVal)) {
          row.currentCount = currentVal;
        }
      }

      // Parse Dates
      dates.forEach((date, idx) => {
        const raw = Number(cells[idx + 3]);
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
    const trimmedLine = line.trim();
    const withoutOuterPipes = trimmedLine.replace(/^\|/, "").replace(/\|$/, "");

    // 保留空单元格位置，但去掉行首/行尾的分隔符，避免首列变成空字符串
    return withoutOuterPipes.split("|").map((cell) => cell.trim());
  }

  private getRowIdFromLink(link: string, index: number): string {
    const file = this.resolveNoteLink(link);
    if (file) {
      return this.normalizePathForStorage(file.path);
    }
    return `row-${index}-${link}`;
  }

  private resolveNoteLink(noteLink: string): TFile | null {
    // 提取链接中的路径部分
    let path = noteLink;
    // 安全地检查是否以 [[ 开头并以 ]] 结尾
    if (noteLink.startsWith("[[") && noteLink.endsWith("]]") && noteLink.length > 4) {
      path = noteLink.slice(2, -2);
    }

    // 尝试多种路径变体以兼容不同格式
    const pathVariants = [
      path,
      path + ".md",
      path.endsWith(".md") ? path.slice(0, -3) : path,
    ];

    for (const variant of pathVariants) {
      const file = this.app.vault.getAbstractFileByPath(variant);
      if (file instanceof TFile) {
        return file;
      }
    }
    return null;
  }

  // 统一路径格式：移除 .md 后缀，用于 Map key 和存储
  // 注意：只移除末尾的 .md，且确保它确实是扩展名而非文件名的一部分
  private normalizePathForStorage(filePath: string): string {
    if (filePath.endsWith(".md") && filePath.length > 3) {
      return filePath.slice(0, -3);
    }
    return filePath;
  }

  private toNoteLink(file: TFile): string {
    // 使用不带 .md 后缀的 Obsidian 内部链接格式，保持与 Obsidian 官方一致
    return `[[${this.normalizePathForStorage(file.path)}]]`;
  }

  private createRowId(filePath: string): string {
    // 为文件路径生成唯一ID
    return `file-${filePath}-${Date.now()}`;
  }
}
