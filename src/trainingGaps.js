/**
 * Training gap / unresolved incidents — when careTalk is asked something
 * he has no clear home-trained guidance for.
 */

import {
  loadCustomKnowledge,
  addCustomKnowledge,
  loadAgencySettings,
  pushOutbox,
  readIncidents,
  writeIncidents,
} from "./store.js";

/** Topic detectors — extend as careTalk learns more “must be trained” areas. */
export const TRAINING_TOPICS = [
  {
    id: "medication_refusal",
    label: "Medication refusal",
    match: /\b((refuse[ds]?|refusing|won'?t take|will not take|not taking|declined?|spit(?:ting)? out).{0,40}\b(medicine|medication|meds|tablet|tablets|pill|pills|dose|mar)\b|\b(medicine|medication|meds|tablet|tablets|pill|pills).{0,40}\b(refuse[ds]?|refusing|won'?t|will not|not taking|declined?)\b)/i,
    keywords: [
      "medicine",
      "medication",
      "meds",
      "refuse",
      "refusal",
      "refused",
      "tablet",
      "tablets",
      "pill",
      "mar",
    ],
  },
];

export function detectTrainingTopic(text) {
  const raw = String(text || "");
  for (const topic of TRAINING_TOPICS) {
    if (topic.match.test(raw)) return topic;
  }
  return null;
}

/**
 * Find home-trained knowledge that clearly covers this topic.
 */
