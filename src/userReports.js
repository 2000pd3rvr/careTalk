/**
 * Voice-pinned reports under signed-in user profiles + presence for admin dashboard.
 * Device-local storage (same browser as careTalk).
 */

import { structureCareNote } from "./parseNote.js";
import { stripWake, detectPerson, detectScenario } from "./flows.js";
import { getCurrentUser, getCurrentUserId, listApprovedCarers, loadUsers } from "./users.js";

const KEYS = {
  reports: "don.user.pinnedReports",
  presence: "don.user.presence",
};

const LIVE_ACTIVE_KEY = "don.liveReport.activeId";

const PRESENCE_TTL_MS = 20 * 60 * 1000;

/** ASR-friendly: document, doument, take note, put on file, star on file, etc. */
export const PIN_DOCUMENT_RE =
  /\b(documents?|douments?|record(?:ing)?|take (?:a )?notes?|make (?:a )?notes?|jot (?:this |it )?down|put (?:this |it )?(?:on file|in (?:the )?file)|(?:on|to) file|(?:star|asterisk|\*) on file|pin (?:this |it )?(?:on file|to my file)?|log (?:this|it|that)|write (?:this |it )?up|for (?:the )?(?:file|records?)|handover note|care note|note (?:this|that|down))\b/i;

/** Explicit “make / write a report” — take the report, no training-gap gate. */
export const REPORT_REQUEST_RE =
  /\b(make (?:me |a |the )?reports?|write (?:me |a |the )?reports?|need (?:a |the )?reports?|(?:want|need) to (?:make |write )?(?:a )?reports?|do (?:a |the )?reports?|start (?:the |a )?reports?|(?:take|get) (?:a |the )?reports?|reports? for (?:the )?agency|support[- ]worker reports?|agency reports?|fill (?:in |out )?(?:the )?reports?|complete (?:the )?reports?|just (?:the )?reports?|(?:only )?reports?\b)\b/i;

export function matchesPinDocumentIntent(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const payload = stripWake(raw) || raw;
  return PIN_DOCUMENT_RE.test(raw) || PIN_DOCUMENT_RE.test(payload);
}

export function matchesFullReportRequest(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const payload = stripWake(raw) || raw;
  return REPORT_REQUEST_RE.test(raw) || REPORT_REQUEST_RE.test(payload);
}

/** Any documentation / report ask (pin note or full agency report). */
export function matchesReportIntent(text) {
  return matchesPinDocumentIntent(text) || matchesFullReportRequest(text);
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

function noteTypeFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(handover|next shift)\b/.test(t)) return "handover";
  if (/\b(incident|near miss|safeguard)\b/.test(t)) return "incident";
  if (/\b(family|relative)\b/.test(t)) return "family";
  return "wellbeing";
}

export function buildPinnedReportBody(utterance, { person = "", session = null } = {}) {
  const raw = String(utterance || "").trim();
  const cleaned = stripWake(raw) || raw;
  const who = person || session?.person || detectPerson(cleaned) || "";
  const noteType = noteTypeFromText(cleaned);
  const structured = structureCareNote(cleaned, noteType);

  const lines = [
    "PINNED CARE NOTE — careTalk",
    "========================",
    `Captured: ${new Date().toLocaleString("en-GB")}`,
    `Service user: ${who || structured.resident || "—"}`,
    "",
    "VOICE (verbatim)",
    cleaned,
    "",
    "STRUCTURED SUMMARY",
    structured.narrative || cleaned,
  ];

  if (structured.flags?.length) {
    lines.push("", "FLAGS", structured.flags.join("; "));
  }

  if (session?.scenarioLabel) {
    lines.push("", `Related session: ${session.scenarioLabel} (${session.id || "—"})`);
  }

  return {
    body: lines.join("\n"),
    person: who || structured.resident || "",
    noteType,
    structured,
  };
}

export function loadPinnedReports() {
  return readJson(KEYS.reports, []);
}

export function savePinnedReports(list) {
  writeJson(KEYS.reports, Array.isArray(list) ? list.slice(0, 500) : []);
}

