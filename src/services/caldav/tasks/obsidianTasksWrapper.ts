import { TFile } from 'obsidian';
import type { App } from 'obsidian';

/**
 * Represents a task from obsidian-tasks plugin
 * Based on actual Task structure from obsidian-tasks
 */
export interface ObsidianTask {
    description: string;
    status: {
        configuration: {
            symbol: string;
            name: string;
            type: string;
        };
    };
    isDone: boolean;
    priority: string;
    tags: string[];
    taskLocation: {
        /** Public obsidian-tasks accessor for the containing file path. */
        path: string;
        _lineNumber?: number;
    };
    originalMarkdown: string;
    createdDate: string | { format(fmt: string): string } | null;
    startDate: string | { format(fmt: string): string } | null;
    scheduledDate: string | { format(fmt: string): string } | null;
    dueDate: string | { format(fmt: string): string } | null;
    doneDate: string | { format(fmt: string): string } | null;
    cancelledDate: string | { format(fmt: string): string } | null;
    recurrence: { toText(): string } | null;
    id: string;
    /** Native serialization (obsidian-tasks ≥ 7.x). Respects user's format settings. */
    toFileLineString?(): string;
    /** String representation of the task. */
    toString?(): string;
}

export interface TaskWithBody {
    task: ObsidianTask;
    body: string;
}

export interface PersistedTaskIdentity {
    /** The task line still exists in the vault and was resolved unambiguously. */
    found: boolean;
    /** `null` means the resolved task line has not received an ID yet. */
    id: string | null;
}

export interface TaskWithCurrentFileState extends TaskWithBody {
    identity: PersistedTaskIdentity;
}

/**
 * Interface for obsidian-tasks plugin
 */
export interface ObsidianTasksPlugin {
    getTasks(): ObsidianTask[];
}

/**
 * Manages tasks from obsidian-tasks plugin
 * Handles filtering, ID injection, and CRUD operations
 */
export class ObsidianTasksWrapper {
    private app: App;
    private tasksPlugin: ObsidianTasksPlugin | null = null;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Initialize task manager and verify obsidian-tasks is available
     */
    initialize(): boolean {
        // Access obsidian-tasks plugin via Obsidian's internal plugin registry
        const appWithPlugins = this.app as App & {
            plugins: { plugins: Record<string, unknown> };
        };
        const plugin = appWithPlugins.plugins.plugins['obsidian-tasks-plugin'] as
            ObsidianTasksPlugin | undefined;

        if (!plugin || typeof plugin.getTasks !== 'function') {
            // A missing Tasks plugin should not turn every scheduled remote
            // refresh into a console error: remote-only CalDAV still works.
            this.tasksPlugin = null;
            return false;
        }

        this.tasksPlugin = plugin;
        return true;
    }

    /**
     * Check if task manager is ready
     */
    isReady(): boolean {
        return this.tasksPlugin !== null;
    }

    /**
     * Get all tasks from obsidian-tasks cache
     */
    getAllTasks(): ObsidianTask[] {
        if (!this.tasksPlugin) {
            console.error('Task manager not initialized');
            return [];
        }

        return this.tasksPlugin.getTasks();
    }

    /**
     * Check if a task has an ID.
     * obsidian-tasks parses both 🆔 and [id::xxx] into task.id.
     */
    taskHasId(task: ObsidianTask): boolean {
        return !!task.id && task.id.length > 0;
    }

    /**
     * Get task ID from task.
     * obsidian-tasks parses both 🆔 and [id::xxx] into task.id.
     */
    getTaskId(task: ObsidianTask): string | null {
        return task.id && task.id.length > 0 ? task.id : null;
    }

    /**
     * Find a task by its ID
     * @returns The task if found, null otherwise
     */
    findTaskById(taskId: string): ObsidianTask | null {
        const allTasks = this.getAllTasks();

        for (const task of allTasks) {
            const id = this.getTaskId(task);
            if (id === taskId) {
                return task;
            }
        }

        return null;
    }

