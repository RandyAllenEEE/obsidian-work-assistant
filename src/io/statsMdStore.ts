import { TFile } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import { normalizePathForStorage, convertToOsPath } from "../utils/path";

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
const BROKEN_LINKS_KEY = "__BROKEN_LINKS__";
const BROKEN_LINKS_DISPLAY = "失效链接";

export class StatsMdStore {
  private readonly app: App;
  private readonly getStatsMdPath: () => string;
  private filePathToRowId = new Map<string, string>();
  private fileLastModified = new Map<string, number>();
  // 添加settings属性
  public settings: DailyStatsSettings;
  // 添加renameHandlerRef属性
  private renameHandlerRef: ((file: TAbstractFile, oldPath: string) => void) | null = null;
  private deleteHandlerRef: ((file: TAbstractFile) => void) | null = null;
  // 失效链接累加器：在内存中累积当天删除文件的 netChange
  private brokenLinksAccumulator: { countsByDate: Record<string, number> } = { countsByDate: {} };
  // 回调：当文件删除或外部删除检测到时，通知 WordCountStats 设置 dirty 标志
  private onAccumulatorChangedRef: (() => void) | null = null;

	constructor(app: App, getStatsMdPath: () => string) {
    this.app = app;
    this.getStatsMdPath = getStatsMdPath;
    this.settings = Object.assign({}, DEFAULT_DAILY_STATS_SETTINGS);
    this.renameHandlerRef = this.handleRename;
    this.app.vault.on("rename", this.renameHandlerRef);
    this.deleteHandlerRef = this.handleFileDelete;
    this.app.vault.on("delete", this.deleteHandlerRef);
  }

  // 添加getPath方法
  private getPath(): string {
    return this.getStatsMdPath();
  }

  // 注册回调：当累加器发生变化时通知 WordCountStats 设置 dirty 标志
  public registerAccumulatorChangedCallback(cb: () => void): void {
    this.onAccumulatorChangedRef = cb;
  }

  // 获取当天失效链接的累计计数（用于状态栏和热力图显示）
  public getTodaysBrokenLinksCount(): number {
    const today = window.moment().format("YYYY-MM-DD");
    return this.brokenLinksAccumulator.countsByDate[today] ?? 0;
  }

