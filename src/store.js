const KEYS = {
  pinHash: "don.train.pinHash",
  pinSet: "don.train.pinSet",
  sessionAuth: "don.train.authed",
  knowledge: "don.train.knowledge",
  agency: "don.agency",
  outbox: "don.agency.outbox",
  incidents: "don.train.incidents",
  customTopics: "don.train.customTopics",
};

const DEFAULT_PIN = "2473";

function hashPin(pin) {
  // Lightweight client-side hash (not cryptographic security — blocks casual access)
  const s = `don|${String(pin || "").trim()}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function isPinConfigured() {
  return localStorage.getItem(KEYS.pinSet) === "1";
}

export function ensureDefaultPin() {
  if (!isPinConfigured()) {
    localStorage.setItem(KEYS.pinHash, hashPin(DEFAULT_PIN));
    localStorage.setItem(KEYS.pinSet, "1");
  }
}

export function verifyTrainPin(pin) {
  ensureDefaultPin();
  const expected = localStorage.getItem(KEYS.pinHash) || hashPin(DEFAULT_PIN);
  return hashPin(pin) === expected;
}

export function setTrainPin(newPin) {
  const p = String(newPin || "").trim();
  if (p.length < 4) throw new Error("PIN must be at least 4 digits");
  localStorage.setItem(KEYS.pinHash, hashPin(p));
  localStorage.setItem(KEYS.pinSet, "1");
}

export function markTrainAuthed(on) {
  if (on) sessionStorage.setItem(KEYS.sessionAuth, "1");
  else sessionStorage.removeItem(KEYS.sessionAuth);
}

export function isTrainAuthed() {
  return sessionStorage.getItem(KEYS.sessionAuth) === "1";
}

export function loadCustomKnowledge() {
  return readJson(KEYS.knowledge, []);
}

export function saveCustomKnowledge(entries) {
  writeJson(KEYS.knowledge, entries);
}

export function addCustomKnowledge(entry) {
  const list = loadCustomKnowledge();
  const asLines = (v) =>
    Array.isArray(v)
      ? v.map((x) => String(x).trim()).filter(Boolean)
      : String(v || "")
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);

  const row = {
    id: `k_${Date.now()}`,
    title: String(entry.title || "").trim(),
    body: String(entry.body || "").trim(),
    doList: asLines(entry.doList),
    dontList: asLines(entry.dontList),
    keywords: String(entry.keywords || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
    sourceUrl: String(entry.sourceUrl || "").trim(),
    images: Array.isArray(entry.images)
      ? entry.images.map((x) => String(x).trim()).filter(Boolean)
      : String(entry.images || "")
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean),
    addedBy: entry.addedBy || "Head nurse",
    addedAt: new Date().toISOString(),
  };
  if (!row.title || !row.body) throw new Error("Title and guidance text are required");
  list.unshift(row);
  saveCustomKnowledge(list);
  return row;
}

export function removeCustomKnowledge(id) {
  saveCustomKnowledge(loadCustomKnowledge().filter((x) => x.id !== id));
}

export function loadAgencySettings() {
  return readJson(KEYS.agency, {
    name: "Care agency",
    email: "",
    webhookUrl: "",
    autoForward: true,
  });
}

export function saveAgencySettings(settings) {
  writeJson(KEYS.agency, {
    name: String(settings.name || "Care agency").trim() || "Care agency",
    email: String(settings.email || "").trim(),
    webhookUrl: String(settings.webhookUrl || "").trim(),
    autoForward: settings.autoForward !== false,
  });
}

export function loadOutbox() {
  return readJson(KEYS.outbox, []);
}

export function pushOutbox(item) {
  const list = loadOutbox();
  list.unshift(item);
  writeJson(KEYS.outbox, list.slice(0, 50));
}

export function readIncidents() {
  return readJson(KEYS.incidents, []);
}

export function writeIncidents(list) {
  writeJson(KEYS.incidents, Array.isArray(list) ? list : []);
}

export function loadCustomTopics() {
  return readJson(KEYS.customTopics, []);
}

export function saveCustomTopics(list) {
  writeJson(KEYS.customTopics, Array.isArray(list) ? list : []);
}

export function addCustomTopic({ title, keywords = "", notes = "" }) {
  const t = String(title || "").trim();
  if (!t) throw new Error("Topic title is required");
  const list = loadCustomTopics();
  const row = {
    id: `topic_${Date.now()}`,
    title: t,
    keywords: String(keywords || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
    notes: String(notes || "").trim(),
    addedAt: new Date().toISOString(),
    lastTrainedAt: null,
  };
  list.unshift(row);
  saveCustomTopics(list);
  return row;
}

export function removeCustomTopic(id) {
  saveCustomTopics(loadCustomTopics().filter((x) => x.id !== id));
}

export function markCustomTopicTrained(id) {
  const list = loadCustomTopics();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return;
  list[idx].lastTrainedAt = new Date().toISOString();
  saveCustomTopics(list);
}

export { DEFAULT_PIN };
