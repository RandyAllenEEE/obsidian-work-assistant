import type { Moment, unitOfTime } from "moment";
import { FileSystemAdapter, normalizePath, Notice, Platform } from "obsidian";
import type { App, TFile } from "obsidian";

import { t } from "../i18n";
import type { PeriodicNoteCachedMetadata } from "./cache";
import {
  DEFAULT_FORMAT,
  DEFAULT_PERIODIC_TEMPLATE_PATH,
  HUMANIZE_FORMAT,
} from "./constants";
import { DEFAULT_PERIODIC_CONFIG } from "./constants";
import { removeEscapedCharacters } from "./settings/validation";
import type { ISettings } from "../settings";
import { type Granularity, type PeriodicConfig } from "./types";

export interface TemplateReadOptions {
  granularity?: Granularity;
  pluginDir?: string;
  pluginId?: string;
}

export interface PeriodicPathOptions {
  extension?: boolean;
}

export interface TemplateTransformOptions {
  settings?: ISettings;
}

export function isMetaPressed(e: MouseEvent | KeyboardEvent): boolean {
  return Platform.isMacOS ? e.metaKey : e.ctrlKey;
}

function getDaysOfWeek(): string[] {
  const { moment } = window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let weekStart = (moment.localeData() as any)._week.dow;
  const daysOfWeek = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  while (weekStart) {
    const day = daysOfWeek.shift();
    if (day) daysOfWeek.push(day);
    weekStart--;
  }
  return daysOfWeek;
}

export function getDayOfWeekNumericalValue(dayOfWeekName: string): number {
  return getDaysOfWeek().indexOf(dayOfWeekName.toLowerCase());
}

function normalizeTemplateUnit(unit: string): string | null {
  switch (unit) {
    case "y":
      return "year";
    case "q":
      return "quarter";
    case "M":
      return "month";
    case "w":
      return "week";
    case "d":
      return "day";
    case "h":
      return "hour";
    case "m":
      return "minute";
    case "s":
      return "second";
    default:
      return null;
  }
}

function applyTemplateOffset(date: Moment, timeDelta?: string, unit?: string): Moment | null {
  const currentDate = date.clone();
  if (!timeDelta || !unit) {
    return currentDate;
  }

  const normalizedUnit = normalizeTemplateUnit(unit);
  if (!normalizedUnit) {
    return null;
  }

  currentDate.add(parseInt(timeDelta, 10), normalizedUnit as unitOfTime.DurationConstructor);
  return currentDate;
}

function resolveTemplateDate(baseDate: Moment, selector?: string): Moment | null {
  const trimmed = selector?.trim();
  if (!trimmed) {
    return baseDate.clone();
  }

  const weekday = trimmed.toLowerCase();
  if (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].includes(weekday)) {
    return baseDate.clone().weekday(getDayOfWeekNumericalValue(weekday));
  }

  const offsetMatch = /^([+-]\d+)([yqMwdhms])$/.exec(trimmed);
  if (!offsetMatch) {
    return null;
  }

  return applyTemplateOffset(baseDate, offsetMatch[1], offsetMatch[2]);
}

function renderDate(date: Moment, fallback: string, momentFormat?: string): string {
  return momentFormat ? date.format(momentFormat.substring(1).trim()) : fallback;
}

export function resolvePeriodicNotePath(
  settings: ISettings,
  granularity: Granularity,
  date: Moment,
  options: PeriodicPathOptions = {}
): string {
  const config = getConfig(settings, granularity);
  const format = getFormat(settings, granularity);
  const directory = config.folder === "/" ? "" : config.folder ?? "";
  const filename = date.format(format);
  const filenameWithExt = options.extension && !filename.endsWith(".md")
    ? `${filename}.md`
    : filename;

  return normalizePath(join(directory, filenameWithExt));
}

