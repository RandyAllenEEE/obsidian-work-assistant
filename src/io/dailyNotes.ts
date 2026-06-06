import type { Moment } from "moment";
import type { TFile } from "obsidian";
import {
  createDailyNote,
  getDailyNoteSettings,
} from "obsidian-daily-notes-interface";

import type { ISettings } from "src/settings";
import { t } from "src/i18n";
import { createConfirmationDialog } from "src/ui/modal";

/**
 * Create a Daily Note for a given date.
 */
export async function tryToCreateDailyNote(
  date: Moment,
  inNewSplit: boolean,
  settings: ISettings,
  cb?: (newFile: TFile) => void
): Promise<void> {
  const { workspace } = window.app;
  const { format } = getDailyNoteSettings();
  const filename = date.format(format);

  const createFile = async () => {
    const dailyNote = await createDailyNote(date);
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
      title: t("modal-create-note-title"),
    });
  } else {
    await createFile();
  }
}
