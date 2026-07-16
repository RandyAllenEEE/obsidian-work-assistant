/**
 * Generates unique, human-readable task IDs using timestamp-based format
 * Format: YYYYMMDD-xxxxxxxx where the suffix contains 32 bits of random data.
 *
 * This provides:
 * - Human readability: dates are visible at a glance
 * - Sortability: lexicographic order matches chronological order
 * - Collision resistance: 2^32 combinations per day
 */

/**
 * Generate a timestamp-based task ID
 * @returns A task ID in format YYYYMMDD-xxxxxxxx (e.g., 20250105-a4f19c2e)
 */
export function generateTaskId(): string {
  const now = new Date();

  // Format date as YYYYMMDD
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePart = `${year}${month}${day}`;

  const bytes = new Uint8Array(4);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  const randomPart = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${datePart}-${randomPart}`;
}

/**
 * Extract task ID from raw markdown text.
 * Supports emoji format (🆔 xxx) and Dataview format ([id::xxx]).
 * Used for scanning file lines outside the obsidian-tasks cache.
 * @param taskText The full task text
 * @returns The task ID if found, null otherwise
 */
export function extractTaskId(taskText: string): string | null {
  // Emoji format: 🆔 xxx
  const emojiMatch = taskText.match(/🆔\s*(\S+)/);
  if (emojiMatch) return emojiMatch[1];

  // Dataview format: [id::xxx] (backwards compat)
  const dvMatch = taskText.match(/\[id::([^\]]+)\]/);
  if (dvMatch) return dvMatch[1];

  return null;
}

/**
 * Validate task ID format
 * @param id The task ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidTaskId(id: string): boolean {
  return /^\d{8}-(?:[0-9a-f]{3}|[0-9a-f]{8})$/.test(id);
}
