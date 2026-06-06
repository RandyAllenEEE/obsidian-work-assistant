import { Modal } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../../../i18n';
import type { Translation } from '../../../i18n';
import type { SyncResult } from '../sync/syncEngine';
import type { CommonTask, Conflict, SyncChange } from '../sync/types';

export class SyncResultModal extends Modal {
  private results: SyncResult[];
  private isDryRun: boolean;
  private onApply?: () => Promise<SyncResult[]>;

  constructor(app: App, results: SyncResult[], isDryRun: boolean, onApply?: () => Promise<SyncResult[]>) {
    super(app);
    this.results = results;
    this.isDryRun = isDryRun;
    this.onApply = onApply;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('sync-modal');

    this.setTitle(this.isDryRun ? t('tasks-sync-modal-preview-title') : t('tasks-sync-modal-results-title'));

    for (const result of this.results) {
      this.renderCalendarSection(contentEl, result);
    }

    this.renderActions(contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderCalendarSection(container: HTMLElement, result: SyncResult): void {
    const section = container.createDiv({ cls: 'sync-calendar-section' });
    section.createEl('h3', { text: result.calendarName, cls: 'sync-calendar-heading' });

    this.renderSummary(section, result);

    const details = result.details;

    if (details.obsidianTasks || details.caldavTasks || details.baselineTasks) {
      this.renderSection(section, t('tasks-sync-modal-inputs'), (el) => {
        if (details.obsidianTasks) {
          el.createEl('h4', { text: tr('tasks-sync-modal-obsidian-tasks', { count: details.obsidianTasks.length }) });
          this.renderTaskTable(el, details.obsidianTasks);
        }
        if (details.caldavTasks) {
          el.createEl('h4', { text: tr('tasks-sync-modal-calendar-tasks', { count: details.caldavTasks.length }) });
          this.renderTaskTable(el, details.caldavTasks);
        }
        if (details.baselineTasks) {
          el.createEl('h4', { text: tr('tasks-sync-modal-baseline-tasks', { count: details.baselineTasks.length }) });
          this.renderTaskTable(el, details.baselineTasks);
        }
      }, true);
    }

    const hasChanges = details.toObsidian.length > 0 || details.toCalDAV.length > 0;
    if (hasChanges) {
      this.renderSection(section, t('tasks-sync-modal-changes'), (el) => {
        if (details.toObsidian.length > 0) {
          el.createEl('h4', { text: tr('tasks-sync-modal-to-obsidian', { count: details.toObsidian.length }) });
          this.renderChanges(el, details.toObsidian);
        }
        if (details.toCalDAV.length > 0) {
          el.createEl('h4', { text: tr('tasks-sync-modal-to-calendar', { count: details.toCalDAV.length }) });
          this.renderChanges(el, details.toCalDAV);
        }
      }, false);
    }

    if (details.conflictDetails.length > 0) {
      this.renderSection(section, tr('tasks-sync-modal-conflicts', { count: details.conflictDetails.length }), (el) => {
        this.renderConflicts(el, details.conflictDetails);
      }, false);
    }

    if (!hasChanges && details.conflictDetails.length === 0) {
      section.createEl('p', {
        text: t('tasks-sync-modal-no-changes'),
        cls: 'sync-no-changes',
      });
    }
  }

  private renderSummary(container: HTMLElement, result: SyncResult): void {
    const summary = container.createDiv({ cls: 'sync-summary' });

    const parts: string[] = [];

    const toObs = result.created.toObsidian + result.updated.toObsidian + result.deleted.toObsidian;
    if (toObs > 0) {
      const segments: string[] = [];
      if (result.created.toObsidian) segments.push(tr('tasks-sync-modal-summary-created', { count: result.created.toObsidian }));
      if (result.updated.toObsidian) segments.push(tr('tasks-sync-modal-summary-updated', { count: result.updated.toObsidian }));
      if (result.deleted.toObsidian) segments.push(tr('tasks-sync-modal-summary-deleted', { count: result.deleted.toObsidian }));
      parts.push(tr('tasks-sync-modal-summary-to-obsidian', { summary: segments.join(', ') }));
    }

    const toCal = result.created.toCalDAV + result.updated.toCalDAV + result.deleted.toCalDAV;
    if (toCal > 0) {
      const segments: string[] = [];
      if (result.created.toCalDAV) segments.push(tr('tasks-sync-modal-summary-created', { count: result.created.toCalDAV }));
      if (result.updated.toCalDAV) segments.push(tr('tasks-sync-modal-summary-updated', { count: result.updated.toCalDAV }));
      if (result.deleted.toCalDAV) segments.push(tr('tasks-sync-modal-summary-deleted', { count: result.deleted.toCalDAV }));
      parts.push(tr('tasks-sync-modal-summary-to-calendar', { summary: segments.join(', ') }));
    }

    if (result.conflicts > 0) {
      parts.push(tr('tasks-sync-modal-summary-conflicts', { count: result.conflicts }));
    }

    if (parts.length === 0) {
      parts.push(t('tasks-sync-modal-summary-none'));
    }

    for (const part of parts) {
      const badge = summary.createSpan({ cls: 'sync-summary-item' });
      badge.textContent = part;
    }

    if (!result.success) {
      const errorBadge = summary.createSpan({ cls: 'sync-summary-item sync-summary-error' });
      errorBadge.textContent = tr('tasks-sync-modal-summary-error', { message: result.message });
    }
  }

  private renderSection(
    container: HTMLElement,
    title: string,
    buildContent: (el: HTMLElement) => void,
    collapsed: boolean,
  ): void {
    const details = container.createEl('details', { cls: 'sync-section' });
    if (!collapsed) {
      details.setAttribute('open', '');
    }
    details.createEl('summary', { text: title, cls: 'sync-section-title' });
    const content = details.createDiv({ cls: 'sync-section-content' });
    buildContent(content);
  }

  private renderTaskTable(container: HTMLElement, tasks: CommonTask[]): void {
    if (tasks.length === 0) {
      container.createEl('p', { text: t('tasks-sync-modal-no-tasks'), cls: 'sync-empty' });
      return;
    }

    const table = container.createEl('table', { cls: 'sync-task-table' });
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    for (const header of [
      t('tasks-sync-modal-header-uid'),
      t('tasks-sync-modal-header-title'),
      t('tasks-sync-modal-header-status'),
      t('tasks-sync-modal-header-due'),
      t('tasks-sync-modal-header-priority'),
    ]) {
      headerRow.createEl('th', { text: header });
    }

    const tbody = table.createEl('tbody');
    for (const task of tasks) {
      const row = tbody.createEl('tr');
      row.createEl('td', { text: this.truncateUid(task.uid), cls: 'sync-uid', attr: { title: task.uid } });
      row.createEl('td', { text: task.title });
      row.createEl('td', { text: task.status });
      row.createEl('td', { text: task.dueDate ?? '—' });
      row.createEl('td', { text: task.priority === 'none' ? '—' : task.priority });
    }
  }

  private renderChanges(container: HTMLElement, changes: SyncChange[]): void {
    const list = container.createDiv({ cls: 'sync-changes' });

    for (const change of changes) {
      const item = list.createDiv({ cls: 'sync-change-item' });

      const badge = item.createSpan({ cls: `sync-badge sync-badge-${change.type}` });
      badge.textContent = this.getChangeTypeLabel(change.type);

      const desc = item.createSpan({ cls: 'sync-change-desc' });
      desc.textContent = change.task.title;

      const uid = item.createSpan({ cls: 'sync-change-uid' });
      uid.textContent = this.truncateUid(change.task.uid);
      uid.setAttribute('title', change.task.uid);

      if (change.type === 'update' && change.previousVersion) {
        const diff = this.describeChanges(change.previousVersion, change.task);
        if (diff) {
          const diffEl = item.createDiv({ cls: 'sync-change-diff' });
          diffEl.textContent = diff;
        }
      }
    }
  }

  private renderConflicts(container: HTMLElement, conflicts: Conflict[]): void {
    for (const conflict of conflicts) {
      const conflictEl = container.createDiv({ cls: 'sync-conflict' });

      conflictEl.createEl('h5', { text: tr('tasks-sync-modal-task', { uid: conflict.uid }) });

      const grid = conflictEl.createDiv({ cls: 'sync-conflict-grid' });

      const obsCol = grid.createDiv({ cls: 'sync-conflict-col' });
      obsCol.createEl('h6', { text: t('tasks-sync-modal-column-obsidian') });
      this.renderTaskDetail(obsCol, conflict.obsidianVersion);

      const calCol = grid.createDiv({ cls: 'sync-conflict-col' });
      calCol.createEl('h6', { text: t('tasks-sync-modal-column-calendar') });
      this.renderTaskDetail(calCol, conflict.caldavVersion);

      const baseCol = grid.createDiv({ cls: 'sync-conflict-col' });
      baseCol.createEl('h6', { text: t('tasks-sync-modal-column-baseline') });
      this.renderTaskDetail(baseCol, conflict.baselineVersion);
    }
  }

  private renderTaskDetail(container: HTMLElement, task: CommonTask): void {
    const dl = container.createEl('dl', { cls: 'sync-task-detail' });
    const fields: [string, string][] = [
      [t('tasks-sync-modal-field-title'), task.title],
      [t('tasks-sync-modal-field-status'), task.status],
      [t('tasks-sync-modal-field-due'), task.dueDate ?? '—'],
      [t('tasks-sync-modal-field-priority'), task.priority === 'none' ? '—' : task.priority],
      [t('tasks-sync-modal-field-tags'), task.tags.length > 0 ? task.tags.join(', ') : '—'],
    ];

    for (const [label, value] of fields) {
      dl.createEl('dt', { text: label });
      dl.createEl('dd', { text: value });
    }
  }

  private renderActions(container: HTMLElement): void {
    const actions = container.createDiv({ cls: 'sync-actions' });

    const onApply = this.onApply;
    if (this.isDryRun && onApply) {
      const applyBtn = actions.createEl('button', {
        text: t('tasks-sync-modal-apply'),
        cls: 'mod-cta',
      });
      applyBtn.addEventListener('click', () => {
        applyBtn.disabled = true;
        applyBtn.textContent = t('tasks-sync-modal-applying');
        onApply()
          .then((results) => {
            this.close();
            new SyncResultModal(this.app, results, false).open();
          })
          .catch(() => {
            applyBtn.textContent = t('tasks-sync-modal-apply');
            applyBtn.disabled = false;
          });
      });
    }

    const closeBtn = actions.createEl('button', { text: t('tasks-sync-modal-close') });
    closeBtn.addEventListener('click', () => this.close());
  }

  private truncateUid(uid: string): string {
    if (uid.length <= 12) return uid;
    return uid.substring(0, 8) + '…';
  }

  private describeChanges(prev: CommonTask, curr: CommonTask): string {
    const diffs: string[] = [];
    if (prev.title !== curr.title) diffs.push(t('tasks-sync-modal-diff-title'));
    if (prev.status !== curr.status) diffs.push(tr('tasks-sync-modal-diff-status', { from: prev.status, to: curr.status }));
    if (prev.dueDate !== curr.dueDate) diffs.push(tr('tasks-sync-modal-diff-due', { from: prev.dueDate ?? '—', to: curr.dueDate ?? '—' }));
    if (prev.priority !== curr.priority) diffs.push(tr('tasks-sync-modal-diff-priority', { from: prev.priority, to: curr.priority }));
    return diffs.join(', ');
  }

  private getChangeTypeLabel(type: SyncChange['type']): string {
    const keys: Record<SyncChange['type'], keyof Translation> = {
      create: 'tasks-sync-modal-change-create',
      update: 'tasks-sync-modal-change-update',
      delete: 'tasks-sync-modal-change-delete',
      complete: 'tasks-sync-modal-change-complete',
      reconcile: 'tasks-sync-modal-change-reconcile',
    };
    return t(keys[type]);
  }
}

function tr(key: keyof Translation, replacements: Record<string, string | number> = {}): string {
  let value = t(key);
  for (const [name, replacement] of Object.entries(replacements)) {
    value = value.split(`{${name}}`).join(String(replacement));
  }
  return value;
}
