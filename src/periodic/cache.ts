// import memoize from "lodash/memoize";
import sortBy from "lodash/sortBy";
import type { Moment } from "moment";
import {
  Component,
  parseFrontMatterEntry,
  TFile,
} from "obsidian";
import type {
  App,
  TAbstractFile,
  CachedMetadata,
} from "obsidian";

import { DEFAULT_FORMAT } from "./constants";
import type PeriodicNotesPlugin from "../main";
import { getLooselyMatchedDate } from "./parser";
import { getDateInput } from "./settings/validation";
import { granularities, type Granularity, type PeriodicNotesConfig } from "./types";
import { applyPeriodicTemplateToFile, getPossibleFormats } from "./utils";

export type MatchType = "filename" | "frontmatter" | "date-prefixed";

export interface PeriodicNoteMatchMatchData {
  /* where was the date found */
  matchType: MatchType;
  /* XXX: keep ZK matches in the cache, should this be separate from formats with HH:mm in them? */
  /* just collect this for now, not 100% sure how it will be used. */
  exact: boolean;
  // other ideas of match data:
  // - filename without date (unparsed tokens)
  // - time?: string
}

function compareGranularity(a: Granularity, b: Granularity) {
  const idxA = granularities.indexOf(a);
  const idxB = granularities.indexOf(b);
  if (idxA === idxB) return 0;
  if (idxA < idxB) return -1;
  return 1;
}

export interface PeriodicNoteCachedMetadata {
  filePath: string;
  date: Moment;
  granularity: Granularity;
  canonicalDateStr: string;

  /* "how" the match was made */
  matchData: PeriodicNoteMatchMatchData;
}

function getCanonicalDateString(_granularity: Granularity, date: Moment): string {
  return date.toISOString();
}

export class PeriodicNotesCache extends Component {
  // Map the full filename to metadata
  public cachedFiles: Map<string, PeriodicNoteCachedMetadata>;
  // Map granularity-timestamp to metadata for O(1) lookup
  private dateIndex: Map<string, PeriodicNoteCachedMetadata>;
  private deferredTimer: number | null = null;
  private unloaded = false;

  constructor(readonly app: App, readonly plugin: PeriodicNotesPlugin) {
    super();
    this.cachedFiles = new Map();
    this.dateIndex = new Map();
    this.unloaded = false;

    this.app.workspace.onLayoutReady(() => {
      console.info("[Work Assistant] initializing cache");
      this.initialize();
      this.registerEvent(this.app.vault.on("create", this.resolve, this));
      this.registerEvent(this.app.vault.on("rename", this.resolveRename, this));
      this.registerEvent(
        this.app.metadataCache.on("changed", this.resolveChangedMetadata, this)
      );
      this.registerEvent(
        this.app.workspace.on("periodic-notes:settings-updated", this.reset, this)
      );
    });
  }

  public onunload(): void {
    this.unloaded = true;
    if (this.deferredTimer) {
      window.clearTimeout(this.deferredTimer);
      this.deferredTimer = null;
    }
    this.cachedFiles.clear();
    this.dateIndex.clear();
  }

  public reset(): void {
    console.info("[Work Assistant] reseting cache");
    this.cachedFiles.clear();
    this.dateIndex.clear();
    this.initialize();
  }

  private getIndexKey(granularity: Granularity, date: Moment): string {
    return `${granularity}-${date.clone().startOf(granularity).valueOf()}`;
  }

  public initialize(lazy = true): void {
    if (lazy) {
      this.fastScan();
      // Defer full scan
      if (this.deferredTimer) window.clearTimeout(this.deferredTimer);
      this.deferredTimer = window.setTimeout(() => {
        if (this.unloaded) return;
        console.info("[Work Assistant] Starting deferred full cache scan");
        this.fullScan();
        this.deferredTimer = null;
      }, 2000);
    } else {
      this.fullScan();
    }
  }

  private fastScan(): void {
    const today = window.moment();
    const currentMonth = today.format("YYYY-MM");

    // We want to prioritize files that look like they belong to this month or nearby
    const priorityFiles = this.app.vault.getMarkdownFiles().filter(file => {
      // Very basic filter: does path contain current year/month?
      // This is efficient and catches "2023-10-01.md" or "2023/10/01.md"
      return file.path.includes(currentMonth);
    });

    console.debug(`[Work Assistant] Fast Scanning ${priorityFiles.length} priority files`);
    this.scanFiles(priorityFiles);
  }

  private fullScan(): void {
    // Scan all markdown files, but filter by configured folders inside scanFiles logic
    const allFiles = this.app.vault.getMarkdownFiles();
    console.debug(`[Work Assistant] Full Scanning ${allFiles.length} files`);
    // Use async scan for full scan to prevent UI freeze
    this.scanFilesAsync(allFiles);
  }

