import type { Moment } from "moment";
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

export function applyTemplateTransformations(
  filename: string,
  granularity: Granularity,
  date: Moment,
  format: string,
  rawTemplateContents: string
): string {
  let templateContents = rawTemplateContents;

  templateContents = rawTemplateContents
    .replace(/{{\s*title\s*}}/gi, filename)
    .replace(/{{\s*time\s*(:.+?)?}}/gi, (_, momentFormat) => {
      return window.moment().format(momentFormat ? momentFormat.substring(1).trim() : "HH:mm");
    })
    .replace(
      /{{\s*date\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
      (_, calc, timeDelta, unit, momentFormat) => {
        const currentDate = date.clone().set({
          hour: window.moment().get("hour"),
          minute: window.moment().get("minute"),
          second: window.moment().get("second"),
        });
        if (calc) {
          currentDate.add(parseInt(timeDelta, 10), unit);
        }

        if (momentFormat) {
          return currentDate.format(momentFormat.substring(1).trim());
        }
        return filename;
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
      /{{\s*(month)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
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
          monthStart.add(parseInt(timeDelta, 10), unit);
        }

        if (momentFormat) {
          return monthStart.format(momentFormat.substring(1).trim());
        }
        return monthStart.format(format);
      }
    );
  }

  if (granularity === "quarter") {
    templateContents = templateContents.replace(
      /{{\s*(quarter)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
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
          monthStart.add(parseInt(timeDelta, 10), unit);
        }

        if (momentFormat) {
          return monthStart.format(momentFormat.substring(1).trim());
        }
        return monthStart.format(format);
      }
    );
  }

  if (granularity === "year") {
    templateContents = templateContents.replace(
      /{{\s*(year)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
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
          monthStart.add(parseInt(timeDelta, 10), unit);
        }

        if (momentFormat) {
          return monthStart.format(momentFormat.substring(1).trim());
        }
        return monthStart.format(format);
      }
    );
  }

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
    templateContents
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

export async function getNoteCreationPath(
  app: App,
  filename: string,
  periodicConfig: PeriodicConfig
): Promise<string> {
  const directory = periodicConfig.folder ?? "";
  const filenameWithExt = !filename.endsWith(".md") ? `${filename}.md` : filename;

  const path = normalizePath(join(directory, filenameWithExt));
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
