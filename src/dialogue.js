/**
 * careTalk’s conversational language model (on-device).
 * Intent classification + slot filling + nurse-style dialogue state.
 * Deterministic and fast — not a cloud LLM.
 */

import {
  normalizeSpeech,
  isWakeOnly,
  isAmbiguousDonCall,
  mentionsDon,
  stripWake,
  detectPerson,
  detectScenario,
  hasClearCareIntent,
  isPlausiblePersonName,
} from "./flows.js";
import { isCarerName } from "./names.js";
import { loadCustomKnowledge } from "./store.js";
import {
  detectTrainingTopic,
  hasClearTrainedInstruction,
  findTrainedGuidance,
  hasHomeKnowledgeForSubject,
  topicFromUnsureSubject,
} from "./trainingGaps.js";
import { matchesPinDocumentIntent, matchesFullReportRequest, matchesReportIntent } from "./userReports.js";

const INTENTS = [
  { id: "emergency", score: 10, re: /\b(999|ambulance|unconscious|not breathing|choking now|severe bleed|collapse)\b/i },
  { id: "affirm", score: 8, re: /^(yes|yeah|yep|yup|yea|please|sure|ok|okay|alright|all right|i do|i need( help)?|help( me)?|need help)\b/i },
  { id: "deny", score: 8, re: /^(no|nope|nah|not really|nothing|i'?m (ok|fine|good)|false alarm|never ?mind|all good)\b/i },
  { id: "thanks", score: 6, re: /\b(thanks|thank you|cheers|ta)\b/i },
  { id: "bye", score: 6, re: /^(bye|goodbye|that'?s all|sorted|speak later)\b/i },
  {
    id: "document",
    score: 8,
    re: /\b(documents?|douments?|record(?:ing)?|take (?:a )?notes?|make (?:a )?notes?|put (?:this |it )?(?:on file|in (?:the )?file)|on file|(?:star|asterisk) on file|log (?:this|it)|write (?:this |it )?up|for (?:the )?file|handover note|care note|note (?:this|that|down))\b/i,
  },
  { id: "advice", score: 7, re: /\b(advice|advise|what (should|do) i|how do i|guidance|help me (with|decide))\b/i },
  { id: "fall", score: 9, re: /\b(fall|fell|fallen|slipped|trip(?:ped)?)\b/i },
  { id: "dysphagia", score: 9, re: /\b(chok(?:e|ing)?|swallow|dysphagia|coughing (?:on|while)|aspirat)\b/i },
  { id: "distress", score: 9, re: /\b(distress|agitated|aggression|hitting|ligature|self[- ]harm|upset|shouting|anxious|difficult|challenging|behaviour|behavior)\b/i },
  { id: "skin", score: 8, re: /\b(skin|pressure|sore|redness|bruise|wound|mark)\b/i },
  { id: "wellbeing", score: 7, re: /\b(wellbeing|well-being|mood|quiet|withdrawn|not (themselves|eating)|check(?:ed)? on)\b/i },
  {
    id: "medication",
    score: 10,
    re: /\b((refuse[ds]?|refusing|won'?t take|will not take|not taking|declined?).{0,40}\b(medicine|medication|meds|tablet|tablets|pill|pills|dose)\b|\b(medicine|medication|meds|tablet|tablets|pill|pills).{0,40}\b(refuse[ds]?|refusing|won'?t|not taking|declined?)\b)/i,
  },
  { id: "other_topic", score: 9, re: /^(something else|other|none of (those|that)|not (a )?(fall|distress|swallow|skin|mood)|neither)\b/i },
  { id: "correction", score: 8, re: /\b(i('?m| am) saying|i mean|no i|not (what|that)|that'?s not|actually)\b/i },
  { id: "greet", score: 5, re: /^(hi|hey|hello|hiya)\b/i },
  { id: "unsure", score: 4, re: /\b(not sure|don'?t know|maybe|kind of|sort of|something('?s)? (wrong|off))\b/i },
];

const PROBES = {
  open: [
    "Okay — I’m with you. What’s going on on the floor right now?",
    "Alright. Talk me through it like you would the nurse in charge — what’s happened?",
    "I’m listening. Is someone hurt, unsettled, or do you mainly need advice or a report?",
  ],
  who: ["Who is this about — which resident or service user?", "Whose care are we talking about?"],
  safe: ["Are they safe in front of you right now, or is this urgent?", "First things first — is anyone in immediate danger?"],
  what: ["In one plain sentence, what happened?", "What did you see or hear?"],
  how_now: ["How are they now — calm, in pain, confused, unsettled?", "What’s their presentation like at the moment?"],
  need: [
    "Do you want quick do/don’t advice, or shall we write a support-worker report for the agency?",
    "Shall I guide you on what to do next, or start the documentation?",
  ],
  soft: ["Take your time — what feels most important to sort first?", "I’m here. What do you need from me right now?"],
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Logged-in support worker — never treat as resident/client. */
let carerContext = { fullName: "", firstName: "" };

function cleanPersonCandidate(value) {
  const v = String(value || "").trim().replace(/[^\w\s'-]/g, "");
  const first = v.split(/\s+/)[0] || "";
  if (!isPlausiblePersonName(first)) return "";
  if (carerContext.fullName && isCarerName(first, carerContext.fullName)) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function understand(raw, slots) {
  const text = String(raw || "").trim();
  const norm = normalizeSpeech(text);
  const payload = stripWake(text) || text;

  let intent = "unclear";
  let best = 0;
  for (const row of INTENTS) {
    if (row.re.test(text) || row.re.test(norm)) {
      if (row.score > best) {
        best = row.score;
        intent = row.id;
      }
    }
  }

  if (isWakeOnly(text)) intent = "greet";
  else if (isAmbiguousDonCall(text) && best < 6) intent = "greet_soft";

  // Never invent a person from menu answers / pronouns / corrections
  let person = cleanPersonCandidate(
    detectPerson(payload, { carerName: carerContext.fullName }),
  );
  if (!person && slots.pendingProbe === "who") {
    person = cleanPersonCandidate(payload.replace(/^(it'?s|about|for|with)\s+/i, ""));
  }

  const scenario = detectScenario(payload);
  let scenarioId = scenario?.id && scenario.id !== "general" ? scenario.id : slots.scenarioId || "";
  if (["fall", "dysphagia", "distress", "skin", "wellbeing", "medication"].includes(intent)) scenarioId = intent;
  else if (intent === "other_topic") scenarioId = "general";
  else if (!scenarioId && hasClearCareIntent(payload) && scenario?.id !== "general") {
    scenarioId = scenario.id;
  }

  // “difficult / challenging client” → behaviour support lane
  if (/\b(difficult|challenging|hard work|behaviour|behavior)\b/i.test(payload)) {
    scenarioId = scenarioId || "distress";
    if (intent === "deny" || intent === "unclear" || intent === "correction") intent = "distress";
  }

  const trainingTopic = detectTrainingTopic(payload) || detectTrainingTopic(text);

  return {
    intent,
    person,
    scenarioId,
    payload,
    text,
    trainingTopic,
    clearCare: hasClearCareIntent(payload) || Boolean(trainingTopic) || intent === "distress",
    wantsDocument: matchesReportIntent(text) || /\b(report|agency)\b/i.test(text),
    wantsPinReport: matchesPinDocumentIntent(text),
    wantsFullReport: matchesFullReportRequest(text),
    wantsAdvice: /\b(advice|what (should|do)|guidance|help me)\b/i.test(text),
  };
}

function nurseAck(slots, nlu) {
  const who = slots.person && isPlausiblePersonName(slots.person) ? ` about ${slots.person}` : "";
  if (nlu.intent === "fall" || slots.scenarioId === "fall") return `A fall${who} — okay, we’ll take that seriously.`;
  if (nlu.intent === "dysphagia" || slots.scenarioId === "dysphagia") return `Swallow/choking concern${who} — safety first.`;
  if (nlu.intent === "distress" || slots.scenarioId === "distress") {
    return `Sounds like behaviour support or distress${who}. We’ll stay calm and practical.`;
  }
  if (nlu.intent === "medication" || slots.scenarioId === "medication" || nlu.trainingTopic?.id === "medication_refusal") {
    return `Medication concern${who} — I won’t guess; I’ll use your home’s trained guidance.`;
  }
  if (nlu.intent === "other_topic") {
    return who ? `Okay — not one of those list items${who}.` : "Okay — something else then.";
  }
  if (nlu.intent === "emergency") {
    return "That sounds urgent — if anyone is in immediate danger, call 999 now. I’m still here for the documentation.";
  }
  if (nlu.intent === "correction") return "Got it — thanks for clarifying.";
  return pick([`Got it${who}.`, `Okay${who}, I’m with you.`, `Right${who} — thank you.`]);
}

function customHints(summary) {
  const hay = String(summary || "").toLowerCase();
  return loadCustomKnowledge()
    .filter((k) => !k.keywords?.length || k.keywords.some((kw) => hay.includes(kw)))
    .slice(0, 2)
    .map((k) => k.title);
}

function applyAnswerToProbe(slots, nlu) {
  const pending = slots.pendingProbe;
  if (!pending) return;

  if (pending === "safe") {
    if (/\b(safe|yes|fine|ok|okay|not urgent|no danger|they'?re (ok|fine|safe)|they are safe)\b/i.test(nlu.text)) {
      slots.safetyChecked = true;
      slots.urgency = "normal";
    }
    if (/\b(not safe|unsafe|danger|urgent|999)\b/i.test(nlu.text)) {
      slots.safetyChecked = true;
      slots.urgency = "high";
    }
    // bare "no" to "are they safe?"
    if (
      /^(no|nope|not really)\b/i.test(nlu.text) &&
      !/\b(i('?m| am) saying|saying that|difficult|challenging)\b/i.test(nlu.text)
    ) {
      slots.safetyChecked = true;
      slots.urgency = "high";
    }
    if (/^(yes|yeah|yep|safe)\b/i.test(nlu.text)) {
      slots.safetyChecked = true;
      slots.urgency = "normal";
    }
  }
  if (pending === "who") {
    const candidate = nlu.person || cleanPersonCandidate(nlu.payload.replace(/^(it'?s|about|for|with)\s+/i, ""));
    if (candidate) slots.person = candidate;
  }
  if (pending === "what" && nlu.payload.length > 2) slots.summary = nlu.payload;
  if (pending === "how_now" && nlu.payload.length > 1) slots.howNow = nlu.payload;
  if (pending === "open" && nlu.payload.length > 2) {
    const onlyName = cleanPersonCandidate(nlu.payload) && nlu.payload.split(/\s+/).length <= 2;
    if (onlyName || nlu.person) {
      slots.person = nlu.person || cleanPersonCandidate(nlu.payload);
    } else {
      slots.summary = nlu.payload;
    }
  }
  if (pending === "need") {
    if (/\b(advice|guide|what to do|do.?don)\b/i.test(nlu.text)) slots.goal = "advice";
    if (/\b(record|document|report|write|agency|both)\b/i.test(nlu.text)) slots.goal = "document";
    if (nlu.intent === "affirm") slots.goal = slots.goal || "advice";
  }
  // Topic menu: Fall / distress / … / something else
  if (pending === "topic_pick") {
    if (nlu.intent === "other_topic" || /^something else\b/i.test(nlu.text)) {
      slots.scenarioId = "general";
      slots.waitingTopicPick = false;
    } else if (["fall", "dysphagia", "distress", "skin", "wellbeing", "medication"].includes(nlu.intent)) {
      slots.scenarioId = nlu.intent === "dysphagia" ? "dysphagia" : nlu.intent;
      slots.waitingTopicPick = false;
    } else if (nlu.scenarioId) {
      slots.waitingTopicPick = false;
    }
  }
  slots.pendingProbe = "";
}

function chooseProbe(slots) {
  if (!slots.summary && !slots.scenarioId) return { key: "open", ask: pick(PROBES.open) };
  if (!slots.person) return { key: "who", ask: pick(PROBES.who) };
  if (!slots.safetyChecked) return { key: "safe", ask: pick(PROBES.safe) };
  if (!slots.summary || String(slots.summary).split(/\s+/).length < 4) return { key: "what", ask: pick(PROBES.what) };
  if (!slots.howNow) return { key: "how_now", ask: pick(PROBES.how_now) };
  if (!slots.goal) return { key: "need", ask: pick(PROBES.need) };
  return null;
}

function readyForCareFlow(slots, nlu) {
  if (nlu.trainingTopic || nlu.intent === "medication") return false; // handled separately
  if (nlu.clearCare && (slots.scenarioId || nlu.scenarioId)) return true;
  if (["fall", "dysphagia", "distress", "skin", "wellbeing"].includes(nlu.intent) && nlu.payload.split(/\s+/).length >= 4) {
    return true;
  }
  if (slots.scenarioId && slots.summary && slots.person && (slots.goal || slots.howNow)) return true;
  if (slots.summary && slots.summary.split(/\s+/).length >= 6 && (slots.goal || nlu.wantsDocument || nlu.wantsAdvice)) {
    return true;
  }
  if (nlu.intent === "document" && slots.summary) return true;
  return false;
}

function startReportCareFlow(ctx, nlu, { opening, say } = {}) {
  const text = opening || nlu.payload || ctx.slots.summary || "";
  ctx.slots.goal = "document";
  ctx.state = "advising";
  const who = ctx.slots.person ? ` for ${ctx.slots.person}` : "";
  return {
    say:
      say ||
      `Okay${who} — I'll take this as a report and document what you tell me. I don't need training on the subject to record it.`,
    status: "Report — documenting",
    action: "start_care_flow",
    reportOnly: true,
    opening: stripWake(text) || text,
    keepOpen: true,
  };
}

function medicationOrTrainingGate(ctx, nlu) {
  if (matchesReportIntent(nlu.text) || ctx.slots.goal === "document" || nlu.wantsFullReport) {
    const words = (nlu.payload || "").split(/\s+/).filter(Boolean).length;
    if (words >= 3 || ctx.slots.summary) {
      return startReportCareFlow(ctx, nlu, { opening: nlu.payload || ctx.slots.summary });
    }
  }

  const topic = nlu.trainingTopic || detectTrainingTopic(nlu.payload) || detectTrainingTopic(nlu.text);
  const isMed =
    nlu.intent === "medication" ||
    nlu.scenarioId === "medication" ||
    topic?.id === "medication_refusal" ||
    ctx.slots.scenarioId === "medication";

  if (!isMed && !topic) return null;

  const useTopic = topic || {
    id: "medication_refusal",
    label: "Medication refusal",
    keywords: ["medicine", "medication", "refuse", "meds"],
  };

  if (nlu.person) ctx.slots.person = nlu.person;
  ctx.slots.scenarioId = "medication";
  ctx.slots.summary = nlu.payload || ctx.slots.summary;
  ctx.slots.trainingTopic = useTopic;

  // Need a person name if missing — probe once
  if (!ctx.slots.person && !nlu.person) {
    ctx.state = "probing";
    ctx.slots.pendingProbe = "who";
    return {
      say: "Okay — medicine refusal is serious. Who is this about?",
      status: "Medication — who?",
      action: "none",
      keepOpen: true,
    };
  }

  if (!hasClearTrainedInstruction(useTopic, nlu.payload)) {
    if (matchesReportIntent(nlu.text) || ctx.slots.goal === "document" || nlu.wantsDocument) {
      return startReportCareFlow(ctx, nlu, {
        opening: nlu.payload || ctx.slots.summary,
        say: `${nurseAck(ctx.slots, nlu)} I'll take a report on the medicine situation — tell me what happened and I'll document it.`,
      });
    }
  }

  if (hasClearTrainedInstruction(useTopic, nlu.payload)) {
    const hits = findTrainedGuidance(useTopic, nlu.payload);
    const titles = hits
      .slice(0, 2)
      .map((h) => h.title)
      .join(", ");
    ctx.state = "advising";
    const opening = nlu.payload || ctx.slots.summary;
    return {
      say: `${nurseAck(ctx.slots, nlu)} I found trained guidance${titles ? ` (${titles})` : ""}. I’ll show you what to do / not do, then we can document for the agency.`,
      status: "Using home training — medication",
      action: "start_care_flow",
      opening: stripWake(opening) || opening,
      keepOpen: true,
    };
  }

  // No clear training — escalate
  ctx.state = "advising";
  return {
    say: `I don’t have clear training yet on what to do when ${
      ctx.slots.person || "a client"
    } refuses medicine. I will ask for training on this, and I’ll report to the care agency that I’ve been asked a question I’m not trained on. Please still tell the nurse in charge now, and don’t force the medicine.`,
    status: "Training gap — escalated",
    action: "request_training",
    trainingTopic: useTopic,
    opening: nlu.payload || ctx.slots.summary,
    keepOpen: true,
  };
}

export function createDialogueBrain() {
  const ctx = {
    state: "idle",
    open: false,
    slots: /** @type {Record<string, any>} */ ({}),
  };

  function reset() {
    ctx.state = "idle";
    ctx.open = false;
    ctx.slots = {};
  }

  function engage() {
    ctx.state = "engaged";
    ctx.open = true;
    ctx.slots = {};
  }

  function respond(utterance) {
    const nlu = understand(utterance, ctx.slots);

    // Fill slots from this turn — only trust real names
    if (nlu.person) ctx.slots.person = nlu.person;
    if (ctx.slots.person && !isPlausiblePersonName(ctx.slots.person)) ctx.slots.person = "";
    if (nlu.scenarioId) ctx.slots.scenarioId = nlu.scenarioId;
    if (
      (nlu.clearCare || nlu.intent === "correction" || nlu.payload.split(/\s+/).length >= 5) &&
      nlu.payload.length > 2 &&
      nlu.intent !== "other_topic"
    ) {
      ctx.slots.summary = nlu.payload;
    }
    if (nlu.wantsDocument) ctx.slots.goal = "document";
    if (nlu.wantsAdvice) ctx.slots.goal = ctx.slots.goal || "advice";

    applyAnswerToProbe(ctx.slots, nlu);

    // Wake
    if (nlu.intent === "greet" || nlu.intent === "greet_soft" || isWakeOnly(nlu.text)) {
      if (ctx.open && (ctx.state === "probing" || ctx.state === "advising" || ctx.state === "engaged")) {
        return {
          say: pick([
            "Still here — go on, I’m listening.",
            "Yep, I’m with you. What do you need?",
            "I’m here. Tell me what’s happening.",
          ]),
          status: "Engaged",
          action: "none",
          keepOpen: true,
        };
      }
      engage();
      if (nlu.intent === "greet_soft") {
        return {
          say: pick(["Did you say my name? Do you need my help?", "Was that for me — careTalk? I’m here if you need me."]),
          status: "Checking if you called me",
          action: "none",
          keepOpen: true,
        };
      }
      const hi = carerContext.firstName ? `Hi ${carerContext.firstName}` : "Hi";
      return {
        say: pick([
          `${hi} — it’s careTalk. Do you need any help?`,
          carerContext.firstName
            ? `I’m here, ${carerContext.firstName}. Do you need any help?`
            : "I’m here. Do you need any help?",
          carerContext.firstName
            ? `Hey ${carerContext.firstName}. Do you need a hand with anything on the floor?`
            : "Hey. Do you need a hand with anything on the floor?",
        ]),
        status: "Engaged — like talking to the nurse",
        action: "none",
        keepOpen: true,
      };
    }

    // Still idle
    if (!ctx.open) {
      if (mentionsDon(nlu.text) || nlu.clearCare) engage();
      else return { say: "", action: "none", keepOpen: false, ignore: true };
    }

    // Close-outs — don't treat "No I’m saying…" as a soft deny
    if (
      nlu.intent === "deny" &&
      !nlu.clearCare &&
      !ctx.slots.scenarioId &&
      !ctx.slots.person &&
      ctx.state === "engaged" &&
      !/\b(saying|mean|actually|difficult|challenging)\b/i.test(nlu.text)
    ) {
      reset();
      return { say: "Okay — I’ll stay quiet. Say careTalk whenever you need me.", action: "stay_quiet", keepOpen: false };
    }
    if (nlu.intent === "thanks" || nlu.intent === "bye") {
      const say =
        nlu.intent === "thanks"
          ? "You’re welcome. Say careTalk if anything else comes up."
          : "Alright. Call me if you need me.";
      reset();
      return { say, action: "close", keepOpen: false };
    }

    // Emergency
    if (nlu.intent === "emergency") {
      ctx.state = "probing";
      ctx.slots.urgency = "high";
      return {
        say: "If this is life-threatening, call 999 and get a colleague now. When you can, tell me who and what’s happening — I’ll help with advice and the report.",
        keepOpen: true,
        action: "none",
      };
    }

    // “Make / write a report” — document only (no training-gap / unsure)
    if (nlu.wantsFullReport) {
      const wordCount = nlu.payload.split(/\s+/).filter(Boolean).length;
      if (wordCount >= 3 || ctx.slots.summary) {
        return startReportCareFlow(ctx, nlu);
      }
      ctx.state = "probing";
      ctx.slots.pendingProbe = "what";
      ctx.slots.goal = "document";
      return {
        say: "Sure — tell me what to put in the report, in your own words.",
        status: "Report — listening",
        action: "none",
        keepOpen: true,
      };
    }

    // Voice “document / take note / on file” — pin under carer profile (main.js saves)
    if (nlu.wantsPinReport && !nlu.wantsFullReport) {
      const wordCount = nlu.payload.split(/\s+/).filter(Boolean).length;
      if (wordCount >= 3) {
        ctx.slots.goal = "document";
        ctx.state = "advising";
        const who = ctx.slots.person ? ` for ${ctx.slots.person}` : "";
        return {
          say: `${nurseAck(ctx.slots, nlu)} I’ll turn that into a report and pin it under your name${who}. Managers can see it in Reports → Users.`,
          status: "Pinning voice report",
          action: "pin_user_report",
          opening: nlu.payload,
          keepOpen: true,
        };
      }
      ctx.state = "probing";
      ctx.slots.pendingProbe = "what";
      ctx.slots.goal = "document";
      return {
        say: "Sure — tell me what to put on file, in your own words.",
        status: "Ready to document",
        action: "none",
        keepOpen: true,
      };
    }

    // Medication refusal / topics that must come from Train mode
    const medGate = medicationOrTrainingGate(ctx, nlu);
    if (medGate) return medGate;

    // Yes after “do you need help?” → nurse probe
    if (
      nlu.intent === "affirm" &&
      (ctx.state === "engaged" || ctx.state === "probing") &&
      !nlu.clearCare &&
      !ctx.slots.scenarioId
    ) {
      ctx.state = "probing";
      const probe = chooseProbe(ctx.slots);
      ctx.slots.pendingProbe = probe?.key || "open";
      return {
        say: `${pick(["Good.", "Okay.", "Alright — I’m with you."])} ${probe?.ask || pick(PROBES.open)}`,
        status: "Probing — nurse-style handover chat",
        action: "none",
        keepOpen: true,
      };
    }

    // “Something else” after topic menu — keep the person, ask what happened
    if (nlu.intent === "other_topic" || (ctx.slots.waitingTopicPick && /^something else\b/i.test(nlu.text))) {
      ctx.state = "probing";
      ctx.slots.scenarioId = ctx.slots.scenarioId || "general";
      ctx.slots.waitingTopicPick = false;
      ctx.slots.pendingProbe = "what";
      const who = ctx.slots.person ? ` with ${ctx.slots.person}` : "";
      return {
        say: `${nurseAck(ctx.slots, nlu)} Tell me in one plain sentence what’s happening${who}.`,
        status: "Probing — other situation",
        action: "none",
        keepOpen: true,
      };
    }

    // Not sure about the subject — admit it instead of guessing
    const knownScenarios = ["fall", "dysphagia", "distress", "skin", "wellbeing", "medication"];
    const subjectText = ctx.slots.summary || nlu.payload || "";
    const isReportAsk =
      matchesReportIntent(nlu.text) || ctx.slots.goal === "document" || nlu.wantsFullReport || nlu.wantsDocument;
    const wantsHelp =
      !isReportAsk &&
      (nlu.wantsAdvice ||
        nlu.intent === "advice" ||
        ctx.slots.goal === "advice" ||
        (readyForCareFlow(ctx.slots, nlu) && (ctx.slots.scenarioId === "general" || !ctx.slots.scenarioId)));
    if (
      wantsHelp &&
      subjectText.split(/\s+/).length >= 4 &&
      !knownScenarios.includes(ctx.slots.scenarioId) &&
      !knownScenarios.includes(nlu.scenarioId) &&
      !hasHomeKnowledgeForSubject(subjectText)
    ) {
      const topic = topicFromUnsureSubject(subjectText, nlu.payload);
      ctx.slots.trainingTopic = topic;
      ctx.state = "advising";
      return {
        say: `I’m not sure about this subject${
          ctx.slots.person ? ` for ${ctx.slots.person}` : ""
        }. I won’t guess. Please check with the nurse in charge and follow the care plan — I can still help you write down what happened, or I can log this so a head nurse can train me.`,
        status: "Unsure — subject gap",
        action: "unsure_subject",
        trainingTopic: topic,
        opening: subjectText,
        keepOpen: true,
      };
    }

    // Ready to hand off to care documentation/advice UI
    if (
      ctx.slots.goal === "document" &&
      ctx.slots.summary &&
      ctx.slots.summary.split(/\s+/).filter(Boolean).length >= 4 &&
      !nlu.wantsPinReport
    ) {
      return {
        say: "Got it — I’ll pin that report under your name for managers.",
        status: "Pinning voice report",
        action: "pin_user_report",
        opening: ctx.slots.summary,
        keepOpen: true,
      };
    }

    if (readyForCareFlow(ctx.slots, nlu)) {
      const opening = [ctx.slots.summary, nlu.payload].filter(Boolean)[0] || nlu.payload;
      if (isReportAsk || ctx.slots.goal === "document") {
        return startReportCareFlow(ctx, nlu, { opening });
      }
      const hints = customHints(opening);
      const hintLine = hints.length ? ` I’ll also use your home training on ${hints.join(" and ")}.` : "";
      ctx.state = "advising";
      return {
        say: `${nurseAck(ctx.slots, nlu)} I’ll give you clear do/don’ts, then we can document for the agency.${hintLine}`,
        status: "Starting care guidance",
        action: "start_care_flow",
        opening: stripWake(opening) || opening,
        keepOpen: true,
      };
    }

    // Keep probing like a nurse — only ask the topic menu when we truly have a person and no topic yet
    ctx.state = "probing";
    if (ctx.slots.person && !ctx.slots.scenarioId && !nlu.clearCare && !ctx.slots.summary) {
      ctx.slots.pendingProbe = "topic_pick";
      ctx.slots.waitingTopicPick = true;
      return {
        say: `${nurseAck(ctx.slots, nlu)} What’s happening with ${ctx.slots.person}? Fall, distress, swallow, skin, mood — or something else?`,
        keepOpen: true,
        action: "none",
      };
    }

    const probe = chooseProbe(ctx.slots);
    if (probe) {
      ctx.slots.pendingProbe = probe.key;
      const ack = ctx.slots.summary || ctx.slots.person ? `${nurseAck(ctx.slots, nlu)} ` : "";
      return { say: `${ack}${probe.ask}`, status: "Probing", action: "none", keepOpen: true };
    }

    // Has enough slots but no goal yet — ask need
    ctx.slots.pendingProbe = "need";
    return { say: pick(PROBES.need), keepOpen: true, action: "none" };
  }

  function setCarerContext(patch = {}) {
    carerContext = {
      fullName: String(patch.fullName ?? carerContext.fullName ?? "").trim(),
      firstName: String(patch.firstName ?? carerContext.firstName ?? "").trim(),
    };
    if (!carerContext.firstName && carerContext.fullName) {
      carerContext.firstName = carerContext.fullName.split(/\s+/)[0] || "";
    }
  }

  return {
    respond,
    reset,
    engage,
    setCarerContext,
    isOpen: () => ctx.open,
    getState: () => ctx.state,
    getSlots: () => ({ ...ctx.slots }),
  };
}
