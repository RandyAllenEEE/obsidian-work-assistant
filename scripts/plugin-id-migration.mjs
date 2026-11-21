export const LEGACY_PLUGIN_ID = 'work-assistant';
export const PLUGIN_ID = 'obsidian-work-assistant';

function migrateReference(value) {
  if (value === LEGACY_PLUGIN_ID) return PLUGIN_ID;
  if (value.startsWith(`${LEGACY_PLUGIN_ID}:`)) return PLUGIN_ID + value.slice(LEGACY_PLUGIN_ID.length);
  if (/^plugin-work-assistant(?:;|-)/.test(value)) {
    return 'plugin-' + PLUGIN_ID + value.slice(('plugin-' + LEGACY_PLUGIN_ID).length);
  }
  return value;
}

/** Migrate parsed Obsidian configuration without touching files or credentials.
 * Existing canonical keys take precedence over their legacy counterparts.
 * Saved view types and custom event names are stable compatibility interfaces.
 */
export function migratePluginIdentity(value) {
  if (typeof value === 'string') return migrateReference(value);
  if (Array.isArray(value)) return value.map(migratePluginIdentity);
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value);
  const migrated = {};
  for (const [key, item] of entries) {
    if (migrateReference(key) !== key) migrated[migrateReference(key)] = migratePluginIdentity(item);
  }
  for (const [key, item] of entries) {
    if (migrateReference(key) === key) migrated[key] = migratePluginIdentity(item);
  }
  return migrated;
}
