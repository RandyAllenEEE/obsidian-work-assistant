const SOURCE_PREFIX = "wa-";
const SOURCE_HEX_LENGTH = 32;

/** Deterministic, browser-safe local task identity stored on the VTODO. */
export async function createSourceId(vaultName: string, localTaskId: string): Promise<string> {
  const value = `${vaultName}${localTaskId}`;
  const bytes = new TextEncoder().encode(value);
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is required to create a stable CalDAV task source ID");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${SOURCE_PREFIX}${hex.slice(0, SOURCE_HEX_LENGTH)}`;
}

export function createRemoteUid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!globalThis.crypto?.getRandomValues) {
    for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
