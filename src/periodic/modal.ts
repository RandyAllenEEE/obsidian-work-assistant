import { Menu, Modal } from "obsidian";
import type { App, Point } from "obsidian";
import type PeriodicNotesPlugin from "src/main";
import { t } from "src/i18n";

import { displayConfigs, getLocalizedPeriodicity, getOpenPresentLabel } from "./commands";
import { DEFAULT_PERIODIC_TEMPLATE_PATH } from "./constants";
import type { Granularity, PeriodicNotesConfig } from "./types";

export function showFileMenu(
  _app: App,
  plugin: PeriodicNotesPlugin,
  position: Point
): void {
  const contextMenu = new Menu();

  const enabledGranularities = Object.keys(displayConfigs).filter(
    (g) => (plugin.options.periodicNotes as PeriodicNotesConfig)[g as keyof typeof displayConfigs]?.enabled
  ) as Granularity[];

  enabledGranularities.forEach((granularity) => {
    contextMenu.addItem((item) =>
      item
        .setTitle(getOpenPresentLabel(granularity))
        .setIcon(`calendar-${granularity}`)
        .onClick(() => {
          plugin.openPeriodicNote(granularity, window.moment());
        })
    );
  });

  contextMenu.showAtPosition(position);
}
export class PeriodicNoteCreateModal extends Modal {
  constructor(app: App, readonly plugin: PeriodicNotesPlugin) {
    super(app);

    this.contentEl.addClass("periodic-modal");
    this.contentEl.createEl("h2", { text: t("modal-open-periodic-note-title") });

    const enabledGranularities = Object.keys(displayConfigs).filter(
      (g) => (plugin.options.periodicNotes as PeriodicNotesConfig)[g as keyof typeof displayConfigs]?.enabled
    ) as Granularity[];

    enabledGranularities.forEach((granularity) => {
      const config = (plugin.options.periodicNotes as PeriodicNotesConfig)[granularity];

      const noteExists = plugin.getPeriodicNote(granularity, window.moment());
      const template = config.templatePath || DEFAULT_PERIODIC_TEMPLATE_PATH[granularity];
      const periodicity = getLocalizedPeriodicity(granularity);

      this.contentEl.createDiv("setting-item", (rowEl) => {
        rowEl.createDiv("setting-item-info", (descEl) => {
          descEl.createDiv({
            text: t("modal-create-periodic-note-title").replace("{periodicity}", periodicity),
            cls: "setting-item-name",
          });
          descEl.createDiv({
            cls: "setting-item-description",
            text: template
              ? t("modal-periodic-template-desc").replace("{template}", template)
              : t("modal-periodic-template-missing"),
          });
        });

        rowEl.createDiv("setting-item-control", (controlEl) => {
          let button: HTMLButtonElement;
          if (noteExists) {
            button = controlEl.createEl("button", {
              text: t("modal-view-periodic-note-cta").replace("{periodicity}", periodicity),
              cls: "mod-cta",
            });
          } else {
            button = controlEl.createEl("button", {
              text: t("modal-create-periodic-note-cta").replace("{periodicity}", periodicity),
            });
          }

          button.addEventListener("click", () => {
            plugin.openPeriodicNote(granularity, window.moment());
            this.close();
          });
        });
      });
    });
  }
}
