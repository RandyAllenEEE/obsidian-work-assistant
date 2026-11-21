import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratePluginIdentity } from './plugin-id-migration.mjs';

test('migrates startup policies, commands, saved plugin owners and status bar preferences', () => {
  const old = {
    policies: { 'work-assistant': { startupType: 'long' } },
    hotkeys: { 'work-assistant:open-daily-note': [{ modifiers: ['Ctrl'], key: 'D' }] },
    state: { type: 'work-assistant-assistant', plugin: 'work-assistant' },
    ribbon: { 'work-assistant:打开日常笔记': false },
    status: { 'plugin-work-assistant;1': { position: 3, visible: false } },
    server: { passwordSecretId: 'unchanged-secret-id', username: 'kept', serverUrl: 'https://example.test' }
  };
  const next = migratePluginIdentity(old);
  assert.deepEqual(next.policies, { 'obsidian-work-assistant': { startupType: 'long' } });
  assert.deepEqual(next.hotkeys['obsidian-work-assistant:open-daily-note'], old.hotkeys['work-assistant:open-daily-note']);
  assert.deepEqual(next.state, { type: 'work-assistant-assistant', plugin: 'obsidian-work-assistant' });
  assert.equal(next.ribbon['obsidian-work-assistant:打开日常笔记'], false);
  assert.deepEqual(next.status['plugin-obsidian-work-assistant;1'], { position: 3, visible: false });
  assert.deepEqual(next.server, old.server);
  assert.equal(old.state.plugin, 'work-assistant');
});

test('preserves canonical preferences and remains idempotent', () => {
  const original = { policies: { 'obsidian-work-assistant': { startupType: 'instant' }, 'work-assistant': { startupType: 'long' } } };
  const once = migratePluginIdentity(original);
  assert.deepEqual(once.policies, { 'obsidian-work-assistant': { startupType: 'instant' } });
  assert.deepEqual(migratePluginIdentity(once), once);
});

test('migrates enabled lists and compound status identifiers but preserves stable view types', () => {
  assert.deepEqual(migratePluginIdentity(['work-assistant', 'dataview']), ['obsidian-work-assistant', 'dataview']);
  assert.deepEqual(migratePluginIdentity({ 'plugin-work-assistant-statusbar-pomo;1': 4, 'work-assistant-assistant': { id: 'work-assistant-assistant' } }), { 'plugin-obsidian-work-assistant-statusbar-pomo;1': 4, 'work-assistant-assistant': { id: 'work-assistant-assistant' } });
});
