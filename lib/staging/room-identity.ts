/**
 * Room identity helpers — room_key groups scenes that share one physical room.
 * Safe for client + server.
 */

import type { RoomType } from "@/lib/staging/staging-plan-shared";

const ROOM_KEY_RE = /^[a-z][a-z0-9_]{0,62}$/;

export function sanitizeRoomKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 64);
  if (!key || !ROOM_KEY_RE.test(key)) return null;
  return key;
}

/** Default key: `{room_type}_{n}` with n = 1 + count of existing keys for that type. */
export function nextRoomKey(
  roomType: RoomType,
  existingKeys: string[],
): string {
  const prefix = `${roomType}_`;
  let max = 0;
  for (const key of existingKeys) {
    if (!key.startsWith(prefix)) continue;
    const n = Number.parseInt(key.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${roomType}_${max + 1}`;
}

export function roomKeysForType(
  roomType: RoomType,
  existingKeys: string[],
): string[] {
  const prefix = `${roomType}_`;
  return existingKeys
    .filter((k) => k === roomType || k.startsWith(prefix))
    .sort();
}

export function labelRoomKey(roomKey: string): string {
  return roomKey.replace(/_/g, " ");
}