function setActiveLiveReportId(userId, reportId) {
  if (!userId) return;
  if (reportId) {
    sessionStorage.setItem(LIVE_ACTIVE_KEY, reportId);
    sessionStorage.setItem(`${LIVE_ACTIVE_KEY}.user`, userId);
  } else {
    sessionStorage.removeItem(LIVE_ACTIVE_KEY);
    sessionStorage.removeItem(`${LIVE_ACTIVE_KEY}.user`);
  }
}

export function getActiveLiveReportId(userId = getCurrentUser()?.id) {
  if (!userId) return "";
  const owner = sessionStorage.getItem(`${LIVE_ACTIVE_KEY}.user`);
  const id = sessionStorage.getItem(LIVE_ACTIVE_KEY) || "";
  if (!id || owner !== userId) return "";
  const doc = loadPinnedReports().find((d) => d.id === id && d.userId === userId && d.status === "draft");
  return doc ? id : "";
}

function rebuildLiveReportBody(doc) {
  const chunks = Array.isArray(doc.liveChunks) ? doc.liveChunks : [];
  const person = doc.person || "—";
  const statusLabel = doc.status === "draft" ? "IN PROGRESS — UPDATES AS YOU SPEAK" : "FINAL";
  const lines = [
    "LIVE SUPPORT WORKER REPORT — careTalk",
    "================================",
    `Status: ${statusLabel}`,
    `Carer: ${doc.userName || "—"}`,
    `Service user: ${person}`,
    `Started: ${doc.createdAt ? new Date(doc.createdAt).toLocaleString("en-GB") : "—"}`,
    `Last updated: ${doc.updatedAt ? new Date(doc.updatedAt).toLocaleString("en-GB") : "—"}`,
  ];
  if (doc.scenarioLabel) lines.push(`Topic: ${doc.scenarioLabel}`);
  if (doc.sessionId) lines.push(`Session: ${doc.sessionId}`);

  lines.push("", "VOICE CAPTURE (LIVE)", "");
  if (chunks.length) {
    chunks.forEach((c, i) => {
      const t = c.at ? new Date(c.at).toLocaleTimeString("en-GB") : "";
      lines.push(`${i + 1}. [${t}] ${c.text}`);
    });
  } else {
    lines.push("—");
  }

  if (doc.structuredSummary) {
    lines.push("", "STRUCTURED (AUTO)", doc.structuredSummary);
  }

  if (doc.structuredAnswers?.length) {
    lines.push("", "CONFIRMED RECORD LINES", ...doc.structuredAnswers);
  }

  if (doc.finalAgencyReport) {
    lines.push("", "AGENCY REPORT (FINAL)", doc.finalAgencyReport);
  }

  return lines.join("\n");
}

function upsertDoc(list, doc) {
  const idx = list.findIndex((d) => d.id === doc.id);
  if (idx >= 0) list[idx] = doc;
  else list.unshift(doc);
  savePinnedReports(list);
  return doc;
}

/**
 * Create a draft report immediately when the carer asks to make a report.
 */
export function startLiveReport({ opening = "", session = null } = {}) {
  const user = getCurrentUser();
  if (!user) return null;

  const existingId = getActiveLiveReportId(user.id);
  if (existingId) {
    return loadPinnedReports().find((d) => d.id === existingId) || null;
  }

  const cleaned = stripWake(String(opening || "").trim()) || String(opening || "").trim();
  const now = new Date().toISOString();
  const person = session?.person || detectPerson(cleaned) || "";
  const noteType = noteTypeFromText(cleaned);
  const structured = cleaned ? structureCareNote(cleaned, noteType) : null;
  const scenario = session?.scenarioId
    ? { id: session.scenarioId, label: session.scenarioLabel }
    : detectScenario(cleaned);

  const doc = {
    id: `live_${Date.now()}`,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    role: user.role,
    createdAt: now,
    updatedAt: now,
    utterance: cleaned,
    person: person || structured?.resident || "",
    noteType,
    status: "draft",
    source: "live_report",
    pinned: true,
    sessionId: session?.id || null,
    scenarioId: scenario?.id || session?.scenarioId || "",
    scenarioLabel: session?.scenarioLabel || scenario?.label || "",
    liveChunks: cleaned ? [{ at: now, text: cleaned }] : [],
    structuredSummary: structured?.narrative || "",
    structuredAnswers: [],
    finalAgencyReport: "",
    reportBody: "",
  };
  doc.reportBody = rebuildLiveReportBody(doc);

  const list = loadPinnedReports();
  upsertDoc(list, doc);
  setActiveLiveReportId(user.id, doc.id);
  touchUserPresence({ user, mode: "learn" });
  return doc;
}