export function applyTemplateTransformations(
  filename: string,
  granularity: Granularity,
  date: Moment,
  format: string,
  rawTemplateContents: string,
  options: TemplateTransformOptions = {}
): string {
  let templateContents = rawTemplateContents;

  templateContents = rawTemplateContents
    .replace(/{{\s*title\s*}}/gi, filename)
    .replace(/{{\s*time\s*(:.+?)?}}/gi, (_, momentFormat) => {
      return window.moment().format(momentFormat ? momentFormat.substring(1).trim() : "HH:mm");
    })
    .replace(
      /{{\s*date\s*(([+-]\d+)([yqMwdhms]))?\s*(:.+?)?}}/g,
      (_, calc, timeDelta, unit, momentFormat) => {
        const currentDate = date.clone().set({
          hour: window.moment().get("hour"),
          minute: window.moment().get("minute"),
          second: window.moment().get("second"),
        });
        if (calc) {
          const adjustedDate = applyTemplateOffset(currentDate, timeDelta, unit);
          if (!adjustedDate) {
            return _;
          }
          return renderDate(adjustedDate, filename, momentFormat);
        }

        return renderDate(currentDate, filename, momentFormat);
      }
    );

  if (granularity === "day") {
    templateContents = templateContents
      .replace(/{{\s*yesterday\s*}}/gi, date.clone().subtract(1, "day").format(format))
      .replace(/{{\s*tomorrow\s*}}/gi, date.clone().add(1, "d").format(format));
  }

  if (granularity === "week") {
    templateContents = templateContents.replace(
      /{{\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*:(.*?)}}/gi,
      (_, dayOfWeek, momentFormat) => {
        const day = getDayOfWeekNumericalValue(dayOfWeek);
        return date.clone().weekday(day).format(momentFormat.trim());
      }
    );
  }

  if (granularity === "month") {
    templateContents = templateContents.replace(
      /{{\s*(month)\s*(([+-]\d+)([yqMwdhms]))?\s*(:.+?)?}}/g,
      (_, _timeOrDate, calc, timeDelta, unit, momentFormat) => {
        const now = window.moment();
        const monthStart = date
          .clone()
          .startOf("month")
          .set({
            hour: now.get("hour"),
            minute: now.get("minute"),
            second: now.get("second"),
          });
        if (calc) {
          const adjustedDate = applyTemplateOffset(monthStart, timeDelta, unit);
          if (!adjustedDate) {
            return _;
          }
          return renderDate(adjustedDate, adjustedDate.format(format), momentFormat);
        }

        return renderDate(monthStart, monthStart.format(format), momentFormat);
      }
    );
  }

  if (granularity === "quarter") {
    templateContents = templateContents.replace(
      /{{\s*(quarter)\s*(([+-]\d+)([yqMwdhms]))?\s*(:.+?)?}}/g,
      (_, _timeOrDate, calc, timeDelta, unit, momentFormat) => {
        const now = window.moment();
        const monthStart = date
          .clone()
          .startOf("quarter")
          .set({
            hour: now.get("hour"),
            minute: now.get("minute"),
            second: now.get("second"),
          });
        if (calc) {
          const adjustedDate = applyTemplateOffset(monthStart, timeDelta, unit);
          if (!adjustedDate) {
            return _;
          }
          return renderDate(adjustedDate, adjustedDate.format(format), momentFormat);
        }

        return renderDate(monthStart, monthStart.format(format), momentFormat);
      }
    );
  }

  if (granularity === "year") {
    templateContents = templateContents.replace(
      /{{\s*(year)\s*(([+-]\d+)([yqMwdhms]))?\s*(:.+?)?}}/g,
      (_, _timeOrDate, calc, timeDelta, unit, momentFormat) => {
        const now = window.moment();
        const monthStart = date
          .clone()
          .startOf("year")
          .set({
            hour: now.get("hour"),
            minute: now.get("minute"),
            second: now.get("second"),
          });
        if (calc) {
          const adjustedDate = applyTemplateOffset(monthStart, timeDelta, unit);
          if (!adjustedDate) {
            return _;
          }
          return renderDate(adjustedDate, adjustedDate.format(format), momentFormat);
        }

        return renderDate(monthStart, monthStart.format(format), momentFormat);
      }
    );
  }

  templateContents = templateContents.replace(
    /{{\s*periodic\s*:\s*([^:\s}]+)(?:\s*:\s*([^}]+?))?\s*}}/gi,
    (match, targetGranularity, selector) => {
      const settings = options.settings;
      if (!settings) {
        return match;
      }

      const normalizedGranularity = String(targetGranularity).toLowerCase() as Granularity;
      if (!["day", "week", "month", "quarter", "year"].includes(normalizedGranularity)) {
        return match;
      }

      const targetDate = resolveTemplateDate(date, selector);
      if (!targetDate) {
        return match;
      }

      return resolvePeriodicNotePath(settings, normalizedGranularity, targetDate, { extension: false });
    }
  );

  return templateContents;
}

