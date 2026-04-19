/**
 * Path utility functions for Work Assistant
 */

/**
 * Normalize file path for storage: removes .md suffix from file paths.
 * This ensures consistent key format across todaysWordCount storage.
 *
 * @param filePath - The file path to normalize
 * @returns Normalized path without .md suffix and with forward slashes
 *
 * @example
 * normalizePathForStorage("Daily/notes.md") // returns "Daily/notes"
 * normalizePathForStorage("Daily/notes")   // returns "Daily/notes"
 * normalizePathForStorage("Daily\\notes.md") // returns "Daily/notes"
 */
export function normalizePathForStorage(filePath: string): string {
    // 统一将反斜杠替换为正斜杠，确保跨平台一致性
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.endsWith(".md") && normalized.length > 3) {
        return normalized.slice(0, -3);
    }
    return normalized;
}

/**
 * Convert a normalized storage path back to OS-native path format.
 * This is needed when calling Obsidian APIs that expect OS-native paths.
 *
 * @param normalizedPath - The normalized path (with forward slashes and no .md suffix)
 * @returns OS-native path
 *
 * @example
 * convertToOsPath("10-项目/Projects/控保协同/继电保护相关") // returns "10-项目\Projects\控保协同\继电保护相关" on Windows
 */
export function convertToOsPath(normalizedPath: string): string {
    // 检查是否是绝对路径（以 / 或盘符开头）
    if (normalizedPath.match(/^[a-zA-Z]:/)) {
        // Windows 绝对路径：保持盘符后的分隔符转换
        return normalizedPath.replace(/\//g, '\\');
    } else if (normalizedPath.startsWith('/')) {
        // Unix 绝对路径
        return normalizedPath;
    } else {
        // 相对路径：直接转换分隔符
        return normalizedPath.replace(/\//g, '\\');
    }
}