export function appendLiveReportChunk(reportId, utterance, { session = null } = {}) {
  const user = getCurrentUser();
  if (!user || !reportId) return null;

  const cleaned = stripWake(String(utterance || "").trim()) || String(utterance || "").trim();
  if (!cleaned) return null;

  const list = loadPinnedReports();
  const idx = list.findIndex((d) => d.id === reportId && d.userId === user.id);
  if (idx < 0) return null;

  const doc = { ...list[idx] };
  if (doc.status !== "draft") return doc;

  const chunks = Array.isArray(doc.liveChunks) ? [...doc.liveChunks] : [];
  const last = chunks[chunks.length - 1];
  if (!last || last.text.toLowerCase() !== cleaned.toLowerCase()) {
    chunks.push({ at: new Date().toISOString(), text: cleaned });
  }

  doc.liveChunks = chunks;
  doc.updatedAt = new Date().toISOString();
  doc.utterance = cleaned;
  if (session?.person) doc.person = session.person;
  else if (!doc.person) {
    const p = detectPerson(cleaned);
    if (p) doc.person = p;
  }
  if (session?.id) doc.sessionId = session.id;
  if (session?.scenarioId) doc.scenarioId = session.scenarioId;
  if (session?.scenarioLabel) doc.scenarioLabel = session.scenarioLabel;

  const merged = chunks.map((c) => c.text).join(" ");
  const structured = structureCareNote(merged, doc.noteType || "wellbeing");
  doc.structuredSummary = structured.narrative || merged;
  doc.reportBody = rebuildLiveReportBody(doc);

  upsertDoc(list, doc);
  touchUserPresence({ user, mode: "learn" });
  return doc;
}

export function syncLiveReportFromSession(session) {
  if (!session?.liveReportId) return null;
  const user = getCurrentUser();
  if (!user) return null;

  const list = loadPinnedReports();
  const idx = list.findIndex((d) => d.id === session.liveReportId && d.userId === user.id);
  if (idx < 0) return null;

  const doc = { ...list[idx] };
  doc.person = session.person || doc.person;
  doc.sessionId = session.id;
  doc.scenarioId = session.scenarioId || doc.scenarioId;
  doc.scenarioLabel = session.scenarioLabel || doc.scenarioLabel;
  doc.updatedAt = new Date().toISOString();

  const answers = session.answers || {};
  doc.structuredAnswers = Object.entries(answers)
    .filter(([, v]) => String(v || "").trim())
    .map(([, v]) => String(v).trim());

  const merged = [
    session.opening,
    ...(session.voiceNotes || []).map((v) => v.text),
    ...doc.structuredAnswers,
  ]
    .filter(Boolean)
    .join(" ");
  if (merged) {
    const structured = structureCareNote(merged, doc.noteType || "wellbeing");
    doc.structuredSummary = structured.narrative || merged;
  }

  doc.reportBody = rebuildLiveReportBody(doc);
  upsertDoc(list, doc);
  return doc;
}

export function finalizeLiveReport(reportId, finalAgencyReport = "") {
  const user = getCurrentUser();
  if (!user || !reportId) return null;

  const list = loadPinnedReports();
  const idx = list.findIndex((d) => d.id === reportId && d.userId === user.id);
  if (idx < 0) return null;

  const doc = { ...list[idx] };
  doc.status = "final";
  doc.updatedAt = new Date().toISOString();
  doc.finalAgencyReport = String(finalAgencyReport || "").trim();
  if (doc.finalAgencyReport) doc.reportBody = doc.finalAgencyReport;
  else doc.reportBody = rebuildLiveReportBody(doc);

  upsertDoc(list, doc);
  setActiveLiveReportId(user.id, "");
  return doc;
}

