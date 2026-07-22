import { adviceForScenario } from "./knowledge.js";
import { isCarerName } from "./names.js";

export const SCENARIOS = [
  {
    id: "fall",
    label: "Fall",
    match: /\b(fall|fell|fallen|slipped|trip(?:ped)?)\b/i,
    questions: [
      { id: "when", ask: "When did it happen — just now, or roughly what time?" },
      { id: "where", ask: "Where did it happen? Bedroom, bathroom, corridor…?" },
      { id: "witnessed", ask: "Did anyone see it, or was it unwitnessed?" },
      { id: "how", ask: "What were they doing right before — standing up, walking, reaching…?" },
      { id: "injury", ask: "Any pain, bleeding, bumps, or odd limb position — or none that you can see?" },
      { id: "response", ask: "What have you done so far?" },
      { id: "obs", ask: "How are they now — alert, dizzy, confused, calm?" },
      { id: "informed", ask: "Who have you told, and who still needs telling — nurse in charge, GP, family, 999?" },
      { id: "prevent", ask: "Anything you want in place now for safety — mat, closer checks, footwear…?" },
    ],
  },
  {
    id: "dysphagia",
    label: "Eating / choking / swallow",
    match: /\b(chok(?:e|ing)?|swallow|dysphagia|coughing (?:on|while) (?:eat|drink)|aspirat)/i,
    questions: [
      { id: "what", ask: "What happened with eating or drinking?" },
      { id: "texture", ask: "Were they on a special texture or fluid level?" },
      { id: "signs", ask: "Any coughing, colour change, wet voice, or distress?" },
      { id: "stopped", ask: "Did you stop food and drink?" },
      { id: "now", ask: "How are they now?" },
      { id: "informed", ask: "Who have you informed?" },
    ],
  },
  {
    id: "distress",
    label: "Distress / behaviour support",
    match: /\b(distress|agitated|aggression|hitting|ligature|self[- ]harm|restrain|mapa|pmva|difficult|challenging|behaviour|behavior)\b/i,
    questions: [
      { id: "what", ask: "What’s happening for them right now, in plain words?" },
      { id: "trigger", ask: "Anything that seemed to trigger it?" },
      { id: "risk", ask: "Is anyone in immediate danger — including ligature or weapons risk?" },
      { id: "done", ask: "What have you tried — space, calm talk, care-plan strategies?" },
      { id: "help", ask: "Who is supporting you on the floor right now?" },
      { id: "now", ask: "How is the person now?" },
    ],
  },
  {
    id: "medication",
    label: "Medication / refusal",
    match:
      /\b((refuse[ds]?|refusing|won'?t take|will not take|not taking|declined?).{0,40}\b(medicine|medication|meds|tablet|tablets|pill|pills|dose)\b|\b(medicine|medication|meds|tablet|tablets|pill|pills).{0,40}\b(refuse[ds]?|refusing|won'?t|not taking|declined?)\b|\b(medication|medicine|meds|mar)\b)/i,
    questions: [
      { id: "what", ask: "Which medicine was refused or not taken — if you know the name or time slot?" },
      { id: "when", ask: "When was this — which round / roughly what time?" },
      { id: "how", ask: "What exactly happened — refused, spat out, asleep, not present…?" },
      { id: "reason", ask: "Did they say why, or seem unwell / distressed?" },
      { id: "done", ask: "What have you tried so far (offer again, nurse, wait)?" },
      { id: "now", ask: "How are they now?" },
      { id: "informed", ask: "Who have you told — nurse in charge / on-call?" },
      { id: "next", ask: "What needs to happen next according to the home’s policy?" },
    ],
  },
  {
    id: "skin",
    label: "Skin / pressure concern",
    match: /\b(skin|pressure|sore|redness|bruise|wound|mark)\b/i,
    questions: [
      { id: "where", ask: "Where on the body is the mark or sore?" },
      { id: "looks", ask: "What does it look like?" },
      { id: "pain", ask: "Are they sore there?" },
      { id: "found", ask: "When did you notice it?" },
      { id: "done", ask: "What have you done so far?" },
      { id: "next", ask: "What do you think needs to happen next?" },
    ],
  },
  {
    id: "wellbeing",
    label: "Wellbeing check",
    match: /\b(wellbeing|well-being|mood|check(?:ed)? on|how .+ (?:is|are))\b/i,
    questions: [
      { id: "mood", ask: "How is their mood and engagement?" },
      { id: "eat", ask: "Eating and drinking okay?" },
      { id: "mobility", ask: "Any mobility notes?" },
      { id: "care", ask: "Any personal care done or needed?" },
      { id: "concerns", ask: "Anything worrying you?" },
      { id: "plan", ask: "What should the next shift know?" },
    ],
  },
  {
    id: "general",
    label: "Care situation",
    match: /./,
    questions: [
      { id: "what", ask: "In one line, what happened?" },
      { id: "when", ask: "When was this?" },
      { id: "where", ask: "Where?" },
      { id: "response", ask: "What did you do?" },
      { id: "now", ask: "How is the person now?" },
      { id: "informed", ask: "Who knows / who still needs to know?" },
      { id: "next", ask: "What needs to happen next?" },
    ],
  },
];