  private scanFiles(files: TFile[]): void {
    // Legacy synchronous scan for small batches (like fastScan)
    this.processFileBatch(files);
  }

  private async scanFilesAsync(files: TFile[]): Promise<void> {
    const CHUNK_SIZE = 200;

    // Process in chunks
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      this.processFileBatch(chunk);

      // Yield to event loop
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  private processFileBatch(files: TFile[]): void {
    const activeGranularities = granularities.filter((g) => (this.plugin.options.periodicNotes as PeriodicNotesConfig)[g]?.enabled);
    if (!activeGranularities.length) return;

    // Optimization: Pre-calculate folder paths to avoid repeating logic inside the loop
    const configFolders: Record<string, string> = {};
    for (const granularity of activeGranularities) {
      const config = (this.plugin.options.periodicNotes as PeriodicNotesConfig)[granularity];
      let folder = config.folder || "";
      if (folder === "/") folder = "";
      if (folder.startsWith("/")) folder = folder.slice(1);
      configFolders[granularity] = folder;
    }

    for (const file of files) {
      // Skip if already cached with high confidence (frontmatter)
      const existing = this.cachedFiles.get(file.path);
      if (existing && existing.matchData.matchType === "frontmatter") continue;

      let isInWatchedFolder = false;
      for (const granularity of activeGranularities) {
        const folder = configFolders[granularity];
        if (!folder || file.path.startsWith(folder)) {
          isInWatchedFolder = true;
          break;
        }
      }

      if (isInWatchedFolder) {
        this.resolve(file, "initialize");
        const metadata = this.app.metadataCache.getFileCache(file);
        if (metadata) {
          this.resolveChangedMetadata(file, "", metadata);
        }
      }
    }
  }

  private resolveChangedMetadata(
    file: TFile,
    _data: string,
    cache: CachedMetadata
  ): void {
    const activeGranularities = granularities.filter((g) => (this.plugin.options.periodicNotes as PeriodicNotesConfig)[g]?.enabled);
    if (activeGranularities.length === 0) return;

    for (const granularity of activeGranularities) {
      const config = (this.plugin.options.periodicNotes as PeriodicNotesConfig)[granularity];
      const folder = config.folder || "";
      if (!file.path.startsWith(folder)) continue;

      const frontmatterEntry = parseFrontMatterEntry(cache.frontmatter, granularity);
      if (!frontmatterEntry) continue;

      const format = DEFAULT_FORMAT[granularity];
      let date: Moment;
      if (typeof frontmatterEntry === "string") {
        // e.g. `day: 2022-02-02`
        date = window.moment(frontmatterEntry, format, true);
        if (date.isValid()) {
          const meta: PeriodicNoteCachedMetadata = {
            filePath: file.path,
            date,
            granularity,
            canonicalDateStr: getCanonicalDateString(granularity, date),
            matchData: {
              exact: true,
              matchType: "frontmatter",
            },
          };
          this.cachedFiles.set(file.path, meta);
          this.dateIndex.set(this.getIndexKey(granularity, date), meta);
        }
        return;
      }
    }
  }

  private resolveRename(file: TAbstractFile, oldPath: string): void {
    if (file instanceof TFile) {
      const existing = this.cachedFiles.get(oldPath);
      if (existing) {
        this.dateIndex.delete(this.getIndexKey(existing.granularity, existing.date));
      }
      this.cachedFiles.delete(oldPath);
      this.resolve(file, "rename");
    }
  }

  private resolve(
    file: TFile,
    reason: "create" | "rename" | "initialize" = "create"
  ): void {
    const activeGranularities = granularities.filter((g) => (this.plugin.options.periodicNotes as PeriodicNotesConfig)[g]?.enabled);
    if (activeGranularities.length === 0) return;

    // 'frontmatter' entries should supercede 'filename'
    const existingEntry = this.cachedFiles.get(file.path);
    if (existingEntry && existingEntry.matchData.matchType === "frontmatter") {
      return;
    }

    for (const granularity of activeGranularities) {
      const config = (this.plugin.options.periodicNotes as PeriodicNotesConfig)[granularity];
      const folder = config.folder || "";
      if (!file.path.startsWith(folder)) continue;

      // Use a helper to get formats? Or just assume we need to replicate getPossibleFormats logic
      // Since Utils may still depend on calendarSet, we might need to update that too.
      // But for now, let's assume we can implement simple format usage.
      // Actually, getPossibleFormats takes settings. 
      // We'll update getPossibleFormats later. For now, let's assume valid config.
      const formats = getPossibleFormats(this.plugin.options, granularity);
      const dateInputStr = getDateInput(file, formats[0], granularity);
      const date = window.moment(dateInputStr, formats, true);

      const metadata = {
        filePath: file.path,
        date,
        granularity,
        canonicalDateStr: getCanonicalDateString(granularity, date),
        matchData: {
          exact: true,
          matchType: "filename",
        },
      } as PeriodicNoteCachedMetadata;
      this.cachedFiles.set(file.path, metadata);
      this.dateIndex.set(this.getIndexKey(granularity, date), metadata);
      console.debug(`[Calendar] Resolved ${granularity} note: ${file.path} (date: ${metadata.canonicalDateStr})`);

      if (reason === "create" && file.stat.size === 0) {
        applyPeriodicTemplateToFile(this.app, file, this.plugin.options, metadata);
      }

      this.app.workspace.trigger("periodic-notes:resolve", granularity, file);
      return;
    }


    const nonStrictDate = getLooselyMatchedDate(file.basename);
    if (nonStrictDate) {
      const meta: PeriodicNoteCachedMetadata = {
        filePath: file.path,
        date: nonStrictDate.date,
        granularity: nonStrictDate.granularity,
        canonicalDateStr: getCanonicalDateString(
          nonStrictDate.granularity,
          nonStrictDate.date
        ),
        matchData: {
          exact: false,
          matchType: "filename",
        },
      };
      this.cachedFiles.set(file.path, meta);
      this.dateIndex.set(
        this.getIndexKey(nonStrictDate.granularity, nonStrictDate.date),
        meta
      );

      this.app.workspace.trigger(
        "periodic-notes:resolve",
        nonStrictDate.granularity,
        file
      );
    }
  }

  /**
   *
   * Get a periodic note from the cache
   *
   * @param granularityOrSetId
   * @param dateOrGranularity
   * @param targetDate
   */
  public getPeriodicNote(
    granularityOrSetId: string | Granularity,
    dateOrGranularity: Moment | Granularity,
    targetDate?: Moment
  ): TFile | null {
    let granularity: Granularity;
    let date: Moment;

    if (targetDate) {
      // 3 arguments version: (calendarSetId, granularity, targetDate)
      granularity = dateOrGranularity as Granularity;
      date = targetDate;
    } else {
      // 2 arguments version: (granularity, targetDate)
      granularity = granularityOrSetId as Granularity;
      date = dateOrGranularity as Moment;
    }

    const cacheData = this.dateIndex.get(this.getIndexKey(granularity, date));
    if (cacheData && cacheData.matchData.exact === true) {
      return this.app.vault.getAbstractFileByPath(cacheData.filePath) as TFile;
    }

    return null;
  }

  /**
   *
   * Get all periodic notes from the cache
   *
   * @param granularity
   * @param targetDate
   * @param includeFinerGranularities?
   */
  public getPeriodicNotes(
    granularity: Granularity,
    targetDate: Moment,
    includeFinerGranularities = false
  ): PeriodicNoteCachedMetadata[] {
    if (!includeFinerGranularities) {
      const match = this.dateIndex.get(this.getIndexKey(granularity, targetDate));
      return match ? [match] : [];
    }

    // Still need to iterate for finer granularities, but we can filter by date first to reduce the set?
    // Actually, compareGranularity is used. For now, we'll keep the loop for 'includeFinerGranularities' 
    // but optimize the common single-granularity case.
    const matches: PeriodicNoteCachedMetadata[] = [];
    for (const [, cacheData] of this.dateIndex) {
      if (
        includeFinerGranularities &&
        compareGranularity(cacheData.granularity, granularity) <= 0 &&
        cacheData.date.isSame(targetDate, granularity)
      ) {
        matches.push(cacheData);
      }
    }

    return matches;
  }

  public isPeriodic(targetPath: string, granularity?: Granularity): boolean {
    const metadata = this.cachedFiles.get(targetPath);
    if (!metadata) return false;

    if (!granularity) return true;
    if (granularity && granularity === metadata.granularity) {
      return true;
    }
    return false;
  }

  public find(
    filePath: string | undefined
  ): PeriodicNoteCachedMetadata | null {
    if (!filePath) return null;
    return this.cachedFiles.get(filePath) ?? null;
  }

  public findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards"
  ): PeriodicNoteCachedMetadata | null {
    const currMetadata = this.find(filePath);
    if (!currMetadata) return null;

    const granularity = currMetadata.granularity;
    const cache = Array.from(this.cachedFiles.values());

    const sortedCache = sortBy(
      cache.filter((m) => m.granularity === granularity),
      ["canonicalDateStr"]
    );
    const activeNoteIndex = sortedCache.findIndex((m) => m.filePath === filePath);

    const offset = direction === "forwards" ? 1 : -1;
    return sortedCache[activeNoteIndex + offset];
  }
}
