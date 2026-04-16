import type { TFile } from "obsidian";
import { getDateFromFile, getDateUID } from "obsidian-daily-notes-interface";

export const classList = (obj: Record<string, boolean>): string[] => {
  return Object.entries(obj)
    .filter(([_k, v]) => !!v)
    .map(([k, _k]) => k);
};

export function clamp(
  num: number,
  lowerBound: number,
  upperBound: number
): number {
  return Math.min(Math.max(lowerBound, num), upperBound);
}

export function partition(
  arr: string[],
  predicate: (elem: string) => boolean
): [string[], string[]] {
  const pass = [];
  const fail = [];

  arr.forEach((elem) => {
    if (predicate(elem)) {
      pass.push(elem);
    } else {
      fail.push(elem);
    }
  });

  return [pass, fail];
}

/**
 * Lookup the dateUID for a given file. It compares the filename
 * to the daily and weekly note formats to find a match.
 *
 * @param file
 */
export function getDateUIDFromFile(file: TFile | null): string {
  if (!file) {
    return null;
  }

  // TODO: I'm not checking the path!
  let date = getDateFromFile(file, "day");
  if (date) {
    return getDateUID(date, "day");
  }

  date = getDateFromFile(file, "week");
  if (date) {
    return getDateUID(date, "week");
  }
  return null;
}

/**
 * 统一的字数计算函数，与 WordCountStats 中的算法一致
 * 支持多语言：英文（按单词计）、中文/日文（按字符计）
 * 
 * @param text 要计算的文本
 * @returns 字数
 */
export function getWordCount(text: string): number {
  let words = 0;
  const matches = text.match(
    /[a-zA-Z0-9_\u0392-\u03c9\u00c0-\u00ff\u0600-\u06ff]+|[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\uac00-\ud7af]+/gm
  );

  if (matches) {
    for (let i = 0; i < matches.length; i++) {
      // CJK文字判定：如果是CJK字符，按字符数计；否则按单词数计
      if (matches[i].charCodeAt(0) > 19968) {
        words += matches[i].length;
      } else {
        words += 1;
      }
    }
  }
  return words;
}
