/**
 * Report grouping for the admin Reports tab (falls, safeguarding, etc.).
 */

import { detectScenario, SCENARIOS } from "./flows.js";

/** Display order — first match wins when inferring from text. */
export const REPORT_CATEGORY_DEFS = [
  {
    id: "safeguarding",
    label: "Safeguarding / abuse",
    match: /\b(abuse|abusive|safeguard(?:ing)?|allegation|neglect|exploit|inappropriate touch|rough handling|unexplained (?:injur|bruise)|cqc concern)\b/i,
  },
  {
    id: "fall",
    label: "Falls",
    match: /\b(fall|fell|fallen|slipped|trip(?:ped)?)\b/i,
  },
  {
    id: "dysphagia",
    label: "Eating / swallowing",
    match: /\b(chok(?:e|ing)?|swallow|dysphagia|coughing (?:on|while) (?:eat|drink)|aspirat)/i,
  },
  {
    id: "distress",
    label: "Behaviour & distress",
    match: /\b(distress|agitated|aggression|hitting|ligature|self[- ]harm|restrain|mapa|pmva|difficult|challenging|behaviour|behavior)\b/i,
  },
  {
    id: "medication",
    label: "Medication",
    match:
      /\b((refuse[ds]?|refusing|won'?t take|will not take|not taking|declined?).{0,40}\b(medicine|medication|meds|tablet|tablets|pill|pills|dose)\b|\b(medicine|medication|meds|tablet|tablets|pill|pills).{0,40}\b(refuse[ds]?|refusing|won'?t|not taking|declined?)\b|\b(medication|medicine|meds|mar)\b)/i,
  },
  {
    id: "skin",
    label: "Skin & wounds",
    match: /\b(skin|pressure|sore|redness|bruise|wound|mark|ulcer)\b/i,
  },
  {
    id: "wellbeing",
    label: "Wellbeing",
    match: /\b(wellbeing|well-being|mood|check(?:ed)? on|handover|next shift)\b/i,
  },
  {
    id: "general",
    label: "General care",
    match: /./,
  },
];

const SCENARIO_TO_CATEGORY = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.id]));

export function categoryMeta(categoryId) {
  const def = REPORT_CATEGORY_DEFS.find((c) => c.id === categoryId);
  if (def) return { id: def.id, label: def.label };
  const scenario = SCENARIOS.find((s) => s.id === categoryId);
  if (scenario) return { id: scenario.id, label: scenario.label };
  return { id: "general", label: "General care" };
}

export function categorySortIndex(categoryId) {
  const idx = REPORT_CATEGORY_DEFS.findIndex((c) => c.id === categoryId);
  return idx >= 0 ? idx : REPORT_CATEGORY_DEFS.length;
}

/**
 * @param {{ scenarioId?: string, scenarioLabel?: string, noteType?: string, text?: string, body?: string }} hints
 */
export function inferReportCategory(hints = {}) {
  const scenarioId = hints.scenarioId || "";
  if (scenarioId && scenarioId !== "general" && SCENARIO_TO_CATEGORY[scenarioId]) {
    return categoryMeta(scenarioId);
  }

  const label = String(hints.scenarioLabel || "").toLowerCase();
  if (label) {
    const fromLabel = SCENARIOS.find((s) => s.label.toLowerCase() === label || label.includes(s.label.toLowerCase()));
    if (fromLabel && fromLabel.id !== "general") return categoryMeta(fromLabel.id);
    if (/fall/i.test(label)) return categoryMeta("fall");
    if (/swallow|chok/i.test(label)) return categoryMeta("dysphagia");
    if (/distress|behaviour|behavior/i.test(label)) return categoryMeta("distress");
    if (/medication|medicine/i.test(label)) return categoryMeta("medication");
    if (/skin|pressure/i.test(label)) return categoryMeta("skin");
    if (/wellbeing/i.test(label)) return categoryMeta("wellbeing");
  }

  const hay = `${hints.text || ""}\n${hints.body || ""}`.trim();
  if (hay) {
    for (const def of REPORT_CATEGORY_DEFS) {
      if (def.id === "general") continue;
      if (def.match.test(hay)) return { id: def.id, label: def.label };
    }
    const detected = detectScenario(hay);
    if (detected?.id && detected.id !== "general") return categoryMeta(detected.id);
  }

  if (hints.noteType === "incident") return categoryMeta("safeguarding");
  if (hints.noteType === "handover") return categoryMeta("wellbeing");

  return categoryMeta("general");
}

export function groupItemsByCategory(items) {
  const groups = new Map();
  for (const item of items) {
    const id = item.categoryId || "general";
    if (!groups.has(id)) {
      const meta = categoryMeta(id);
      groups.set(id, { categoryId: meta.id, categoryLabel: meta.label, items: [] });
    }
    groups.get(id).items.push(item);
  }
  return [...groups.values()].sort(
    (a, b) => categorySortIndex(a.categoryId) - categorySortIndex(b.categoryId),
  );
}
