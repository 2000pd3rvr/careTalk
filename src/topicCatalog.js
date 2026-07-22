/**
 * Catalogue of everything careTalk currently knows, with sources.
 */

import { KNOWLEDGE_PILLARS } from "./knowledge.js";
import { SCENARIOS } from "./flows.js";
import { SCENARIO_VISUALS } from "./visualGuides.js";
import { loadCustomKnowledge } from "./store.js";
import { loadCustomTopics } from "./store.js";
import { TRAINING_TOPICS, hasClearTrainedInstruction } from "./trainingGaps.js";

/**
 * @returns {Array<{
 *   id: string,
 *   title: string,
 *   kind: 'pillar'|'scenario'|'visual'|'home'|'capability',
 *   kindLabel: string,
 *   summary: string,
 *   source: string,
 *   sourceUrl?: string,
 *   meta?: string
 * }>}
 */
export function listDonFamiliarTopics() {
  const topics = [];

  for (const p of KNOWLEDGE_PILLARS) {
    topics.push({
      id: `pillar_${p.id}`,
      title: p.title,
      kind: "pillar",
      kindLabel: "Core training pillar",
      summary: p.notes,
      source: "Built into careTalk (UK adult social care / support-worker training themes)",
      meta: p.id,
    });
  }

  for (const s of SCENARIOS) {
    if (s.id === "general") continue;
    const hasVisuals = Boolean(SCENARIO_VISUALS[s.id]?.length);
    topics.push({
      id: `scenario_${s.id}`,
      title: s.label,
      kind: "scenario",
      kindLabel: "Care situation careTalk can guide",
      summary: `Guided advice and documentation questions for ${s.label.toLowerCase()} situations.`,
      source: "Built into careTalk (scenario playbooks)",
      meta: hasVisuals ? `${s.questions?.length || 0} questions · has pictures` : `${s.questions?.length || 0} questions`,
    });
  }

  for (const [scenarioId, imgs] of Object.entries(SCENARIO_VISUALS)) {
    topics.push({
      id: `visual_${scenarioId}`,
      title: `Visual guides — ${scenarioId}`,
      kind: "visual",
      kindLabel: "Picture guides for carers",
      summary: imgs.map((i) => i.title).join(" · "),
      source: "Built into careTalk (/guides/*.svg)",
      meta: `${imgs.length} image(s)`,
    });
  }

  for (const topic of TRAINING_TOPICS) {
    const trained = hasClearTrainedInstruction(topic, topic.label);
    topics.push({
      id: `capability_${topic.id}`,
      title: topic.label,
      kind: "capability",
      kindLabel: trained ? "Home-trained capability" : "Needs home training",
      summary: trained
        ? "careTalk has clear do/don’t guidance from Give careTalk more knowledge for this topic."
        : "careTalk will escalate to an unresolved training incident + agency email until a head nurse trains him.",
      source: trained
        ? "Home knowledge from Give careTalk more knowledge (matched keywords)"
        : "Not trained yet — gap handling built into careTalk",
      meta: trained ? "ready" : "untrained",
    });
  }

  for (const t of loadCustomTopics()) {
    topics.push({
      id: t.id,
      title: t.title,
      kind: "home",
      kindLabel: t.lastTrainedAt ? "Added topic (trained)" : "Added topic (awaiting web train)",
      summary: t.notes || `Keywords: ${(t.keywords || []).join(", ") || "—"}`,
      source: t.lastTrainedAt
        ? `Head nurse topic · last trained ${new Date(t.lastTrainedAt).toLocaleString("en-GB")}`
        : "Head nurse topic — use Fetch & train",
      meta: (t.keywords || []).join(", ") || "custom topic",
    });
  }

  for (const k of loadCustomKnowledge()) {
    const when = k.addedAt ? new Date(k.addedAt).toLocaleString("en-GB") : "";
    topics.push({
      id: k.id,
      title: k.title,
      kind: "home",
      kindLabel: "Home-trained knowledge",
      summary: k.body,
      source: k.sourceUrl
        ? `URL train / import — ${k.sourceUrl}`
        : `Added by ${k.addedBy || "Head nurse"}${when ? ` · ${when}` : ""}`,
      sourceUrl: k.sourceUrl || "",
      meta: [
        (k.keywords || []).join(", ") || "no keywords",
        k.doList?.length ? `${k.doList.length} do` : null,
        k.dontList?.length ? `${k.dontList.length} don’t` : null,
        k.images?.length ? `${k.images.length} image(s)` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  return topics;
}
