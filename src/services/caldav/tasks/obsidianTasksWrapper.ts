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
            console.error('obsidian-tasks plugin not found or getTasks() method unavailable');
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
     * Get tasks that should be synced based on query
     * @param query Sync query string (e.g., "not done", "tags include #sync")
     */
    getTasksToSync(query: string): ObsidianTask[] {
        const allTasks = this.getAllTasks();
        return this.filterTasks(allTasks, query);
    }

    /**
     * Filter tasks based on sync query
     * Supports simple queries initially:
     * - "not done" - only incomplete tasks
     * - "done" - only completed tasks
     * - "tags include #tagname" - tasks with specific tag
     * - "all" - all tasks
     */
    filterTasks(tasks: ObsidianTask[], query: string): ObsidianTask[] {
        const lowerQuery = query.toLowerCase().trim();

        // Handle "not done" query
        if (lowerQuery === 'not done') {
            return tasks.filter(task => !task.isDone);
        }

        // Handle "done" query
        if (lowerQuery === 'done') {
            return tasks.filter(task => task.isDone);
        }

        // Handle "tags include #tagname" query
        const tagMatch = lowerQuery.match(/tags?\s+include\s+#?(\S+)/);
        if (tagMatch) {
            const tagName = tagMatch[1];
            return tasks.filter(task =>
                task.tags.some(tag => tag.toLowerCase() === tagName.toLowerCase())
            );
        }

        // Handle "all" query
        if (lowerQuery === 'all') {
            return tasks;
        }

        // Default: return all non-done tasks
        // Unsupported query, default to "not done"
        return tasks.filter(task => !task.isDone);
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
     * Update a task's content in the vault
     */
    async updateTaskInVault(task: ObsidianTask, newContent: string): Promise<void> {
        const filePath = task.taskLocation.path;

        // Get the file
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`File not found: ${filePath}`);
        }

        // Read current content
        const content = await this.app.vault.read(file);
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

        // Write back to file
        await this.app.vault.modify(file, lines.join('\n'));
    }

    async deleteTaskInVault(task: ObsidianTask): Promise<void> {
        const filePath = task.taskLocation.path;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`File not found: ${filePath}`);
        }
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        const taskIndex = this.findTaskLineIndex(lines, task);
        if (taskIndex === -1) {
            throw new Error(`Could not find task in file: ${task.originalMarkdown}`);
        }
        let noteLineCount = 0;
        for (let index = taskIndex + 1; index < lines.length; index++) {
            if (!/^(?:\s{2,}|\t)- /.test(lines[index])) break;
            noteLineCount++;
        }
        lines.splice(taskIndex, 1 + noteLineCount);
        await this.app.vault.modify(file, lines.join('\n'));
    }

    /**
     * Create a new task in the destination file
     * @param taskContent The task markdown (e.g., "- [ ] New task")
     * @param destinationPath Path to the file where task should be added
     * @param section Optional section heading under which to add the task
     */
    async createTask(
        taskContent: string,
        destinationPath: string,
        section?: string
    ): Promise<void> {
        // Get or create the destination file
        const file = this.app.vault.getAbstractFileByPath(destinationPath);

        if (!file) {
            // Create new file
            await this.app.vault.create(destinationPath, taskContent + '\n');
            return;
        }

        if (!(file instanceof TFile)) {
            throw new Error(`Path is not a file: ${destinationPath}`);
        }

        // Read existing content
        let content = await this.app.vault.read(file);

        if (section) {
            // Try to find the section
            const sectionHeader = `## ${section}`;
            const lines = content.split('\n');
            const sectionIndex = lines.findIndex(line =>
                line.trim() === sectionHeader ||
                line.trim() === `# ${section}`
            );

            if (sectionIndex !== -1) {
                // Insert after section header
                lines.splice(sectionIndex + 1, 0, taskContent);
                content = lines.join('\n');
            } else {
                // Section not found, create it at the end
                content += `\n\n${sectionHeader}\n${taskContent}`;
            }
        } else {
            // Append to end of file
            content += '\n' + taskContent;
        }

        // Write back
        await this.app.vault.modify(file, content);
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
        const groupResults: TaskWithBody[][] = new Array(groups.length);
        let nextGroup = 0;
        const processNextGroup = async (): Promise<void> => {
            while (nextGroup < groups.length) {
                const groupIndex = nextGroup++;
                const [filePath, fileTasks] = groups[groupIndex];
                groupResults[groupIndex] = await this.loadBodiesForFile(filePath, fileTasks);
            }
        };
        await Promise.all(
            Array.from({ length: Math.min(8, groups.length) }, () => processNextGroup())
        );
        return groupResults.flat();
    }

    private async loadBodiesForFile(
        filePath: string,
        fileTasks: ObsidianTask[]
    ): Promise<TaskWithBody[]> {
        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (!file || !(file instanceof TFile)) {
                return fileTasks.map((task) => ({ task, body: '' }));
            }
            const content = await this.app.vault.read(file);
            const lines = content.split('\n');
            const usedLineIndexes = new Set<number>();
            return fileTasks.map((task) => {
                const lineIndex = this.findTaskLineIndex(lines, task, usedLineIndexes);
                if (lineIndex === -1) return { task, body: '' };
                usedLineIndexes.add(lineIndex);
                return { task, body: this.extractBodyFromFile(content, lineIndex) };
            });
        } catch (error) {
            console.error(`[ObsidianTasksWrapper] Failed to read file for body: ${filePath}`, error);
            return fileTasks.map((task) => ({ task, body: '' }));
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
                && line.trim() === task.originalMarkdown.trim()
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
        return line.trim() === task.originalMarkdown.trim()
            || (!!taskId && this.extractIdFromLine(line) === taskId);
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