    /**
     * Compatibility helper for callers that intentionally replace a task and
     * its indented note block. Identity injection uses updateTaskLineInVault
     * instead, so ordinary publication never rewrites user-authored notes.
     */
    async updateTaskInVault(task: ObsidianTask, newContent: string): Promise<void> {
        const filePath = task.taskLocation.path;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`File not found: ${filePath}`);
        }

        await this.app.vault.process(file, (content) =>
            this.replaceTaskInContent(content, task, newContent),
        );
    }

    /**
     * Update only the task line. This is used for identity injection so a
     * first sync cannot discard indented notes, subtasks, or user formatting.
     */
    async updateTaskLineInVault(task: ObsidianTask, newLine: string): Promise<void> {
        const filePath = task.taskLocation.path;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`File not found: ${filePath}`);
        }

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            const taskIndex = this.findTaskLineIndex(lines, task);
            if (taskIndex === -1) {
                throw new Error(`Could not find task in file: ${task.originalMarkdown}`);
            }
            lines[taskIndex] = newLine;
            return lines.join('\n');
        });
    }

    /**
     * Resolve a task ID from the current Markdown file when the Tasks cache
     * has not yet observed a just-written ID. A missing or changed task is
     * reported separately so callers do not publish a stale cache entry.
     */
    async getPersistedTaskIdentity(task: ObsidianTask): Promise<PersistedTaskIdentity> {
        const file = this.app.vault.getAbstractFileByPath(task.taskLocation.path);
        if (!file || !(file instanceof TFile)) return { found: false, id: null };

        const lines = (await this.app.vault.read(file)).split('\n');
        const taskIndex = this.findTaskLineIndex(lines, task);
        if (taskIndex === -1) return { found: false, id: null };
        return { found: true, id: this.extractIdFromLine(lines[taskIndex]) };
    }

    /**
     * Verify a known task identity directly from its current Markdown file.
     * `null` deliberately means unknown (for example an interrupted read), so
     * lifecycle code can wait rather than treating a transient vault failure
     * as a deletion.
     */
    async hasTaskIdentityAtPath(path: string, taskId: string): Promise<boolean | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file || !(file instanceof TFile)) return false;
        try {
            return (await this.app.vault.read(file))
                .split('\n')
                .some((line) => this.extractIdFromLine(line) === taskId);
        } catch (error) {
            console.warn(`[ObsidianTasksWrapper] Failed to verify task identity in ${path}:`, error);
            return null;
        }
    }

    hasMarkdownFileAtPath(path: string): boolean {
        const file = this.app.vault.getAbstractFileByPath(path);
        return !!file && file instanceof TFile;
    }

    /**
     * Apply the Tasks plugin's toggle output without conflating the original
     * task's indented notes with a newly generated recurring instance.
     */
    async applyToggleResult(task: ObsidianTask, toggledContent: string): Promise<void> {
        const filePath = task.taskLocation.path;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`File not found: ${filePath}`);
        }

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            const taskIndex = this.findTaskLineIndex(lines, task);
            if (taskIndex === -1) {
                throw new Error(`Could not find task in file: ${task.originalMarkdown}`);
            }
            const outputLines = toggledContent.split('\n');
            const firstTaskLine = outputLines.findIndex((line) => /^\s*-\s+\[[^\]]*\]\s+/.test(line));
            if (firstTaskLine === -1) {
                throw new Error("Tasks plugin returned no task line when toggling a task");
            }

            const nextTaskLine = outputLines.findIndex(
                (line, index) => index > firstTaskLine && /^\s*-\s+\[[^\]]*\]\s+/.test(line),
            );
            // A regular completion only replaces its own line. Existing notes
            // remain attached to it exactly as the user authored them.
            if (nextTaskLine === -1) {
                lines[taskIndex] = outputLines[firstTaskLine];
                return lines.join('\n');
            }

            let noteEnd = taskIndex + 1;
            while (noteEnd < lines.length && /^(?:\s{2,}|\t)- /.test(lines[noteEnd])) {
                noteEnd++;
            }
            lines[taskIndex] = outputLines[firstTaskLine];
            // The next recurring task is a sibling after the original task
            // block, so the original task's notes remain with the completed
            // instance rather than becoming notes of the new one.
            lines.splice(noteEnd, 0, ...outputLines.slice(nextTaskLine));
            return lines.join('\n');
        });
    }

    private replaceTaskInContent(
        content: string,
        task: ObsidianTask,
        newContent: string,
    ): string {
        const lines = content.split('\n');

        const originalMarkdown = task.originalMarkdown;
        const taskIndex = this.findTaskLineIndex(lines, task);

        if (taskIndex === -1) {
            throw new Error(`Could not find task in file: ${originalMarkdown}`);
        }

        // Count indented note lines below the task
        let noteLineCount = 0;
        for (let i = taskIndex + 1; i < lines.length; i++) {
            if (/^(?:\s{2,}|\t)- /.test(lines[i])) {
                noteLineCount++;
            } else {
                break;
            }
        }

        // Replace the task line + any note lines with new content
        const newLines = newContent.split('\n');
        lines.splice(taskIndex, 1 + noteLineCount, ...newLines);

        return lines.join('\n');
    }

    /**
     * Get statistics about tasks
     */
    getTaskStats(tasks: ObsidianTask[]): {
        total: number;
        done: number;
        notDone: number;
        withIds: number;
        withoutIds: number;
    } {
        const stats = {
            total: tasks.length,
            done: 0,
            notDone: 0,
            withIds: 0,
            withoutIds: 0
        };

        tasks.forEach(task => {
            if (task.isDone) {
                stats.done++;
            } else {
                stats.notDone++;
            }

            if (this.taskHasId(task)) {
                stats.withIds++;
            } else {
                stats.withoutIds++;
            }
        });

        return stats;
    }

    /**
     * Get all tasks paired with their body text extracted from vault files.
     * Groups tasks by file to avoid re-reading the same file multiple times.
     */
    async getAllTasksWithBody(): Promise<TaskWithBody[]> {
        return this.loadBodies(this.getAllTasks());
    }

    async getTasksWithBody(tasks: ObsidianTask[]): Promise<TaskWithBody[]> {
        return this.loadBodies(tasks);
    }

    /**
     * Read each task file once and return both note bodies and the identity on
     * the current line. Publication uses this instead of reading the same
     * Markdown file once for bodies and once again per task for IDs.
     */
    async getTasksWithCurrentFileState(tasks: ObsidianTask[]): Promise<TaskWithCurrentFileState[]> {
        return this.loadCurrentFileState(tasks);
    }

    /**
     * Resolve a task's containing file path via the public obsidian-tasks
     * accessor. Returns null (and warns) if the path is absent, so one task
     * with an unexpected shape can't abort the entire sync.
     */
    private resolveTaskPath(task: ObsidianTask): string | null {
        const path = task.taskLocation?.path;
        if (!path) {
            console.warn(
                `[ObsidianTasksWrapper] Skipping task with no resolvable path: ${task.originalMarkdown}`,
            );
            return null;
        }
        return path;
    }

    /**
     * Pair tasks with their body text by reading vault files.
     * Groups tasks by file to avoid re-reading the same file multiple times.
     */
    private async loadBodies(tasks: ObsidianTask[]): Promise<TaskWithBody[]> {
        return (await this.loadCurrentFileState(tasks)).map(({ task, body }) => ({ task, body }));
    }

    private async loadCurrentFileState(tasks: ObsidianTask[]): Promise<TaskWithCurrentFileState[]> {
        const tasksByFile = new Map<string, ObsidianTask[]>();
        for (const task of tasks) {
            const filePath = this.resolveTaskPath(task);
            if (filePath === null) {
                continue;
            }
            const existingTasks = tasksByFile.get(filePath);
            if (existingTasks) {
                existingTasks.push(task);
            } else {
                tasksByFile.set(filePath, [task]);
            }
        }

        const groups = [...tasksByFile.entries()];
        const groupResults: TaskWithCurrentFileState[][] = new Array(groups.length);
        let nextGroup = 0;
        const processNextGroup = async (): Promise<void> => {
            while (nextGroup < groups.length) {
                const groupIndex = nextGroup++;
                const [filePath, fileTasks] = groups[groupIndex];
                groupResults[groupIndex] = await this.loadCurrentFileStateForFile(filePath, fileTasks);
            }
        };
        await Promise.all(
            Array.from({ length: Math.min(8, groups.length) }, () => processNextGroup())
        );
        return groupResults.flat();
    }

    private async loadCurrentFileStateForFile(
        filePath: string,
        fileTasks: ObsidianTask[]
    ): Promise<TaskWithCurrentFileState[]> {
        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (!file || !(file instanceof TFile)) {
                return fileTasks.map((task) => ({
                    task,
                    body: '',
                    identity: { found: false, id: null },
                }));
            }
            const content = await this.app.vault.read(file);
            const lines = content.split('\n');
            const usedLineIndexes = new Set<number>();
            return fileTasks.map((task) => {
                const lineIndex = this.findTaskLineIndex(lines, task, usedLineIndexes);
                if (lineIndex === -1) {
                    return {
                        task,
                        body: '',
                        identity: { found: false, id: null },
                    };
                }
                usedLineIndexes.add(lineIndex);
                return {
                    task,
                    body: this.extractBodyFromFile(content, lineIndex),
                    identity: {
                        found: true,
                        id: this.extractIdFromLine(lines[lineIndex]),
                    },
                };
            });
        } catch (error) {
            console.error(`[ObsidianTasksWrapper] Failed to read file for body: ${filePath}`, error);
            return fileTasks.map((task) => ({
                task,
                body: '',
                identity: { found: false, id: null },
            }));
        }
    }

    private findTaskLineIndex(
        lines: string[],
        task: ObsidianTask,
        usedLineIndexes: ReadonlySet<number> = new Set()
    ): number {
        const configuredLine = task.taskLocation?._lineNumber;
        if (Number.isInteger(configuredLine)) {
            for (const candidate of [configuredLine as number, (configuredLine as number) - 1]) {
                if (candidate >= 0
                    && candidate < lines.length
                    && !usedLineIndexes.has(candidate)
                    && this.lineMatchesTask(lines[candidate], task)) {
                    return candidate;
                }
            }
        }

        const taskId = this.getTaskId(task);
        if (taskId) {
            const idIndex = lines.findIndex((line, index) =>
                !usedLineIndexes.has(index) && this.extractIdFromLine(line) === taskId
            );
            if (idIndex !== -1) return idIndex;
        }

        const matches = lines
            .map((line, index) => ({ line, index }))
            .filter(({ line, index }) =>
                !usedLineIndexes.has(index)
                && this.matchesOriginalTaskLine(line, task, taskId)
            );
        if (matches.length <= 1) return matches[0]?.index ?? -1;

        const siblings = this.getAllTasks().filter((candidate) =>
            candidate.taskLocation?.path === task.taskLocation?.path
            && candidate.originalMarkdown.trim() === task.originalMarkdown.trim()
        );
        const occurrence = Math.max(0, siblings.indexOf(task));
        return matches[occurrence]?.index ?? matches[0].index;
    }

    private lineMatchesTask(line: string, task: ObsidianTask): boolean {
        const taskId = this.getTaskId(task);
        return this.matchesOriginalTaskLine(line, task, taskId)
            || (!!taskId && this.extractIdFromLine(line) === taskId);
    }

    private matchesOriginalTaskLine(line: string, task: ObsidianTask, taskId = this.getTaskId(task)): boolean {
        if (line.trim() === task.originalMarkdown.trim()) return true;
        // During the short interval between a vault write and Tasks cache
        // refresh, the cached line lacks the freshly appended ID. Comparing
        // the line without identity metadata avoids allocating another ID.
        return !taskId
            && this.withoutTaskIdentity(line) === this.withoutTaskIdentity(task.originalMarkdown);
    }

    private withoutTaskIdentity(line: string): string {
        return line
            .replace(/\[id::\s*[^\]]+\]/g, '')
            .replace(/🆔\s+\S+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private extractIdFromLine(line: string): string | null {
        const match = line.match(/\[id::\s*([^\]]+)\]/) ?? line.match(/🆔\s+(\S+)/);
        return match?.[1]?.trim() ?? null;
    }

    /**
     * Filter task inputs by sync tag.
     * Keeps only tasks whose tags include the given sync tag (case-insensitive).
     * Returns all inputs when syncTag is empty or undefined.
     */
    filterByTag(inputs: TaskWithBody[], syncTag?: string): TaskWithBody[] {
        if (!syncTag || syncTag.trim() === '') return inputs;

        const tagLower = syncTag.toLowerCase().replace(/^#/, '');
        return inputs.filter(({ task }) => {
            if (!task.tags || task.tags.length === 0) return false;
            return task.tags.some((tag: string) =>
                tag.toLowerCase().replace(/^#/, '') === tagLower
            );
        });
    }

    /**
     * Extract indented bullet body from file content below a task line.
     * Body lines match /^(?:\s{2,}|\t)- (.*)$/ immediately after the task.
     * Returns joined lines with \n, or '' if no body found.
     */
    extractBodyFromFile(fileContent: string, taskLineIndex: number): string {
        const lines = fileContent.split('\n');
        const noteLines: string[] = [];

        for (let i = taskLineIndex + 1; i < lines.length; i++) {
            const match = lines[i].match(/^(?:\s{2,}|\t)- (.*)$/);
            if (!match) break;
            noteLines.push(match[1]);
        }

        return noteLines.join('\n');
    }

    /**
     * Extract task ID from an obsidian-tasks Task.
     * Only checks the task.id field populated by obsidian-tasks
     * for both 🆔 and [id::] formats.
     */
    extractId(task: ObsidianTask): string | null {
        if (task.id && task.id.length > 0) return task.id;
        return null;
    }

    /**
     * Get the obsidian-tasks toggle command for completing tasks.
     * Returns null if the API is not available.
     */
    getToggleCommand(): ((line: string, path: string) => string) | null {
        const appWithPlugins = this.app as App & {
            plugins: { plugins: Record<string, { apiV1?: { executeToggleTaskDoneCommand: (line: string, path: string) => string } }> };
        };
        const tasksPlugin = appWithPlugins.plugins.plugins['obsidian-tasks-plugin'];
        return tasksPlugin?.apiV1?.executeToggleTaskDoneCommand ?? null;
    }

    /**
     * Read the obsidian-tasks persisted settings we depend on:
     *   - `format`: which markdown format to write (its in-memory settings
     *     live in a module closure and are not reliably exposed, so we read
     *     `loadData()`). Anything other than 'dataview' maps to 'emoji'.
     *   - `globalFilter`: when set, obsidian-tasks only parses lines
     *     containing this tag and strips it from `task.tags`, so we re-add
     *     it on writeback to keep them recognised. '' when unset.
     *
     * Missing plugin, missing method, or any read error returns the safe
     * defaults (`{ format: 'emoji', globalFilter: '' }`).
     */
    async getTasksPluginConfig(): Promise<{ format: 'emoji' | 'dataview'; globalFilter: string }> {
        const defaults = { format: 'emoji' as const, globalFilter: '' };
        const appWithPlugins = this.app as App & {
            plugins: { plugins: Record<string, { loadData?: () => Promise<unknown> }> };
        };
        const tasksPlugin = appWithPlugins.plugins.plugins['obsidian-tasks-plugin'];
        if (!tasksPlugin || typeof tasksPlugin.loadData !== 'function') {
            return defaults;
        }
        try {
            const data = (await tasksPlugin.loadData()) as { taskFormat?: unknown; globalFilter?: unknown } | null;
            return {
                format: data?.taskFormat === 'dataview' ? 'dataview' : 'emoji',
                globalFilter: typeof data?.globalFilter === 'string' ? data.globalFilter : '',
            };
        } catch {
            return defaults;
        }
    }

}
