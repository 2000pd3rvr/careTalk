/** Care-domain intelligence — what makes Hearthnote different from generic voice-to-text. */

export const CARE_NOTE_TYPES = [
  {
    id: "wellbeing",
    label: "Wellbeing round",
    blurb: "Person-centred daily observation",
    seed: ["Wellbeing & mood", "Nutrition & hydration", "Mobilisation", "Personal care", "Plan for next checks"],
  },
  {
    id: "handover",
    label: "Shift handover",
    blurb: "What the next team must know",
    seed: ["Open risks", "Care completed this shift", "Outstanding actions", "Family / GP updates"],
  },
  {
    id: "incident",
    label: "Incident / near miss",
    blurb: "What happened, response, follow-up",
    seed: ["What happened", "Immediate response", "Injury / distress check", "Who was informed", "Preventive actions"],
  },
  {
    id: "safeguarding",
    label: "Safeguarding alert",
    blurb: "Concern raised — factual & timely",
    seed: ["Concern observed", "Person’s presentation", "Actions already taken", "Who must be notified"],
  },
  {
    id: "family",
    label: "Family update",
    blurb: "Warm, clear update for relatives",
    seed: ["How they are today", "What we supported with", "What we’re watching", "How family can help"],
  },
];

export const CARE_DOMAINS = [
  { id: "mood", label: "Mood & engagement", voice: ["mood", "engagement", "wellbeing"], prompt: "How is their mood and engagement right now?" },
  { id: "mobility", label: "Mobilisation", voice: ["mobility", "mobilisation", "transfer", "zimmer", "hoist"], prompt: "How did they mobilise / transfer?" },
  { id: "nutrition", label: "Nutrition & fluids", voice: ["nutrition", "hydration", "ate", "drank", "meal"], prompt: "What did they eat and drink?" },
  { id: "personal", label: "Personal care", voice: ["personal care", "washed", "dressed", "continence", "pad"], prompt: "What personal care was completed?" },
  { id: "skin", label: "Skin integrity", voice: ["skin", "pressure", "sore", "redness"], prompt: "Any skin changes or pressure areas?" },
  { id: "clinical", label: "Clinical / PRN", voice: ["medication", "prn", "obs", "pain", "gp"], prompt: "Any medication, pain, or clinical observations?" },
  { id: "risk", label: "Risks & safety", voice: ["risk", "fall", "wander", "safeguarding", "incident"], prompt: "Any safety or safeguarding concerns?" },
  { id: "plan", label: "Plan / escalate", voice: ["plan", "action", "escalate", "handover"], prompt: "What should happen next?" },
];

const FIELD_PATTERNS = [
  {
    key: "resident",
    re: /(?:resident|service user|client|with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  },
  {
    key: "when",
    re: /(?:at|around|about)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|this morning|this afternoon|this evening|overnight|during night shift)/i,
  },
];

const RISK_WORDS = [
  ["fall", "Falls risk"],
  ["slipped", "Falls risk"],
  ["wander", "Exit-seeking / wandering"],
  ["exit-seeking", "Exit-seeking / wandering"],
  ["exit seeking", "Exit-seeking / wandering"],
  ["distress", "Emotional distress"],
  ["agitated", "Emotional distress"],
  ["aggressive", "Behavioural escalation"],
  ["chok", "Choking / swallow risk"],
  ["pressure", "Skin integrity watch"],
  ["sore", "Skin integrity watch"],
  ["refus", "Care preference / declined support"],
  ["declined", "Care preference / declined support"],
  ["low mood", "Mood concern"],
  ["confused", "Cognitive change"],
  ["delirium", "Cognitive change"],
  ["safeguard", "Safeguarding pathway"],
  ["bruise", "Injury / mark observed"],
  ["unwitnessed", "Unwitnessed event — verify"],
];

