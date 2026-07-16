import type { TFile } from "obsidian";

import { getWordCount } from "../utils";

export interface NoteMetrics {
  wordCount: number;
  remainingTasks: number;
}

interface CachedMetrics {
  version: string;
  promise: Promise<NoteMetrics>;
}

const metricsByPath = new Map<string, CachedMetrics>();
const MAX_CACHE_ENTRIES = 1000;

export async function getNoteMetrics(note: TFile): Promise<NoteMetrics> {
  const version = note.stat
    ? `${note.stat.mtime}:${note.stat.ctime}:${note.stat.size}`
    : "unknown";
  const cached = metricsByPath.get(note.path);
  if (cached?.version === version) return cached.promise;

  const promise = window.app.vault.cachedRead(note).then((contents) => ({
    wordCount: getWordCount(contents),
    remainingTasks: (contents.match(/(?:-|\*) \[ \]/g) || []).length,
  })).catch((error) => {
    if (metricsByPath.get(note.path)?.promise === promise) {
      metricsByPath.delete(note.path);
    }
    throw error;
  });
  metricsByPath.set(note.path, { version, promise });

  if (metricsByPath.size > MAX_CACHE_ENTRIES) {
    const oldestPath = metricsByPath.keys().next().value as string | undefined;
    if (oldestPath) metricsByPath.delete(oldestPath);
  }
  return promise;
}

export function invalidateNoteMetrics(path: string, isFolder = false): void {
  if (!isFolder) {
    metricsByPath.delete(path);
    return;
  }
  for (const cachedPath of [...metricsByPath.keys()]) {
    if (cachedPath === path || cachedPath.startsWith(`${path}/`)) {
      metricsByPath.delete(cachedPath);
    }
  }
}
