/**
 * Landing-page update subscribers (device-local) + discreet ops admin auth.
 * Password is never stored in plaintext — only a client-side hash is checked.
 */

export const APP_VERSION = "1.1.13";
export const SUBSCRIBERS_KEY = "caretalk.landing.subscribers";
export const ADMIN_SESSION_KEY = "caretalk.updates.authed";

/** Public username only — password hash is verified client-side (not shown on the site). */
export const UPDATES_ADMIN_USER = "caretalk.ops";

/** FNV-1a style hash of `caretalk.updates|<password>` for the ops password. */
const UPDATES_ADMIN_PASS_HASH = "b5879926";

function hashSecret(value) {
  const s = `caretalk.updates|${String(value || "").trim()}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function readSubscribers() {
  try {
    const raw = localStorage.getItem(SUBSCRIBERS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function writeSubscribers(list) {
  localStorage.setItem(SUBSCRIBERS_KEY, JSON.stringify(list.slice(0, 500)));
}

export function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

export function isValidEmail(email) {
  const e = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 160;
}

/**
 * @returns {{ ok: true, entry: object, created: boolean } | { ok: false, error: string }}
 */
export function addSubscriber({ email, name = "", source = "landing" } = {}) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const list = readSubscribers();
  const existing = list.find((row) => row.email === normalized);
  if (existing) {
    return { ok: true, entry: existing, created: false };
  }

  const entry = {
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    email: normalized,
    name: String(name || "").trim().slice(0, 80),
    at: new Date().toISOString(),
    version: APP_VERSION,
    source,
  };
  writeSubscribers([entry, ...list]);
  return { ok: true, entry, created: true };
}

export function removeSubscriber(id) {
  const next = readSubscribers().filter((row) => row.id !== id);
  writeSubscribers(next);
  return next;
}

export function clearSubscribers() {
  writeSubscribers([]);
}

export function isUpdatesAdminAuthed() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
}

export function signInUpdatesAdmin(username, password) {
  const user = String(username || "").trim().toLowerCase();
  const pass = String(password || "");
  if (user !== UPDATES_ADMIN_USER.toLowerCase()) {
    return { ok: false, error: "Incorrect username or password." };
  }
  if (hashSecret(pass) !== UPDATES_ADMIN_PASS_HASH) {
    return { ok: false, error: "Incorrect username or password." };
  }
  sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
  return { ok: true };
}

export function signOutUpdatesAdmin() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

export function subscribersToCsv(list = readSubscribers()) {
  const header = "email,name,subscribed_at,version,source";
  const rows = list.map((row) =>
    [row.email, row.name || "", row.at || "", row.version || "", row.source || ""]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header, ...rows].join("\n");
}