/** Soften task-centred phrasing into person-centred care language. */
const DIGNITY_REWRITES = [
  [/refused care/gi, "declined care; support and choices were offered"],
  [/refused/gi, "declined"],
  [/non[- ]compliant/gi, "needed extra encouragement and adapted support"],
  [/aggressive resident/gi, "showed distressed behaviour"],
  [/wandering/gi, "walking with purpose / exit-seeking"],
  [/fed/gi, "supported with meals"],
  [/toileted/gi, "supported with continence care"],
  [/put to bed/gi, "supported to settle for bed"],
  [/challenging behaviour/gi, "distressed behaviour"],
];

function sentenceCase(text) {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function grabAfter(text, labels, stopLabels = []) {
  const lower = text.toLowerCase();
  for (const label of labels) {
    const idx = lower.indexOf(label);
    if (idx === -1) continue;
    let slice = text.slice(idx + label.length).replace(/^[\s:,-]+/, "");
    let cut = slice.length;
    for (const stop of stopLabels) {
      const sIdx = slice.toLowerCase().indexOf(stop);
      if (sIdx !== -1) cut = Math.min(cut, sIdx);
    }
    const out = slice.slice(0, cut).trim().replace(/[.;]+$/, "");
    if (out) return sentenceCase(out);
  }
  return "";
}

export function applyDignityLanguage(text) {
  let out = text || "";
  for (const [re, to] of DIGNITY_REWRITES) out = out.replace(re, to);
  return out;
}

export function detectDomainCoverage(raw) {
  const lower = (raw || "").toLowerCase();
  return CARE_DOMAINS.map((d) => ({
    ...d,
    covered: d.voice.some((v) => lower.includes(v)),
  }));
}

export function buildHandoverCard(structured, coverage) {
  const missing = coverage.filter((c) => !c.covered).map((c) => c.label);
  const risks = structured.flags.filter((f) => !/No acute/i.test(f));
  const bullets = [];
  if (structured.resident) {
    bullets.push(
      `${structured.resident}: ${structured.mood || structured.narrative.slice(0, 90) || "see full note"}`
    );
  } else if (structured.narrative) {
    bullets.push(structured.narrative.slice(0, 110));
  }
  if (risks.length) bullets.push(`Watch: ${risks.slice(0, 3).join("; ")}`);
  if (structured.actions) bullets.push(`Next: ${structured.actions}`);
  else if (missing.length) bullets.push(`Still to capture: ${missing.slice(0, 3).join(", ")}`);
  if (structured.clinical) bullets.push(`Clinical: ${structured.clinical}`);
  return bullets.slice(0, 4);
}

export function buildEscalationPack(structured) {
  const hot = structured.flags.filter((f) =>
    /safeguard|fall|chok|injury|behavioural|skin integrity|cognitive/i.test(f)
  );
  if (!hot.length) return null;
  return {
    title: "Nurse-in-charge brief",
    lines: [
      `Person: ${structured.resident || "Resident (name not yet captured)"}`,
      `Flags: ${hot.join("; ")}`,
      `Facts noted: ${structured.risks || structured.narrative || "See body of note"}`,
      `Already done: ${structured.actions || "Document response and who was informed"}`,
      "Ask: Do we need GP / 111 / safeguarding referral / family call now?",
    ],
  };
}

export function structureCareNote(raw, noteType = "wellbeing") {
  const dignified = applyDignityLanguage(raw || "");
  const text = dignified.replace(/\s+/g, " ").trim();
  const empty = {
    resident: "",
    when: "",
    mood: "",
    mobility: "",
    nutrition: "",
    care: "",
    clinical: "",
    risks: "",
    actions: "",
    flags: [],
    narrative: "",
    confidence: 0,
    coverage: detectDomainCoverage(""),
    handover: [],
    escalation: null,
    dignityApplied: dignified !== (raw || ""),
    noteType,
  };

  if (!text) return empty;

  let resident = "";
  let when = "";
  for (const { key, re } of FIELD_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    if (key === "resident") resident = m[1];
    if (key === "when") when = sentenceCase(m[1]);
  }

  if (!resident) {
    const soft = text.match(/\b([A-Z][a-z]+)\s+(?:was|is|appeared|seemed|had|ate|declined|refused)\b/);
    if (soft) resident = soft[1];
  }

  const mood = grabAfter(
    text,
    ["mood", "appeared", "seemed", "engagement", "engaged", "wellbeing"],
    ["mobility", "transfer", "ate", "drink", "medication", "action", "plan", "risk"]
  );
  const mobility = grabAfter(
    text,
    ["mobility", "mobilis", "transfer", "zimmer", "frame", "hoist", "walked"],
    ["ate", "drink", "nutrition", "hydration", "personal care", "medication", "action"]
  );
  const nutrition = grabAfter(
    text,
    ["nutrition", "hydration", "ate", "eaten", "drank", "fluid", "meal", "lunch", "breakfast", "dinner", "supper"],
    ["personal care", "washed", "continence", "medication", "action", "plan"]
  );
  const care = grabAfter(
    text,
    ["personal care", "washed", "shower", "continence", "pad", "skin", "dressed"],
    ["medication", "clinical", "obs", "action", "plan", "risk"]
  );
  const clinical = grabAfter(
    text,
    ["medication", "prn", "clinical", "obs", "blood pressure", "temperature", "gp", "nurse", "pain"],
    ["action", "plan", "next", "risk", "incident"]
  );
  const risks = grabAfter(
    text,
    ["risk", "incident", "concern", "safeguarding", "near miss"],
    ["action", "plan", "we ", "staff "]
  );
  const actions = grabAfter(
    text,
    ["action", "plan", "we ", "staff ", "escalated", "informed", "documented", "handover"],
    []
  );

  const flags = [];
  const lower = text.toLowerCase();
  for (const [needle, label] of RISK_WORDS) {
    if (lower.includes(needle) && !flags.includes(label)) flags.push(label);
  }
  if (!flags.length && /settled|comfortable|no concerns|stable/i.test(text)) {
    flags.push("No acute escalation flagged");
  }

  const whenBit = when || "this shift";
  const parts = [];
  if (noteType === "family") {
    parts.push(
      resident
        ? `${resident} has been supported ${whenBit}.`
        : `Your relative has been supported ${whenBit}.`
    );
  } else if (noteType === "handover") {
    parts.push(resident ? `Handover — ${resident} (${whenBit}).` : `Handover note (${whenBit}).`);
  } else {
    parts.push(resident ? `${resident} was reviewed ${whenBit}.` : `Resident reviewed ${whenBit}.`);
  }

  const detailBits = [mood, mobility, nutrition, care, clinical]
    .filter(Boolean)
    .map((d) => (d.endsWith(".") ? d : `${d}.`));
  parts.push(...detailBits);
  if (risks) parts.push(`Risks/incidents: ${risks}${risks.endsWith(".") ? "" : "."}`);
  if (actions) parts.push(`Actions/plan: ${actions}${actions.endsWith(".") ? "" : "."}`);
  if (!detailBits.length && !risks && !actions) {
    parts.push(sentenceCase(text) + (text.endsWith(".") ? "" : "."));
  }

  const filled = [resident, when, mood, mobility, nutrition, care, clinical, risks, actions].filter(Boolean)
    .length;
  const confidence = Math.min(98, 35 + filled * 8 + Math.min(20, Math.floor(text.length / 40)));
  const structured = {
    resident,
    when,
    mood,
    mobility,
    nutrition,
    care,
    clinical,
    risks,
    actions,
    flags,
    narrative: parts.join(" ").replace(/\s+/g, " ").trim(),
    confidence,
    noteType,
    dignityApplied: dignified !== (raw || "").replace(/\s+/g, " ").trim(),
  };
  structured.coverage = detectDomainCoverage(text);
  structured.handover = buildHandoverCard(structured, structured.coverage);
  structured.escalation = buildEscalationPack(structured);
  return structured;
}

export const SAMPLE_DICTATION = `Resident Margaret was reviewed at 9:15 pm during night shift. She appeared settled but a little low mood after family visit. Mobility: walked to bathroom with Zimmer frame, one staff for standby, no falls. Ate most of supper and drank two cups of tea. Personal care completed, skin intact, pad changed. PRN paracetamol given for mild shoulder discomfort with good effect. No exit-seeking tonight. Plan: continue hourly checks, encourage fluids, handover to morning staff to monitor mood.`;
