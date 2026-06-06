import type { Moment } from "moment";
import type { TFile } from "obsidian";
import {
  createWeeklyNote,
  getWeeklyNoteSettings,
} from "obsidian-daily-notes-interface";

import type { ISettings } from "src/settings";
import { t } from "src/i18n";
import { createConfirmationDialog } from "src/ui/modal";

/**
 * Create a Weekly Note for a given date.
 */
export async function tryToCreateWeeklyNote(
  date: Moment,
  inNewSplit: boolean,
  settings: ISettings,
  cb?: (file: TFile) => void
): Promise<void> {
  const { workspace } = window.app;
  const { format } = getWeeklyNoteSettings();
  const filename = date.format(format);

  const createFile = async () => {
    const dailyNote = await createWeeklyNote(date);
    const leaf = inNewSplit
      ? workspace.splitActiveLeaf()
      : workspace.getUnpinnedLeaf();

    await leaf.openFile(dailyNote, { active: true });
    cb?.(dailyNote);
  };

  if (settings.assistant.calendar.shouldConfirmBeforeCreate) {
    createConfirmationDialog({
      cta: t("modal-create-note-cta"),
      onAccept: createFile,
      text: t("modal-create-note-text").replace("{filename}", filename),
      title: t("modal-create-weekly-note-title"),
    });
  } else {
    await createFile();
  }
}