/** Start or append while carer is dictating a report. */
export function ingestLiveReportSpeech(utterance, { session = null, startIfReportAsk = true } = {}) {
  const user = getCurrentUser();
  if (!user) return null;

  const reportAsk = matchesFullReportRequest(utterance);
  const inReportSession = Boolean(session?.liveReportId || session?.reportOnly);
  let id = session?.liveReportId || getActiveLiveReportId(user.id);

  if (!id && startIfReportAsk && reportAsk) {
    return startLiveReport({ opening: utterance, session });
  }
  if (!id && inReportSession && session) {
    const started = startLiveReport({ opening: session.opening || utterance, session });
    id = started?.id;
    if (id) session.liveReportId = id;
  }
  if (id) {
    if (session && !session.liveReportId) session.liveReportId = id;
    return appendLiveReportChunk(id, utterance, { session });
  }
  return null;
}

/**
 * Pin a voice utterance to the current user's profile.
 * @returns {{ pinned: boolean, doc?: object, reason?: string }}
 */
export function pinUserReportFromUtterance(utterance, ctx = {}) {
  const user = getCurrentUser();
  if (!user) return { pinned: false, reason: "not_signed_in" };
  if (!matchesPinDocumentIntent(utterance)) return { pinned: false, reason: "no_intent" };

  const cleaned = stripWake(String(utterance || "").trim()) || String(utterance || "").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 3) return { pinned: false, reason: "too_short" };

  const slots = ctx.slots || {};
  const { body, person, noteType } = buildPinnedReportBody(utterance, {
    person: slots.person || ctx.person,
    session: ctx.session,
  });
  const scenario = ctx.session?.scenarioId
    ? { id: ctx.session.scenarioId, label: ctx.session.scenarioLabel }
    : detectScenario(cleaned);

  const doc = {
    id: `pin_${Date.now()}`,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    role: user.role,
    createdAt: new Date().toISOString(),
    utterance: cleaned,
    person,
    noteType,
    reportBody: body,
    source: ctx.source || "voice_pin",
    pinned: true,
    sessionId: ctx.session?.id || null,
    scenarioId: scenario?.id || "",
    scenarioLabel: scenario?.label || ctx.session?.scenarioLabel || "",
  };

  const list = loadPinnedReports();
  list.unshift(doc);
  savePinnedReports(list);
  touchUserPresence({ mode: ctx.mode || "learn" });

  return { pinned: true, doc };
}

export function pinUserReportFromSession(session, reportText) {
  const user = getCurrentUser();
  if (!user || !session) return null;

  if (session.liveReportId) {
    return finalizeLiveReport(session.liveReportId, String(reportText || "").trim());
  }

  const doc = {
    id: `pin_${Date.now()}`,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    role: user.role,
    createdAt: new Date().toISOString(),
    utterance: session.opening || "",
    person: session.person || "",
    noteType: "incident",
    reportBody: String(reportText || "").trim(),
    source: "session_complete",
    pinned: true,
    sessionId: session.id,
    scenarioId: session.scenarioId || "",
    scenarioLabel: session.scenarioLabel,
  };

  const list = loadPinnedReports();
  const dupe = list.find(
    (d) => d.sessionId === session.id && d.source === "session_complete" && d.userId === user.id,
  );
  if (dupe) return dupe;

  list.unshift(doc);
  savePinnedReports(list);
  return doc;
}