export function findTrainedGuidance(topic, text = "") {
  if (!topic) return [];
  const hay = `${text} ${topic.label}`.toLowerCase();
  const list = loadCustomKnowledge();
  const scored = [];

  for (const k of list) {
    let score = 0;
    const blob = `${k.title} ${k.body} ${(k.keywords || []).join(" ")} ${(k.doList || []).join(" ")}`.toLowerCase();
    for (const kw of topic.keywords) {
      if (blob.includes(kw)) score += 2;
      if ((k.keywords || []).includes(kw)) score += 2;
    }
    // Must look like actionable refusal / medicine guidance
    if (/\b(refus|not taking|declin|won'?t take)\b/i.test(blob)) score += 3;
    if (/\b(medicine|medication|meds|tablet|mar)\b/i.test(blob)) score += 2;
    if ((k.doList || []).length >= 1) score += 2;
    if (k.body && k.body.length > 60) score += 1;
    if (score >= 5) scored.push({ entry: k, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.entry);
}

export function hasClearTrainedInstruction(topic, text = "") {
  const hits = findTrainedGuidance(topic, text);
  return hits.some((k) => (k.doList || []).length >= 1 || (k.body || "").length >= 80);
}

/** Build a freeform “unsure subject” topic for logging. */
export function topicFromUnsureSubject(label, utterance = "") {
  const raw = String(label || utterance || "this subject").trim();
  const short = raw.replace(/\s+/g, " ").slice(0, 80) || "this subject";
  const id = `unsure_${short
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "subject"}`;
  return {
    id,
    label: short,
    keywords: short
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3)
      .slice(0, 8),
    question: `careTalk was not sure about this subject: ${short}. What should carers do?`,
  };
}

/**
 * True when home-trained knowledge clearly covers this free-text subject.
 */
export function hasHomeKnowledgeForSubject(text = "") {
  const hay = String(text || "").toLowerCase();
  if (!hay || hay.split(/\s+/).length < 3) return false;
  const words = hay.split(/\W+/).filter((w) => w.length > 3);
  if (!words.length) return false;
  return loadCustomKnowledge().some((k) => {
    const blob = `${k.title} ${k.body} ${(k.keywords || []).join(" ")}`.toLowerCase();
    const hits = words.filter((w) => blob.includes(w)).length;
    return hits >= 2 && ((k.doList || []).length >= 1 || (k.body || "").length >= 60);
  });
}

export function loadIncidents() {
  return readIncidents();
}

export function saveIncidents(list) {
  writeIncidents(list);
}

export function listUnresolvedIncidents() {
  return loadIncidents().filter((i) => i.status === "unresolved");
}

export function createTrainingIncident({
  topic,
  utterance,
  person = "",
  carer = "",
}) {
  const list = loadIncidents();
  // Avoid duplicate open incidents for same topic+person in last 24h
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const existing = list.find(
    (i) =>
      i.status === "unresolved" &&
      i.topicId === topic.id &&
      (i.person || "").toLowerCase() === (person || "").toLowerCase() &&
      new Date(i.createdAt).getTime() > dayAgo,
  );
  if (existing) return { incident: existing, created: false };

  const incident = {
    id: `inc_${Date.now()}`,
    status: "unresolved",
    topicId: topic.id,
    topicLabel: topic.label,
    question:
      topic.question ||
      (topic.id === "medication_refusal"
        ? `What should carers do when ${person || "a client"} refuses / does not take their medicine?`
        : `careTalk was unsure about: ${topic.label}. What should carers do?`),
    person: person || "",
    carer: carer || "",
    utterance: String(utterance || "").trim(),
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    knowledgeId: null,
    agencyNotified: false,
  };
  list.unshift(incident);
  saveIncidents(list);
  return { incident, created: true };
}

export function resolveTrainingIncident(incidentId, knowledgeEntry) {
  const list = loadIncidents();
  const idx = list.findIndex((i) => i.id === incidentId);
  if (idx < 0) throw new Error("Incident not found");
  const saved = addCustomKnowledge({
    ...knowledgeEntry,
    keywords:
      knowledgeEntry.keywords ||
      "medicine, medication, refuse, refusal, meds, tablets",
    addedBy: knowledgeEntry.addedBy || "Head nurse (resolved incident)",
  });
  list[idx] = {
    ...list[idx],
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    resolvedBy: "Head nurse",
    knowledgeId: saved.id,
  };
  saveIncidents(list);
  return { incident: list[idx], knowledge: saved };
}

export function closeTrainingIncident(incidentId, { knowledgeId = null, note = "" } = {}) {
  const list = loadIncidents();
  const idx = list.findIndex((i) => i.id === incidentId);
  if (idx < 0) throw new Error("Incident not found");
  list[idx] = {
    ...list[idx],
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    resolvedBy: "Head nurse",
    knowledgeId,
    resolveNote: note,
  };
  saveIncidents(list);
  return list[idx];
}

/**
 * Email / webhook the agency that careTalk hit an untrained question.
 */
export async function reportTrainingGapToAgency(incident) {
  const agency = loadAgencySettings();
  const report = [
    "careTalk — TRAINING REQUEST (UNRESOLVED)",
    "===================================",
    `Incident id: ${incident.id}`,
    `Topic: ${incident.topicLabel}`,
    `Question careTalk could not answer from training:`,
    incident.question,
    "",
    `Person / client: ${incident.person || "—"}`,
    `Reported by carer: ${incident.carer || "—"}`,
    `Carer said: ${incident.utterance || "—"}`,
    `Logged: ${new Date(incident.createdAt).toLocaleString("en-GB")}`,
    "",
    "careTalk told the carer he will ask for training on this.",
    "Please open Give careTalk more knowledge in careTalk, resolve this incident, and add clear do/don’t guidance.",
    "",
    `Agency: ${agency.name}`,
  ].join("\n");

  const packet = {
    id: `gap_${Date.now()}`,
    type: "don.training_gap",
    at: new Date().toISOString(),
    incidentId: incident.id,
    agencyName: agency.name,
    agencyEmail: agency.email,
    report,
    channels: ["outbox"],
  };

  if (agency.webhookUrl) {
    try {
      const res = await fetch(agency.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(packet),
      });
      if (res.ok) packet.channels.push("webhook");
    } catch (err) {
      packet.webhookError = err?.message || "webhook failed";
    }
  }

  if (agency.email) {
    const subject = encodeURIComponent(
      `careTalk needs training — ${incident.topicLabel}${incident.person ? ` — ${incident.person}` : ""}`,
    );
    const body = encodeURIComponent(report.slice(0, 1800));
    const mailto = `mailto:${encodeURIComponent(agency.email)}?subject=${subject}&body=${body}`;
    packet.mailto = mailto;
    packet.channels.push("email");
    try {
      const a = document.createElement("a");
      a.href = mailto;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      /* ignore */
    }
  }

  pushOutbox(packet);

  // Mark notified on incident
  const list = loadIncidents();
  const idx = list.findIndex((i) => i.id === incident.id);
  if (idx >= 0) {
    list[idx].agencyNotified = true;
    saveIncidents(list);
  }

  return { packet, agency, report };
}
