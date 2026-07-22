/**
 * Unified report list for admin Reports tab — carers, admins, outbox & pinned profiles.
 */

import { loadOutbox, readIncidents } from "./store.js";
import { listPinnedReportsForAdmin } from "./userReports.js";
import { inferReportCategory } from "./reportCategories.js";

function sameReportBody(a, b) {
  const na = String(a || "").trim();
  const nb = String(b || "").trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > 100 && nb.length > 100 && na.slice(0, 120) === nb.slice(0, 120)) return true;
  return false;
}

function pinnedReportItem(doc) {
  const at = doc.updatedAt || doc.createdAt || "";
  const body = doc.finalAgencyReport || doc.reportBody || "";
  const category = inferReportCategory({
    scenarioId: doc.scenarioId,
    scenarioLabel: doc.scenarioLabel,
    noteType: doc.noteType,
    text: doc.utterance,
    body,
  });
  const roleLabel = doc.role === "admin" ? "Admin" : "Carer";
  const kindLabel =
    doc.status === "draft"
      ? "Live report"
      : doc.source === "voice_pin"
        ? "Pinned note"
        : "Support report";

  return {
    id: doc.id,
    kind: "report",
    kindLabel,
    categoryId: category.id,
    categoryLabel: category.label,
    title:
      [doc.person, doc.scenarioLabel || category.label].filter(Boolean).join(" · ") ||
      category.label,
    status: doc.status === "draft" ? "live" : doc.status || "saved",
    at,
    body,
    meta: [
      `${roleLabel}: ${doc.userName || "—"}`,
      doc.status === "draft" ? "Updating live" : null,
      doc.userEmail,
    ]
      .filter(Boolean)
      .join(" · "),
    raw: doc,
    source: "pinned",
    sessionId: doc.sessionId || "",
    authorId: doc.userId,
    authorRole: doc.role,
  };
}

function outboxReportItem(item) {
  const category = inferReportCategory({
    scenarioLabel: item.scenario,
    text: item.report,
    body: item.report,
    person: item.person,
  });
  return {
    id: item.id,
    kind: "report",
    kindLabel: "Agency report",
    categoryId: category.id,
    categoryLabel: category.label,
    title: [item.person, item.scenario || category.label].filter(Boolean).join(" · ") || "Support-worker report",
    status: item.status || (item.channels?.length ? "sent" : "saved"),
    at: item.at || "",
    body: item.report || "",
    meta: [
      item.carer && `Carer: ${item.carer}`,
      item.agencyName && `Agency: ${item.agencyName}`,
      item.channels?.length && `Via: ${item.channels.join(", ")}`,
    ]
      .filter(Boolean)
      .join(" · "),
    raw: item,
    source: "outbox",
    sessionId: "",
    authorId: "",
    authorRole: "",
  };
}

function incidentItem(inc) {
  return {
    id: inc.id,
    kind: "gap",
    kindLabel: "Incident",
    categoryId: "training_gap",
    categoryLabel: "Training gaps",
    title: `${inc.topicLabel || "Training gap"}${inc.person ? ` — ${inc.person}` : ""}`,
    status: inc.status || "unresolved",
    at: inc.createdAt || "",
    body: [
      inc.question,
      "",
      inc.utterance ? `Carer said: ${inc.utterance}` : "",
      inc.carer ? `Reported by: ${inc.carer}` : "",
      inc.resolvedAt ? `Resolved: ${new Date(inc.resolvedAt).toLocaleString("en-GB")}` : "",
      inc.resolveNote ? `Note: ${inc.resolveNote}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    meta: [
      inc.status === "unresolved" ? "Open" : "Resolved",
      inc.agencyNotified ? "Agency notified" : null,
    ]
      .filter(Boolean)
      .join(" · "),
    raw: inc,
    source: "incident",
    sessionId: "",
    authorId: "",
    authorRole: "",
  };
}

function outboxGapItem(item) {
  const title =
    (item.report || "").split("\n").find((l) => l.startsWith("Topic:"))?.replace("Topic:", "").trim() ||
    "Training gap notified";
  return {
    id: item.id,
    kind: "gap",
    kindLabel: "Training gap",
    categoryId: "training_gap",
    categoryLabel: "Training gaps",
    title,
    status: item.status || (item.channels?.length ? "sent" : "saved"),
    at: item.at || "",
    body: item.report || "",
    meta: [
      item.carer && `Carer: ${item.carer}`,
      item.agencyName && `Agency: ${item.agencyName}`,
      item.channels?.length && `Via: ${item.channels.join(", ")}`,
    ]
      .filter(Boolean)
      .join(" · "),
    raw: item,
    source: "outbox",
    sessionId: "",
    authorId: "",
    authorRole: "",
  };
}

function dedupeReports(pinnedItems, outboxReportItems) {
  const keptPinned = [...pinnedItems];
  const keptOutbox = [];

  for (const ob of outboxReportItems) {
    const dupPinned = keptPinned.find(
      (p) =>
        (p.sessionId && ob.body?.includes(p.sessionId)) ||
        sameReportBody(p.body, ob.body) ||
        (p.at &&
          ob.at &&
          Math.abs(new Date(p.at).getTime() - new Date(ob.at).getTime()) < 120_000 &&
          p.title === ob.title),
    );
    if (dupPinned) {
      dupPinned.meta = [dupPinned.meta, "Agency outbox"].filter(Boolean).join(" · ");
      dupPinned.kindLabel = dupPinned.kindLabel === "Support report" ? "Support report · agency" : dupPinned.kindLabel;
      continue;
    }
    keptOutbox.push(ob);
  }

  return [...keptPinned, ...keptOutbox];
}

/** All report & gap rows for Reports UI (device-local; all signed-in users on this device). */
export function collectUnifiedReportItems() {
  const pinned = listPinnedReportsForAdmin().map(pinnedReportItem);

  const outbox = loadOutbox();
  const outboxReports = outbox.filter((o) => o.type !== "don.training_gap").map(outboxReportItem);
  const outboxGaps = outbox.filter((o) => o.type === "don.training_gap");

  const incidents = readIncidents().map(incidentItem);
  const incidentIds = new Set(incidents.map((i) => i.id));

  const gapFromOutbox = outboxGaps
    .filter((o) => !(o.incidentId && incidentIds.has(o.incidentId)))
    .map(outboxGapItem);

  const reports = dedupeReports(pinned, outboxReports);

  return [...incidents, ...gapFromOutbox, ...reports].sort(
    (a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime(),
  );
}
