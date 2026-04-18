import { Notice } from 'obsidian';

/**
 * Show a notification using Obsidian's Notice API.
 * Note: Obsidian Notice is the most reliable notification method in the Obsidian environment.
 * Windows Action Center notifications via electron.remote are not used because
 * electron.remote was removed in Electron 14+ (which Obsidian uses).
 */
export function showNotification(title: string, body: string, _silent?: boolean): void {
    // Validate inputs
    if (!title || !title.trim()) {
        console.warn("[Work Assistant] Empty notification title, skipping.");
        return;
    }

    const safeBody = body && body.trim() ? body : "";

    // Use Obsidian Notice - always show the body if available, otherwise show title
    // Notice takes (message, duration) format
    new Notice(safeBody || title, 5000);
}

// Alias for compatibility
export const sendSystemNotification = showNotification;
