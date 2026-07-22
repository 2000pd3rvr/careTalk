/**
 * Wipe all careTalk device-local data and restore default admin + train PIN.
 */

import { ensureDefaultPin, markTrainAuthed } from "./store.js";
import { resetUsersToDefaultAdmin, DEFAULT_ADMIN } from "./users.js";

const SESSION_PREFIX = "don.";

export function resetDonDeviceData() {
  const keys = [];
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const k = localStorage.key(i);
    if (k && k.startsWith(SESSION_PREFIX)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);

  for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
    const k = sessionStorage.key(i);
    if (k && k.startsWith(SESSION_PREFIX)) sessionStorage.removeItem(k);
  }

  ensureDefaultPin();
  markTrainAuthed(false);
  const { user } = resetUsersToDefaultAdmin({ skipAuth: true });

  return {
    user,
    credentials: { ...DEFAULT_ADMIN },
    keysCleared: keys.length,
  };
}
