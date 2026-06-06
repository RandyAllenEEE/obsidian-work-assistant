import { Notice, TFile } from "obsidian";
import type { App, Command } from "obsidian";
import type PeriodicNotesPlugin from "src/main";
import { t } from "src/i18n";
import type { Language } from "src/i18n";

import type { Granularity } from "./types";

interface IDisplayConfig {
  periodicity: string;
}

export const displayConfigs: Record<Granularity, IDisplayConfig> = {
  day: {
    periodicity: "daily",
  },
  week: {
    periodicity: "weekly",
  },
  month: {
    periodicity: "monthly",
  },
  quarter: {
    periodicity: "quarterly",
  },
  year: {
    periodicity: "yearly",
  },
};

const periodicityLabelKeys: Record<Granularity, Parameters<typeof t>[0]> = {
  day: "label-periodicity-daily",
  week: "label-periodicity-weekly",
  month: "label-periodicity-monthly",
  quarter: "label-periodicity-quarterly",
  year: "label-periodicity-yearly",
};

export function getLocalizedPeriodicity(granularity: Granularity, lang?: Language): string {
  return t(periodicityLabelKeys[granularity], lang);
}

export function getOpenPresentLabel(granularity: Granularity, lang?: Language): string {
  return t("command-open-note", lang).replace("{periodicity}", getLocalizedPeriodicity(granularity, lang));
}

async function jumpToAdjacentNote(
  app: App,
  plugin: PeriodicNotesPlugin,
  direction: "forwards" | "backwards"
): Promise<void> {
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) return;
  const activeFileMeta = plugin.findInCache(activeFile.path);
  if (!activeFileMeta) return;

  const adjacentNoteMeta = plugin.findAdjacent(
    activeFile.path,
    direction
  );

  if (adjacentNoteMeta) {
    const file = app.vault.getAbstractFileByPath(adjacentNoteMeta.filePath);
    if (file && file instanceof TFile) {
      const leaf = app.workspace.getUnpinnedLeaf();
      await leaf.openFile(file, { active: true });
    }
  } else {
    const directionLabel = direction === "forwards"
      ? t("notice-direction-after")
      : t("notice-direction-before");
    const periodicity = getLocalizedPeriodicity(activeFileMeta.granularity);
    new Notice(
      t("notice-no-adjacent-periodic-note")
        .replace("{periodicity}", periodicity)
        .replace("{direction}", directionLabel)
    );
  }
}

async function openAdjacentNote(
  app: App,
  plugin: PeriodicNotesPlugin,
  direction: "forwards" | "backwards"
): Promise<void> {
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) return;
  const activeFileMeta = plugin.findInCache(activeFile.path);
  if (!activeFileMeta) return;

  const offset = direction === "forwards" ? 1 : -1;
  const adjacentDate = activeFileMeta.date
    .clone()
    .add(offset, activeFileMeta.granularity);

  plugin.openPeriodicNote(activeFileMeta.granularity, adjacentDate);
}

export function getCommands(
  app: App,
  plugin: PeriodicNotesPlugin,
  granularity: Granularity
): Command[] {
  const config = displayConfigs[granularity];

  const localizedPeriodicity = getLocalizedPeriodicity(granularity);

  return [
    {
      id: `open-${config.periodicity}-note`,
      name: t("command-open-note").replace("{periodicity}", localizedPeriodicity),
      callback: () => plugin.openPeriodicNote(granularity, window.moment()),
    },

    {
      id: `next-${config.periodicity}-note`,
      name: t("command-next-note").replace("{periodicity}", localizedPeriodicity),
      checkCallback: (checking: boolean) => {
        const activeFile = app.workspace.getActiveFile();
        if (checking) {
          if (!activeFile) return false;
          return plugin.isPeriodic(activeFile.path, granularity);
        }
        jumpToAdjacentNote(app, plugin, "forwards");
      },
    },
    {
      id: `prev-${config.periodicity}-note`,
      name: t("command-prev-note").replace("{periodicity}", localizedPeriodicity),
      checkCallback: (checking: boolean) => {
        const activeFile = app.workspace.getActiveFile();
        if (checking) {
          if (!activeFile) return false;
          return plugin.isPeriodic(activeFile.path, granularity);
        }
        jumpToAdjacentNote(app, plugin, "backwards");
      },
    },
    {
      id: `open-next-${config.periodicity}-note`,
      name: t("command-open-next-note").replace("{periodicity}", localizedPeriodicity),
      checkCallback: (checking: boolean) => {
        const activeFile = app.workspace.getActiveFile();
        if (checking) {
          if (!activeFile) return false;
          return plugin.isPeriodic(activeFile.path, granularity);
        }
        openAdjacentNote(app, plugin, "forwards");
      },
    },
    {
      id: `open-prev-${config.periodicity}-note`,
      name: t("command-open-prev-note").replace("{periodicity}", localizedPeriodicity),
      checkCallback: (checking: boolean) => {
        const activeFile = app.workspace.getActiveFile();
        if (checking) {
          if (!activeFile) return false;
          return plugin.isPeriodic(activeFile.path, granularity);
        }
        openAdjacentNote(app, plugin, "backwards");
      },
    },
  ];
}