export function listPinnedReportsForUser(userId) {
  return loadPinnedReports()
    .filter((d) => d.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function listPinnedReportsForAdmin() {
  return loadPinnedReports().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function loadPresenceMap() {
  return readJson(KEYS.presence, {});
}

function savePresenceMap(map) {
  writeJson(KEYS.presence, map && typeof map === "object" ? map : {});
}

export function touchUserPresence({ user = getCurrentUser(), mode = "learn" } = {}) {
  if (!user?.id) return;
  const map = loadPresenceMap();
  map[user.id] = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mode,
    at: new Date().toISOString(),
  };
  savePresenceMap(map);
}

export function clearUserPresence(userId) {
  if (!userId) return;
  const map = loadPresenceMap();
  delete map[userId];
  savePresenceMap(map);
}

/** Approved carers (and admins in learn) seen on this device within TTL. */
export function getActivePresence({ withinMs = PRESENCE_TTL_MS } = {}) {
  const now = Date.now();
  const map = loadPresenceMap();
  return Object.values(map)
    .filter((row) => {
      if (!row?.at) return false;
      if (now - new Date(row.at).getTime() > withinMs) return false;
      return row.role === "carer" || row.role === "admin";
    })
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

export function getPinnedReportById(id) {
  return loadPinnedReports().find((d) => d.id === id) || null;
}

export function getLoggedInUsersForAdmin() {
  const currentId = getCurrentUserId();
  const current = getCurrentUser();
  const presence = getActivePresence();
  const allDocs = listPinnedReportsForAdmin();
  const map = new Map();

  function ensure(userId, seed) {
    if (!map.has(userId)) {
      map.set(userId, {
        userId,
        userName: seed.userName || "Unknown",
        userEmail: seed.userEmail || "",
        role: seed.role || "carer",
        loggedIn: false,
        activeNow: false,
        lastSeenAt: seed.lastSeenAt || "",
        lastMode: seed.lastMode || "",
        documents: [],
      });
    }
    const row = map.get(userId);
    if (seed.userName) row.userName = seed.userName;
    if (seed.userEmail) row.userEmail = seed.userEmail;
    if (seed.role) row.role = seed.role;
    if (seed.lastSeenAt) row.lastSeenAt = seed.lastSeenAt;
    if (seed.lastMode) row.lastMode = seed.lastMode;
    return row;
  }

  for (const p of presence) {
    const u = ensure(p.userId, {
      userName: p.name,
      userEmail: p.email,
      role: p.role,
      lastSeenAt: p.at,
      lastMode: p.mode,
    });
    u.activeNow = true;
  }

  if (current && current.status === "approved") {
    const u = ensure(current.id, {
      userName: current.name,
      userEmail: current.email,
      role: current.role,
      lastMode: "signed in",
    });
    u.loggedIn = currentId === current.id;
    if (u.loggedIn) {
      u.activeNow = true;
      u.lastSeenAt = u.lastSeenAt || new Date().toISOString();
    }
  }

  const list = [...map.values()].filter((u) => u.loggedIn || u.activeNow);
  for (const u of list) {
    u.documents = allDocs.filter((d) => d.userId === u.userId);
  }

  return list.sort((a, b) => {
    if (a.loggedIn !== b.loggedIn) return a.loggedIn ? -1 : 1;
    return new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0);
  });
}

function listApprovedReportAuthors() {
  const byId = new Map(listApprovedCarers().map((u) => [u.id, u]));
  for (const u of loadUsers()) {
    if (u.status === "approved" && u.role === "admin" && !byId.has(u.id)) {
      byId.set(u.id, u);
    }
  }
  return [...byId.values()];
}

export function getCarerAccountsForAdmin() {
  const currentId = getCurrentUserId();
  const presence = getActivePresence();
  const presenceById = new Map(presence.map((p) => [p.userId, p]));
  const allDocs = listPinnedReportsForAdmin();

  const carers = listApprovedReportAuthors().map((u) => {
    const pres = presenceById.get(u.id);
    const loggedIn = currentId === u.id;
    const activeNow = loggedIn || Boolean(pres);
    return {
      userId: u.id,
      userName: u.name,
      userEmail: u.email,
      role: u.role,
      status: u.status,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt,
      approvedAt: u.approvedAt,
      loggedIn,
      activeNow,
      lastSeenAt: pres?.at || (loggedIn ? new Date().toISOString() : ""),
      lastMode: pres?.mode || (loggedIn ? "signed in" : ""),
      documents: allDocs
        .filter((d) => d.userId === u.id)
        .sort((a, b) => {
          const ad = a.status === "draft" ? 1 : 0;
          const bd = b.status === "draft" ? 1 : 0;
          if (bd !== ad) return bd - ad;
          return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
        }),
    };
  });

  return carers.sort((a, b) => {
    if (a.loggedIn !== b.loggedIn) return a.loggedIn ? -1 : 1;
    if (a.activeNow !== b.activeNow) return a.activeNow ? -1 : 1;
    if (b.documents.length !== a.documents.length) return b.documents.length - a.documents.length;
    return (a.userName || "").localeCompare(b.userName || "");
  });
}

export function getAdminUserDashboard() {
  const carerAccounts = getCarerAccountsForAdmin();
  const loggedInUsers = getLoggedInUsersForAdmin();
  const docs = listPinnedReportsForAdmin();
  return {
    carerAccounts,
    loggedInUsers,
    presence: getActivePresence(),
    totalPinned: docs.length,
  };
}
