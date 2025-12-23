import memoize from "lodash/memoize";
import sortBy from "lodash/sortBy";
import type { Moment } from "moment";
import {
  Component,
  parseFrontMatterEntry,
  TFile,
  TFolder,
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
import { granularities, type Granularity } from "./types";
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

  constructor(readonly app: App, readonly plugin: PeriodicNotesPlugin) {
    super();
    this.cachedFiles = new Map();

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

  public reset(): void {
    console.info("[Work Assistant] reseting cache");
    this.cachedFiles.clear();
    this.initialize();
  }

  public initialize(): void {
    const memoizedRecurseChildren = memoize(
      (rootFolder: TFolder, cb: (file: TAbstractFile) => void) => {
        if (!rootFolder) return;
        for (const c of rootFolder.children) {
          if (c instanceof TFile) {
            cb(c);
          } else if (c instanceof TFolder) {
            memoizedRecurseChildren(c, cb);
          }
        }
      }
    );

    const activeGranularities = granularities.filter((g) => this.plugin.options[g]?.enabled);
    for (const granularity of activeGranularities) {
      const config = this.plugin.options[granularity];
      const folderPath = config.folder || "/";
      const rootFolder = this.app.vault.getAbstractFileByPath(folderPath) as TFolder;
      console.debug(`[Work Assistant] Initializing cache for ${granularity}, folder: ${folderPath}, exists: ${!!rootFolder}`);

      // Scan for filename matches
      memoizedRecurseChildren(rootFolder, (file: TAbstractFile) => {
        if (file instanceof TFile) {
          this.resolve(file, "initialize");
          const metadata = this.app.metadataCache.getFileCache(file);
          if (metadata) {
            this.resolveChangedMetadata(file, "", metadata);
          }
        }
      });
    }
  }

  private resolveChangedMetadata(
    file: TFile,
    _data: string,
    cache: CachedMetadata
  ): void {
    const activeGranularities = granularities.filter((g) => this.plugin.options[g]?.enabled);
    if (activeGranularities.length === 0) return;

    for (const granularity of activeGranularities) {
      const config = this.plugin.options[granularity];
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
          this.cachedFiles.set(file.path, {
            filePath: file.path,
            date,
            granularity,
            canonicalDateStr: getCanonicalDateString(granularity, date),
            matchData: {
              exact: true,
              matchType: "frontmatter",
            },
          });
        }
        return;
      }
    }
  }

  private resolveRename(file: TAbstractFile, oldPath: string): void {
    if (file instanceof TFile) {
      this.cachedFiles.delete(oldPath);
      this.resolve(file, "rename");
    }
  }

  private resolve(
    file: TFile,
    reason: "create" | "rename" | "initialize" = "create"
  ): void {
    const activeGranularities = granularities.filter((g) => this.plugin.options[g].enabled);
    if (activeGranularities.length === 0) return;

    // 'frontmatter' entries should supercede 'filename'
    const existingEntry = this.cachedFiles.get(file.path);
    if (existingEntry && existingEntry.matchData.matchType === "frontmatter") {
      return;
    }

    for (const granularity of activeGranularities) {
      const config = this.plugin.options[granularity];
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

      if (date.isValid()) {
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
        console.debug(`[Calendar] Resolved ${granularity} note: ${file.path} (date: ${metadata.canonicalDateStr})`);

        if (reason === "create" && file.stat.size === 0) {
          applyPeriodicTemplateToFile(this.app, file, this.plugin.options, metadata);
        }

        this.app.workspace.trigger("periodic-notes:resolve", granularity, file);
        return;
      }
    }

    const nonStrictDate = getLooselyMatchedDate(file.basename);
    if (nonStrictDate) {
      this.cachedFiles.set(file.path, {
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
      });

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

    for (const [filePath, cacheData] of this.cachedFiles) {
      if (
        cacheData.granularity === granularity &&
        cacheData.matchData.exact === true &&
        cacheData.date.isSame(date, granularity)
      ) {
        return this.app.vault.getAbstractFileByPath(filePath) as TFile;
      }
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
    const matches: PeriodicNoteCachedMetadata[] = [];
    for (const [, cacheData] of this.cachedFiles) {
      if (
        (granularity === cacheData.granularity ||
          (includeFinerGranularities &&
            compareGranularity(cacheData.granularity, granularity) <= 0)) &&
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
