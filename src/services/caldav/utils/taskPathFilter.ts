export function shouldExcludeTaskPath(filepath: string, patterns: string[]): boolean {
  const normalizedFilepath = filepath.replace(/\\/g, "/");

  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;

    try {
      if (trimmed.startsWith("/") && trimmed.endsWith("/") && trimmed.length > 2) {
        if (new RegExp(trimmed.slice(1, -1)).test(normalizedFilepath)) return true;
        continue;
      }

      const normalizedPattern = trimmed.replace(/\\/g, "/");
      if (normalizedFilepath === normalizedPattern) return true;
      if (normalizedPattern.endsWith("/") && normalizedFilepath.startsWith(normalizedPattern)) return true;
    } catch (error) {
      console.warn(`[Work Assistant] Invalid task exclude pattern: ${trimmed}`, error);
    }
  }

  return false;
}