  // 添加清理方法
	cleanup(): void {
    if (this.renameHandlerRef) {
      this.app.vault.off("rename", this.renameHandlerRef);
      this.renameHandlerRef = null;
    }
    if (this.deleteHandlerRef) {
      this.app.vault.off("delete", this.deleteHandlerRef);
      this.deleteHandlerRef = null;
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

    const today = window.moment().format("YYYY-MM-DD");

    const dayCounts: Record<string, number> = {};
    model.dates.forEach((date) => {
      let total = 0;
      model.noteRows.forEach((row) => {
        if (row.rowId === BROKEN_LINKS_KEY) return; // broken links 行单独处理
        const raw = row.countsByDate[date] ?? 0;
        total += raw;
      });
      dayCounts[date] = total;
    });

    // 对于历史日期，broken links 行的 countsByDate 应包含在 dayCounts 中
    // 对于今天，需要处理三种情况：
    // 1. broken links 行没有今天的 countsByDate（新建行时）：累加器的值已在行中，不重复加
    // 2. broken links 行有今天的 countsByDate（已合并过）：行已有值，不再加累加器
    // 3. 只有在行没有今天的 countsByDate 时，才从累加器取值
    let rowHasToday = false;
    model.noteRows.forEach((row) => {
      if (row.rowId !== BROKEN_LINKS_KEY) return;
      model.dates.forEach((date) => {
        const raw = row.countsByDate[date] ?? 0;
        if (date === today) {
          rowHasToday = true;
        } else {
          dayCounts[date] = (dayCounts[date] ?? 0) + raw;
        }
      });
    });
    if (!rowHasToday) {
      // 行没有今天的 countsByDate，才从累加器取值
      dayCounts[today] = (dayCounts[today] ?? 0) + (this.brokenLinksAccumulator.countsByDate[today] ?? 0);
    }

    const todaysWordCount: Record<string, WordCount> = {};
    model.noteRows.forEach((row) => {
      const file = this.resolveNoteLink(row.noteLink);

      if (!file) {
        // For new rows created by buildTemplate, the noteLink may be resolvable
        // via the raw path in the link. Try to use the noteLink itself as the path.
        let path = row.noteLink;
        if (path.startsWith("[[") && path.endsWith("]]") && path.length > 4) {
          path = path.slice(2, -2);
        }
        const normalizedPath = normalizePathForStorage(path);
        if (!normalizedPath || row.rowId === BROKEN_LINKS_KEY) return;

        const initial = row.initialCount ?? 0;
        const current = row.currentCount ?? 0;

        todaysWordCount[normalizedPath] = { initial, current };
        this.filePathToRowId.set(normalizedPath, row.rowId);
        this.fileLastModified.set(normalizedPath, row.lastModified || Date.now());
        return;
      }

      const initial = row.initialCount ?? 0;
      const current = row.currentCount ?? 0;
      const normalizedPath = normalizePathForStorage(file.path);

      todaysWordCount[normalizedPath] = {
        initial: initial,
        current: current,
      };
      this.filePathToRowId.set(normalizedPath, row.rowId);
      this.fileLastModified.set(normalizedPath, row.lastModified || Date.now());
    });
    // 处理外部删除的文件：将它们的 netChange 累加到 brokenLinksAccumulator
    model.noteRows.forEach((row) => {
      if (row.rowId === BROKEN_LINKS_KEY) return; // 跳过失效链接行本身
      const file = this.resolveNoteLink(row.noteLink);
      if (file) return; // 正常文件，跳过
      // 文件不存在（外部删除），计算其 netChange
      const initial = row.initialCount ?? 0;
      const current = row.currentCount ?? 0;
      const netChange = current - initial;
      if (netChange !== 0) {
        this.brokenLinksAccumulator.countsByDate[today] =
          (this.brokenLinksAccumulator.countsByDate[today] ?? 0) + netChange;
      }
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

    const today = window.moment().format("YYYY-MM-DD");

    const dayCounts: Record<string, number> = {};
    model.dates.forEach((date) => {
      let total = 0;
      model.noteRows.forEach((row) => {
        if (row.rowId === BROKEN_LINKS_KEY) return; // broken links 行单独处理
        const raw = row.countsByDate[date] ?? 0;
        total += raw;
      });
      dayCounts[date] = total;
    });

    // 对于历史日期，broken links 行的 countsByDate 应包含在 dayCounts 中
    model.noteRows.forEach((row) => {
      if (row.rowId !== BROKEN_LINKS_KEY) return;
      model.dates.forEach((date) => {
        const raw = row.countsByDate[date] ?? 0;
        if (date !== today) {
          dayCounts[date] = (dayCounts[date] ?? 0) + raw;
        }
      });
    });

    const todaysWordCount: Record<string, WordCount> = {};
    model.noteRows.forEach((row) => {
      const file = this.resolveNoteLink(row.noteLink);

      if (!file) {
        // For new rows created by buildTemplate, the noteLink may be resolvable
        // via the raw path in the link. Try to use the noteLink itself as the path.
        let path = row.noteLink;
        if (path.startsWith("[[") && path.endsWith("]]") && path.length > 4) {
          path = path.slice(2, -2);
        }
        const normalizedPath = normalizePathForStorage(path);
        if (!normalizedPath || row.rowId === BROKEN_LINKS_KEY) return;

        const initial = row.initialCount ?? 0;
        const current = row.currentCount ?? 0;

        todaysWordCount[normalizedPath] = { initial, current };
        this.filePathToRowId.set(normalizedPath, row.rowId);
        this.fileLastModified.set(normalizedPath, row.lastModified || Date.now());
        return;
      }

      // 从解析的表格数据中获取initial和current值
      const initial = row.initialCount ?? 0;
      const current = row.currentCount ?? 0;
      const normalizedPath = normalizePathForStorage(file.path);

      todaysWordCount[normalizedPath] = {
        initial: initial,
        current: current,
      };
      this.filePathToRowId.set(normalizedPath, row.rowId);
      this.fileLastModified.set(normalizedPath, row.lastModified || Date.now());
    });

    // 处理外部删除的文件：将它们的 netChange 累加到 brokenLinksAccumulator
    // 这些是 stats.md 中存在但文件已不存在的行
    model.noteRows.forEach((row) => {
      if (row.rowId === BROKEN_LINKS_KEY) return; // 跳过失效链接行本身
      const file = this.resolveNoteLink(row.noteLink);
      if (file) return; // 正常文件，跳过
      // 文件不存在（外部删除），计算其 netChange
      const initial = row.initialCount ?? 0;
      const current = row.currentCount ?? 0;
      const netChange = current - initial;
      if (netChange !== 0) {
        this.brokenLinksAccumulator.countsByDate[today] =
          (this.brokenLinksAccumulator.countsByDate[today] ?? 0) + netChange;
      }
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
        const normalizedPath = normalizePathForStorage(file.path);
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
    // 先收集需要删除的键，避免在迭代中修改对象
    const keysToDelete: string[] = [];
    Object.entries(settings.todaysWordCount ?? {}).forEach(([filePath, wordCount]) => {
      // 使用 normalizePathForStorage 确保路径格式一致（正斜杠，无 .md 后缀）
      // Obsidian 的 getAbstractFileByPath 可以处理正斜杠格式的路径
      const filePathKey = normalizePathForStorage(filePath);
      const target = this.app.vault.getAbstractFileByPath(filePathKey);
      if (!(target instanceof TFile)) {
        // getAbstractFileByPath 找不到文件
        // 检查是否在 existingModel.noteRows 中有记录（通过 resolveNoteLink 判断）
        const existingRowId = this.filePathToRowId.get(filePathKey);
        if (existingRowId) {
          // 在 noteRows 中有记录：检查 resolveNoteLink 是否能解析
          // 如果能解析，说明文件实际存在，只是 getAbstractFileByPath 因路径编码问题找不到
          // 此时应该更新该行的数据，而不是路由到 broken links
          const rowFromId = rowById.get(existingRowId);
          const rowFromPath = rowByPath.get(filePathKey);
          const existingRow = rowFromId ?? rowFromPath;

          if (existingRow) {
            // resolveNoteLink 已经在 first loop 中成功获取文件，更新该行
            existingRow.initialCount = wordCount.initial;
            existingRow.currentCount = wordCount.current;
            existingRow.countsByDate[today] = wordCount.current - wordCount.initial;
            existingRow.lastModified = Date.now();
            // 确保 rowByPath 也有该记录
            rowByPath.set(filePathKey, existingRow);
            return;
          }

          // 真的找不到文件 → 累加到 broken links
          const netChange = wordCount.current - wordCount.initial;
          if (netChange !== 0) {
            this.brokenLinksAccumulator.countsByDate[today] =
              (this.brokenLinksAccumulator.countsByDate[today] ?? 0) + netChange;
            if (this.onAccumulatorChangedRef) {
              this.onAccumulatorChangedRef();
            }
          }
          keysToDelete.push(filePath);
          return;
        }
        // 不在 noteRows 中 → 新文件，让第二循环处理
        return;
      }

      const normalizedPath = normalizePathForStorage(target.path);
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
        // 既有行：直接使用 wordCount.initial（已包含 Shock 处理）
        // ✅ 关键修复：移除 ?? 运算符，因为 isFirstWriteForToday 时 row.initialCount 被重置为 0，需要用 wordCount.initial 覆盖
        row.initialCount = wordCount.initial;
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

    // Handle new files that getAbstractFileByPath couldn't resolve (path encoding issues)
    // Create rows for them using their path directly
    // IMPORTANT: On subsequent saves, resolveNoteLink might succeed (finding the row in existingModel)
    // but getAbstractFileByPath still fails. We must check rowById to avoid creating duplicate rows.
    Object.entries(settings.todaysWordCount ?? {}).forEach(([filePath, wordCount]) => {
      if (keysToDelete.includes(filePath)) return; // Already handled (was a known file that's now deleted)

      const filePathKey = normalizePathForStorage(filePath);

      // Check if row was already created in the loop above (first loop or previous iteration)
      const existingRowByPath = rowByPath.get(filePathKey);
      if (existingRowByPath) {
        // Update existing row's counts
        existingRowByPath.initialCount = wordCount.initial;
        existingRowByPath.currentCount = wordCount.current;
        existingRowByPath.countsByDate[today] = wordCount.current - wordCount.initial;
        existingRowByPath.lastModified = Date.now();
        return;
      }

      // Also check rowById for entries that might have been added from existingModel.noteRows
      // (when resolveNoteLink succeeded but getAbstractFileByPath failed in first loop)
      const existingRowById = rowById.get(this.filePathToRowId.get(filePathKey) ?? '');
      if (existingRowById) {
        // Update existing row's counts
        existingRowById.initialCount = wordCount.initial;
        existingRowById.currentCount = wordCount.current;
        existingRowById.countsByDate[today] = wordCount.current - wordCount.initial;
        existingRowById.lastModified = Date.now();
        // Also add to rowByPath for future lookups
        rowByPath.set(filePathKey, existingRowById);
        return;
      }

      const netChange = wordCount.current - wordCount.initial;

      // Create new row for this file using the path directly
      const row = {
        rowId: this.createRowId(filePathKey),
        noteLink: `[[${filePathKey}]]`,
        countsByDate: {},
        lastModified: Date.now(),
        initialCount: wordCount.initial,
        currentCount: wordCount.current,
      };
      row.countsByDate[today] = netChange;
      rowById.set(row.rowId, row);
      rowByPath.set(filePathKey, row);
      // Don't set filePathToRowId - these are new files not originally in stats.md
    });

    // 统一删除已不存在文件的条目，避免在迭代中修改对象
    for (const filePath of keysToDelete) {
      delete settings.todaysWordCount[filePath];
    }

    // Merge brokenLinksAccumulator into existing or new broken links row
    const existingBrokenLinksRow = rowById.get(BROKEN_LINKS_KEY);
    const todayIncrement = this.brokenLinksAccumulator.countsByDate[today] ?? 0;
    if (existingBrokenLinksRow) {
      if (todayIncrement !== 0) {
        existingBrokenLinksRow.countsByDate[today] =
          (existingBrokenLinksRow.countsByDate[today] ?? 0) + todayIncrement;
      }
      delete this.brokenLinksAccumulator.countsByDate[today];
    } else {
      // 只有在没有现有失效链接行时才创建新行
      const brokenLinksRow: NoteTableRow = {
        rowId: BROKEN_LINKS_KEY,
        noteLink: BROKEN_LINKS_KEY,
        countsByDate: { ...this.brokenLinksAccumulator.countsByDate },
        lastModified: Date.now(),
        initialCount: 0,
        currentCount: 0,
      };
      rowById.set(BROKEN_LINKS_KEY, brokenLinksRow);
    }
    // 无论是否有现有行，都清空累加器以避免下次重复累加
    this.brokenLinksAccumulator.countsByDate = {};

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

    // Add broken links row (after POMO, before other notes)
    const brokenLinksRow = noteRows.find(row => row.rowId === BROKEN_LINKS_KEY);
    if (brokenLinksRow) {
      const brokenLinksCells = [
        BROKEN_LINKS_DISPLAY,
        "",  // Initial - always empty for broken links
        "",  // Current - always empty for broken links
        ...dates.map((date) => String(brokenLinksRow.countsByDate[date] ?? 0)),
      ];
      rows.push(`| ${brokenLinksCells.join(" | ")} |`);
    }

    // Add note rows (skip broken links row)
    for (const row of noteRows) {
      if (row.rowId === BROKEN_LINKS_KEY) continue;
      const file = this.resolveNoteLink(row.noteLink);
      let initial = row.initialCount ?? 0;
      let current = row.currentCount ?? 0;

      
      if (file) {
        const normalizedPath = normalizePathForStorage(file.path);
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
            const normalizedPath = file ? normalizePathForStorage(file.path) : null;
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

    const normalizedOldPath = normalizePathForStorage(oldPath);
    const normalizedNewPath = normalizePathForStorage(file.path);
    const rowId = this.filePathToRowId.get(normalizedOldPath);
    if (!rowId) return;

    this.filePathToRowId.delete(normalizedOldPath);
    this.filePathToRowId.set(normalizedNewPath, rowId);

    const oldLastModified = this.fileLastModified.get(normalizedOldPath);
    if (oldLastModified !== undefined) {
      this.fileLastModified.delete(normalizedOldPath);
      this.fileLastModified.set(normalizedNewPath, oldLastModified);
    }

    // 更新 todaysWordCount 中对应文件的路径键，避免后续 save() 时查找失败
    const wordCountData = this.settings.todaysWordCount[normalizedOldPath];
    if (wordCountData) {
      delete this.settings.todaysWordCount[normalizedOldPath];
      this.settings.todaysWordCount[normalizedNewPath] = wordCountData;
    }
  };

  private handleFileDelete = (file: TAbstractFile): void => {
    if (!(file instanceof TFile) || file.extension !== "md") {
      return;
    }

    const normalizedPath = normalizePathForStorage(file.path);
    const fileData = this.settings.todaysWordCount[normalizedPath];
    if (!fileData) {
      return;
    }

    const today = window.moment().format("YYYY-MM-DD");
    const netChange = fileData.current - fileData.initial;

    this.brokenLinksAccumulator.countsByDate[today] =
      (this.brokenLinksAccumulator.countsByDate[today] ?? 0) + netChange;

    delete this.settings.todaysWordCount[normalizedPath];
    this.filePathToRowId.delete(normalizedPath);
    this.fileLastModified.delete(normalizedPath);

    // 通知 WordCountStats 设置 dirty 标志，以确保删除被持久化
    if (this.onAccumulatorChangedRef) {
      this.onAccumulatorChangedRef();
    }
  };

  private dedupeRows(rows: NoteTableRow[]): NoteTableRow[] {
    const deduped = new Map<string, {row: NoteTableRow, timestamp: number}>();

    rows.forEach((row) => {
      const file = this.resolveNoteLink(row.noteLink);
      // 使用规范化后的路径作为 key
      const normalizedPath = file ? normalizePathForStorage(file.path) : null;
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

      if (label === BROKEN_LINKS_DISPLAY || label === BROKEN_LINKS_KEY) {
        const row: NoteTableRow = {
          rowId: BROKEN_LINKS_KEY,
          noteLink: label === BROKEN_LINKS_DISPLAY ? BROKEN_LINKS_KEY : label,
          countsByDate: {},
          lastModified: Date.now(),
          initialCount: 0,
          currentCount: 0,
        };

        dates.forEach((date, idx) => {
          const raw = Number(cells[idx + 3]);
          if (Number.isFinite(raw)) {
            row.countsByDate[date] = raw;
          }
        });
        noteRows.push(row);
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
      return normalizePathForStorage(file.path);
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
    const osPath = convertToOsPath(path);
    const pathVariants = [
      path,
      osPath,
      path + ".md",
      osPath + ".md",
      path.endsWith(".md") ? path.slice(0, -3) : path,
      osPath.endsWith(".md") ? osPath.slice(0, -3) : osPath,
    ];

    for (const variant of pathVariants) {
      const file = this.app.vault.getAbstractFileByPath(variant);
      if (file instanceof TFile) {
        return file;
      }
    }
    return null;
  }

  private toNoteLink(file: TFile): string {
    // 使用不带 .md 后缀的 Obsidian 内部链接格式，保持与 Obsidian 官方一致
    return `[[${normalizePathForStorage(file.path)}]]`;
  }

  private createRowId(filePath: string): string {
    // 为文件路径生成唯一ID
    return `file-${filePath}-${Date.now()}`;
  }
}