export function getFormat(settings: ISettings | PeriodicConfig, granularity?: Granularity): string {
  // If granularity provided, assume first arg is ISettings
  if (granularity && 'periodicNotes' in settings) {
    return (settings as ISettings).periodicNotes[granularity]?.format || DEFAULT_FORMAT[granularity];
  }
  // Otherwise assume it is PeriodicConfig
  const config = settings as PeriodicConfig;
  return config.format || (granularity ? DEFAULT_FORMAT[granularity] : "");
}

/**
 * When matching file formats, users can specify `YYYY/YYYY-MM-DD`. We should look for
 * paths that match either `YYYY/YYYY-MM-DD` exactly, or just `YYYY-MM-DD` in case
 * users move the file later.
 */
export function getPossibleFormats(
  settings: ISettings,
  granularity: Granularity
): string[] {
  const format = settings.periodicNotes[granularity]?.format;
  if (!format) return [DEFAULT_FORMAT[granularity]];

  const partialFormatExp = /[^/]*$/.exec(format);
  if (partialFormatExp) {
    const partialFormat = partialFormatExp[0];
    return [format, partialFormat];
  }
  return [format];
}

export function getFolder(settings: ISettings, granularity: Granularity): string {
  return settings.periodicNotes[granularity]?.folder || "/";
}

export function getConfig(
  settings: ISettings,
  granularity: Granularity
): PeriodicConfig {
  return settings.periodicNotes[granularity] ?? DEFAULT_PERIODIC_CONFIG;
}

export async function applyPeriodicTemplateToFile(
  app: App,
  file: TFile,
  settings: ISettings,
  metadata: PeriodicNoteCachedMetadata,
  templateOptions: Omit<TemplateReadOptions, "granularity"> = {}
): Promise<void> {
  const format = getFormat(settings, metadata.granularity);
  const templateContents = await getTemplateContents(
    app,
    settings.periodicNotes[metadata.granularity]?.templatePath,
    {
      ...templateOptions,
      granularity: metadata.granularity,
    }
  );
  const renderedContents = applyTemplateTransformations(
    file.basename,
    metadata.granularity,
    metadata.date,
    format,
    templateContents,
    { settings }
  );
  return app.vault.modify(file, renderedContents);
}

export async function getTemplateContents(
  app: App,
  templatePath: string | undefined,
  options: TemplateReadOptions = {}
): Promise<string> {
  const { metadataCache, vault } = app;
  const rawTemplatePath = (templatePath ?? "").trim();

  if (!rawTemplatePath) {
    return getBundledTemplateContents(app, options);
  }

  const normalizedTemplatePath = normalizePath(rawTemplatePath);
  if (normalizedTemplatePath === "/") {
    return Promise.resolve("");
  }

  try {
    const templateFile = metadataCache.getFirstLinkpathDest(normalizedTemplatePath, "");
    return templateFile ? vault.cachedRead(templateFile) : "";
  } catch (err) {
    console.error(
      `[Work Assistant] Failed to read the periodic note template '${normalizedTemplatePath}'`,
      err
    );
    new Notice(t("notice-periodic-template-read-failed"));
    return "";
  }
}

async function getBundledTemplateContents(
  app: App,
  options: TemplateReadOptions
): Promise<string> {
  if (!options.granularity) {
    return "";
  }

  const candidatePaths = getBundledTemplateCandidates(options);
  for (const candidatePath of candidatePaths) {
    const contents = await readBundledTemplateCandidate(app, candidatePath);
    if (contents !== null) {
      return contents;
    }
  }

  const expectedPath = DEFAULT_PERIODIC_TEMPLATE_PATH[options.granularity];
  console.warn(
    `[Work Assistant] Bundled periodic note template not found for '${options.granularity}' (${expectedPath})`
  );
  new Notice(t("notice-periodic-bundled-template-missing").replace("{path}", expectedPath));
  return "";
}