const WAKE_PREFIX =
  /^(?:(?:hi|hii|hey|hello|yo|ok|okay|hiya|oi|excuse me)\s+)+(?:care\s*talk|caretalk|don|dawn|done|dom|dun|donn)\b[, ]*/i;
const WAKE_START = /^(?:care\s*talk|caretalk|don|dawn|done|dom|dun|donn)\b[, ]*/i;

/** Normalise common ASR mishearings of “careTalk” / legacy “Don”. */
export function normalizeSpeech(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/["""']/g, "")
    .replace(/[^\w\s']/g, " ")
    .replace(/\bcare\s*talk\b/g, "caretalk")
    .replace(/\b(dawn|done|dom|dun|donn|donnie|donald)\b/g, "don")
    .replace(/\s+/g, " ")
    .trim();
}

export function isWakeOnly(text) {
  const t = normalizeSpeech(text);
  // "caretalk", "hi caretalk", "don", "hi don"
  return /^(?:(?:(?:hi|hii|hey|hello|yo|ok|okay|hiya|oi)\s+)?(?:caretalk|don)\s*)+$/.test(t);
}

export function stripWake(text) {
  let out = String(text || "").trim();
  out = out.replace(WAKE_PREFIX, "").replace(WAKE_START, "").trim();
  // If ASR glued wake + message
  const norm = normalizeSpeech(out);
  if (norm.startsWith("caretalk ")) out = out.replace(/^(?:care\s*talk|caretalk)\s+/i, "").trim();
  if (norm.startsWith("don ")) out = out.replace(/^(?:don|dawn|done)\s+/i, "").trim();
  return out;
}

/** True if utterance is calling careTalk (or legacy Don / ASR near-miss). */
export function mentionsDon(text) {
  const raw = String(text || "");
  if (/\bcare\s*talk\b/i.test(raw) || /\bcaretalk\b/i.test(raw)) return true;
  if (/\bdon\b/i.test(raw)) return true;
  // ASR near-misses in call-like positions (avoid waking on “I’m done”)
  if (
    /\b(?:hi|hey|hello|yo|ok|okay|hiya|oi|excuse me)\s+(?:dawn|done|dom|dun|donn|donnie|donald|dan|donn?e)\b/i.test(
      raw,
    )
  ) {
    return true;
  }
  if (/^(?:dawn|done|dom|dun|donn|donald)\b/i.test(raw.trim())) return true;
  if (/,\s*(?:dawn|done|dom|dun|donn|donald)\b/i.test(raw)) return true;
  // Fuzzy: short wake calls after normalise
  const n = normalizeSpeech(raw);
  if (/^(?:(?:hi|hii|hey|hello|yo|ok|okay|hiya|oi)\s+)?(?:caretalk|don)(?:\s+(?:caretalk|don))*$/.test(n)) return true;
  return false;
}

/** Enough content after the wake name to start a care flow without asking. */
export function hasClearCareIntent(text) {
  const payload = stripWake(text).trim();
  if (!payload) return false;
  const scenario = detectScenario(payload);
  if (scenario.id !== "general") return true;
  if (
    /\b(help|need|advice|record|document|fell|fall|hurt|pain|chok|bleed|resident|patient|check|incident|report)\b/i.test(
      payload,
    )
  ) {
    return true;
  }
  // “careTalk, Meggie seems off today” — enough words to treat as a request
  return payload.split(/\s+/).filter(Boolean).length >= 4;
}

/** Mentions careTalk but no clear ask — clarify instead of guessing. */
export function isAmbiguousDonCall(text) {
  if (!mentionsDon(text)) return false;
  if (isWakeOnly(text)) return false;
  return !hasClearCareIntent(text);
}

const PERSON_BLOCKLIST = new Set(
  [
    "i",
    "we",
    "you",
    "he",
    "she",
    "it",
    "they",
    "them",
    "him",
    "her",
    "his",
    "my",
    "our",
    "your",
    "the",
    "a",
    "an",
    "this",
    "that",
    "these",
    "those",
    "someone",
    "somebody",
    "anyone",
    "anybody",
    "everyone",
    "everybody",
    "resident",
    "client",
    "service",
    "user",
    "carer",
    "nurse",
    "staff",
    "today",
    "just",
    "please",
    "okay",
    "ok",
    "alright",
    "don",
    "caretalk",
    "hey",
    "hi",
    "hello",
    "yes",
    "yeah",
    "yep",
    "yup",
    "no",
    "nope",
    "nah",
    "not",
    "nothing",
    "something",
    "else",
    "fall",
    "distress",
    "swallow",
    "skin",
    "mood",
    "wellbeing",
    "medication",
    "meds",
    "urgent",
    "safe",
    "unsafe",
    "danger",
    "right",
    "got",
    "still",
    "here",
    "there",
    "when",
    "where",
    "what",
    "why",
    "how",
    "who",
    "which",
    "because",
    "about",
    "with",
    "for",
    "from",
    "after",
    "before",
    "during",
    "maybe",
    "kind",
    "sort",
    "really",
    "actually",
    "saying",
    "said",
    "tell",
    "told",
    "need",
    "help",
    "advice",
    "report",
    "record",
    "document",
  ].map((w) => w.toLowerCase()),
);

export function isPlausiblePersonName(name) {
  const n = String(name || "").trim();
  if (!n || n.length < 2 || n.length > 24) return false;
  if (/\d/.test(n)) return false;
  if (PERSON_BLOCKLIST.has(n.toLowerCase())) return false;
  // Prefer real-looking names (letters / hyphen / apostrophe), not sentences
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(n)) return false;
  return true;
}

export function detectPerson(text, { carerName = "" } = {}) {
  const cleaned = stripWake(text);
  if (!cleaned) return "";

  function accept(name) {
    if (!name || !isPlausiblePersonName(name)) return "";
    if (carerName && isCarerName(name, carerName)) return "";
    return name;
  }

  // Explicit name cues are trusted more than “first capitalised word”
  const patterns = [
    /(?:with|for|about|attending(?: to)?|resident|service user|client|called)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
    /\b([A-Z][a-z]+)\s+(?:just |has |had |fell|was |is |seems |refused |won'?t )/,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m) {
      const candidate = accept(m[1].split(/\s+/)[0]);
      if (candidate) return candidate;
    }
  }

  // Soft lowercase: "handy fell" / "meggie just refused"
  const soft = cleaned.match(/\b([a-z]{2,})\s+(?:just |has |had |fell|seems|refused|won'?t)/i);
  if (soft) {
    const candidate = accept(
      isPlausiblePersonName(soft[1])
        ? soft[1].charAt(0).toUpperCase() + soft[1].slice(1).toLowerCase()
        : "",
    );
    if (candidate) return candidate;
  }

  // Bare name only when the whole utterance is basically a name (answering “who?”)
  const bare = cleaned.match(/^([A-Za-z][A-Za-z'-]{1,23})(?:\s+(?:please|thanks))?[.!?]?$/);
  if (bare) {
    const candidate = accept(
      bare[1].charAt(0).toUpperCase() + bare[1].slice(1).toLowerCase(),
    );
    if (candidate) return candidate;
  }

  return "";
}

export function detectScenario(text) {
  const cleaned = stripWake(text);
  for (const s of SCENARIOS) {
    if (s.id === "general") continue;
    if (s.match.test(cleaned)) return s;
  }
  return SCENARIOS.find((s) => s.id === "general");
}

function personaliseAsk(ask, person) {
  if (!person) return ask;
  if (/^Where did it happen/i.test(ask)) {
    return `Where was ${person}? Bedroom, bathroom, corridor…?`;
  }
  return ask;
}

export function startSession({ opening, carer, carerProfileName = "" }) {
  const raw = opening.trim();
  const scenario = detectScenario(raw);
  const excludeCarer = carerProfileName || carer || "";
  let person = detectPerson(raw, { carerName: excludeCarer });
  const cleaned = stripWake(raw) || raw;
  const advice = adviceForScenario(scenario.id, cleaned);
  const questions = scenario.questions.map((q) => ({
    ...q,
    ask: personaliseAsk(q.ask, person),
  }));

  return {
    id: `sess_${Date.now()}`,
    opening: cleaned,
    carer: carer || "Staff",
    person,
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
    advice,
    questions,
    answers: {},
    voiceNotes: [{ at: new Date().toISOString(), text: cleaned }],
    step: 0,
    phase: "advice", // advice | questions | report_review
    adviceAwaitingOk: false,
    docTurn: "waiting_answer", // waiting_answer | confirming | final_confirm | fix_listen
    pendingAnswer: "",
    pendingDocumented: "",
    correctionNote: "",
    recordedAt: new Date().toLocaleString("en-GB"),
  };
}

export function greetingOnWake() {
  const lines = [
    "I’m here. Do you need any help?",
    "Hi — it’s careTalk. What do you need?",
    "Listening. Are you okay — want help documenting something, or advice on what to do next?",
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

export function clarifyAmbiguousWake() {
  const lines = [
    "Did you say my name? Or do you need my help?",
    "Was that for me — careTalk? Do you need help?",
    "I thought I heard careTalk. Did you say my name, or do you need me?",
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

export function currentQuestion(session) {
  return session.questions[session.step] || null;
}

/** careTalk’s record line for this question (resident named separately from carer). */
export function formatAnswerForRecord(question, answer, { person = "" } = {}) {
  const a = String(answer || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!a) return "—";
  const label = String(question?.ask || "Note")
    .replace(/\?$/, "")
    .trim();
  const resident = person ? `Service user ${person}: ` : "";
  return `${resident}${label} — ${a}`;
}

export function isConfirmYes(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  if (/\b(no|nope|not right|wrong|incorrect|change)\b/.test(t) && !/^yes\b/.test(t)) return false;
  return /^(yes|yeah|yep|yup|correct|right|spot on|that'?s right|that is right|good|fine|ok|okay|absolutely|affirmative)\b/.test(
    t,
  );
}

export function isConfirmNo(text) {
  const t = String(text || "").trim().toLowerCase();
  return (
    /^(no|nope|nah|not quite|wrong|incorrect)\b/.test(t) ||
    /\b(not right|that'?s wrong|change that|needs changing)\b/.test(t)
  );
}

export function correctionFromUtterance(text) {
  let t = String(text || "").trim();
  t = t.replace(/^(no(,)?\s*)(actually|i mean|it'?s|it is)?\s*/i, "").trim();
  return t || String(text || "").trim();
}

export function answerLooksTooShort(text) {
  return String(text || "").trim().length < 2;
}

export function commitDocumentedAnswer(session, { raw, documented }) {
  const q = currentQuestion(session);
  if (!q) return { session, done: true };
  const doc = String(documented || raw || "").trim();
  session.answers[q.id] = doc;
  if (!session.voiceNotes) session.voiceNotes = [];
  session.voiceNotes.push({
    at: new Date().toISOString(),
    text: raw ? `${q.id} (voice): ${raw}` : `${q.id}: ${doc}`,
  });
  if (documented && raw && documented !== raw) {
    session.voiceNotes.push({
      at: new Date().toISOString(),
      text: `${q.id} (record): ${doc}`,
    });
  }
  session.step += 1;
  session.pendingAnswer = "";
  session.pendingDocumented = "";
  session.docTurn = "waiting_answer";
  return { session, done: session.step >= session.questions.length };
}

export function answerAndAdvance(session, answer) {
  const q = currentQuestion(session);
  if (!q) return { session, done: true };
  const text = String(answer || "").trim();
  const documented = formatAnswerForRecord(q, text, { person: session.person });
  return commitDocumentedAnswer(session, { raw: text, documented });
}

export function addVoiceNote(session, text) {
  if (!session) return;
  const t = String(text || "").trim();
  if (!t) return;
  if (!session.voiceNotes) session.voiceNotes = [];
  session.voiceNotes.push({ at: new Date().toISOString(), text: t });
}

export function buildReportReviewHtml(session, escape) {
  const rows = session.questions
    .map((q) => {
      const val = session.answers[q.id];
      if (!val) return "";
      return `<li><span class="muted-line">${escape(q.ask)}</span><br /><strong>${escape(val)}</strong></li>`;
    })
    .filter(Boolean)
    .join("");
  const fix = session.correctionNote
    ? `<li><span class="muted-line">Correction noted</span><br /><strong>${escape(session.correctionNote)}</strong></li>`
    : "";
  return rows || fix ? `<ul class="record-review">${rows}${fix}</ul>` : "<p>Nothing captured yet.</p>";
}

export function buildRecord(session) {
  return buildSupportWorkerReport(session);
}

/** Accurate support-worker report for care agency handover. */
export function buildSupportWorkerReport(session) {
  const a = session.answers;
  const n = session.person || "the resident";
  const lines = [
    "SUPPORT WORKER REPORT — GENERATED BY careTalk",
    "========================================",
    `Service user: ${session.person || "—"}`,
    `Support worker / carer: ${session.carer}`,
    `Incident / topic: ${session.scenarioLabel}`,
    `Date & time recorded: ${session.recordedAt}`,
    `Session id: ${session.id}`,
    "",
    "1. OPENING STATEMENT (VOICE)",
    session.opening || "—",
    "",
    "2. WHAT HAPPENED (STRUCTURED)",
  ];

  if (session.scenarioId === "fall") {
    lines.push(
      `${n} had a fall${a.when ? ` (${a.when})` : ""}${a.where ? ` — location: ${a.where}` : ""}.`,
      a.how ? `Beforehand: ${a.how}.` : "",
      a.witnessed ? `Witnessed / presence: ${a.witnessed}.` : "",
      "",
      "3. INJURY / PRESENTATION",
      a.injury || "—",
      "",
      "4. IMMEDIATE RESPONSE",
      a.response || "—",
      "",
      "5. CURRENT CONDITION",
      a.obs || "—",
      "",
      "6. NOTIFICATIONS",
      a.informed || "—",
      "",
      "7. SAFETY / FOLLOW-UP",
      a.prevent || "—",
    );
  } else {
    for (const q of session.questions) {
      lines.push(`${q.ask}`, a[q.id] || "—", "");
    }
  }

  lines.push(
    "",
    "8. VOICE NOTES (VERBATIM CAPTURE)",
    ...(session.voiceNotes || []).map(
      (vn, i) => `${i + 1}. [${new Date(vn.at).toLocaleTimeString("en-GB")}] ${vn.text}`,
    ),
    "",
    "9. NARRATIVE SUMMARY FOR AGENCY",
  );

  if (session.scenarioId === "fall") {
    lines.push(
      [
        `${n} had a fall${a.when ? ` ${a.when}` : ""}${a.where ? ` at ${a.where}` : ""}.`,
        a.how ? `Prior activity: ${a.how}.` : null,
        a.witnessed ? `Presence: ${a.witnessed}.` : null,
        a.injury ? `Injury/marks: ${a.injury}.` : null,
        a.response ? `Actions: ${a.response}.` : null,
        a.obs ? `Now: ${a.obs}.` : null,
        a.informed ? `Informed: ${a.informed}.` : null,
        a.prevent ? `Safety: ${a.prevent}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  } else {
    lines.push(
      session.questions
        .map((q) => `${q.ask.replace(/\?$/, "")}: ${a[q.id] || "not stated"}`)
        .join(". ") + ".",
    );
  }

  lines.push(
    "",
    "10. SAFE PRACTICE REMINDERS APPLIED (careTalk)",
    `Do: ${(session.advice.do || []).slice(0, 4).join(" | ")}`,
    `Don’t: ${(session.advice.dont || []).slice(0, 4).join(" | ")}`,
  );

  if (session.advice.trainedText?.length) {
    lines.push("", "11. HOME-TRAINED KNOWLEDGE USED", ...session.advice.trainedText);
  }

  if (session.correctionNote) {
    lines.push("", "CORRECTION / AMENDMENT (VOICE)", session.correctionNote);
  }

  lines.push("", careTalk_DISCLAIMER);
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

const careTalk_DISCLAIMER =
  "Note: careTalk supports documentation and safe-practice reminders from adult care / support-worker training themes (including moving & assisting, dysphagia, ligature awareness, Oliver McGowan, PMVA/MAPA principles, HSWA). Follow local policy and clinical advice. This report is for the care agency / nurse in charge.";

export { careTalk_DISCLAIMER };