async function readBundledTemplateCandidate(
  app: App,
  candidatePath: string
): Promise<string | null> {
  try {
    if (await app.vault.adapter.exists(candidatePath)) {
      return app.vault.adapter.read(candidatePath);
    }
  } catch (err) {
    console.error(
      `[Work Assistant] Failed to read bundled periodic note template '${candidatePath}' through the vault adapter`,
      err
    );
  }

  try {
    const adapterWithFullPath = app.vault.adapter as typeof app.vault.adapter & {
      getFullPath?: (path: string) => string;
    };
    if (Platform.isDesktopApp && adapterWithFullPath.getFullPath) {
      const fullPath = adapterWithFullPath.getFullPath(candidatePath);
      const buffer = await FileSystemAdapter.readLocalFile(fullPath);
      return new TextDecoder("utf-8").decode(buffer);
    }
  } catch (err) {
    console.debug(
      `[Work Assistant] Bundled periodic note template '${candidatePath}' was not readable as a local file`,
      err
    );
  }

  return null;
}

function getBundledTemplateCandidates(options: TemplateReadOptions): string[] {
  if (!options.granularity) return [];

  const templatePath = DEFAULT_PERIODIC_TEMPLATE_PATH[options.granularity];
  const candidates = new Set<string>();
  const addCandidate = (candidatePath: string | undefined) => {
    if (candidatePath) {
      candidates.add(normalizePath(candidatePath));
    }
  };

  addCandidate(options.pluginDir ? `${options.pluginDir}/${templatePath}` : undefined);
  addCandidate(
    options.pluginId
      ? `.obsidian/plugins/${options.pluginId}/${templatePath}`
      : undefined
  );
  addCandidate(templatePath);

  return Array.from(candidates);
}

export async function getPeriodicNoteCreationPath(
  app: App,
  settings: ISettings,
  granularity: Granularity,
  date: Moment
): Promise<string> {
  const path = resolvePeriodicNotePath(settings, granularity, date, { extension: true });
  await ensureFolderExists(app, path);
  return path;
}

// Credit: @creationix/path.js
export function join(...partSegments: string[]): string {
  // Split the inputs into a list of path commands.
  let parts: string[] = [];
  for (let i = 0, l = partSegments.length; i < l; i++) {
    parts = parts.concat(partSegments[i].split("/"));
  }
  // Interpret the path commands to get the new resolved path.
  const newParts = [];
  for (let i = 0, l = parts.length; i < l; i++) {
    const part = parts[i];
    // Remove leading and trailing slashes
    // Also remove "." segments
    if (!part || part === ".") continue;
    // Push new path segments.
    else newParts.push(part);
  }
  // Preserve the initial slash if there was one.
  if (parts[0] === "") newParts.unshift("");
  // Turn back into a single string path.
  return newParts.join("/");
}

export function basename(fullPath: string): string {
  let base = fullPath.substring(fullPath.lastIndexOf("/") + 1);
  if (base.lastIndexOf(".") != -1) base = base.substring(0, base.lastIndexOf("."));
  return base;
}

async function ensureFolderExists(app: App, path: string): Promise<void> {
  const dirs = path.replace(/\\/g, "/").split("/");
  dirs.pop(); // remove basename

  if (dirs.length) {
    const dir = join(...dirs);
    if (!app.vault.getAbstractFileByPath(dir)) {
      await app.vault.createFolder(dir);
    }
  }
}

export function getRelativeDate(granularity: Granularity, date: Moment): string {
  if (granularity == "week") {
    const thisWeek = window.moment().startOf(granularity);
    const fromNow = window.moment(date).diff(thisWeek, "week");
    if (fromNow === 0) {
      return t("relative-this-week");
    } else if (fromNow === -1) {
      return t("relative-last-week");
    } else if (fromNow === 1) {
      return t("relative-next-week");
    }
    return window.moment.duration(fromNow, granularity).humanize(true);
  } else if (granularity === "day") {
    const today = window.moment().startOf("day");
    const target = window.moment(date).startOf("day");
    const daysFromToday = target.diff(today, "days");
    if (daysFromToday === -1) return t("relative-yesterday");
    if (daysFromToday === 0) return t("relative-today");
    if (daysFromToday === 1) return t("relative-tomorrow");
    if (daysFromToday >= -6 && daysFromToday < -1) {
      return t("relative-last-weekday").replace("{weekday}", window.moment(date).format("dddd"));
    }
    if (daysFromToday > 1 && daysFromToday <= 6) {
      return window.moment(date).format("dddd");
    }
    return window.moment(date).from(today);
  } else {
    return date.format(HUMANIZE_FORMAT[granularity]);
  }
}

export function isIsoFormat(format: string): boolean {
  const cleanFormat = removeEscapedCharacters(format);
  return /w{1,2}/.test(cleanFormat);
}
