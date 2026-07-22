/**
 * careTalk knowledge mind — guidance drawn from common UK adult social care /
 * health support worker practice themes (training frameworks named by the product owner).
 * Not a substitute for local policy, clinical assessment, or emergency services.
 */

import { loadCustomKnowledge } from "./store.js";
import { visualsForAdvice } from "./visualGuides.js";

export const DON_META = {
  name: "careTalk",
  fullName: "careTalk",
  version: "1.1.15",
  tagline: "Speech-to-text care notes · custom training · live webhooks",
  disclaimer:
    "careTalk supports record-keeping and safe practice reminders. Follow your home’s policy, escalate to the nurse in charge, and call 999 in an emergency.",
};

/** Training / practice pillars careTalk reasons from (expand later). */
export const KNOWLEDGE_PILLARS = [
  {
    id: "pmva_mapa",
    title: "PMVA / MAPA (BILD-accredited)",
    notes:
      "Physical intervention and de-escalation for mental health settings is a specialised, assessed course (typically multi-day, BILD-accredited). Prefer prevention, communication, and least-restrictive options. Only use techniques you are currently trained and authorised to use.",
  },
  {
    id: "oliver_mcgowan",
    title: "Oliver McGowan Mandatory Training (Tier 2 + online)",
    notes:
      "Learning disability and autism awareness: assume competence, adapt communication, reduce sensory load, involve familiar supporters, avoid diagnostic overshadowing, and escalate concerns about distress or unmet need.",
  },
  {
    id: "ligature",
    title: "Ligature awareness",
    notes:
      "Remove or reduce ligature risks where safe and authorised; do not leave someone in danger to ‘finish paperwork’. Observe, report environmental risks, stay with the person if unsafe to leave, and escalate immediately per policy.",
  },
  {
    id: "dysphagia",
    title: "Dysphagia awareness",
    notes:
      "Follow IDDSI / care-plan texture and fluid guidance. Never rush feeding, never mix consistencies against the plan, sit upright, watch for coughing/wet voice/colour change, and stop and escalate if aspiration is suspected.",
  },
  {
    id: "seniors",
    title: "Caring for older adults",
    notes:
      "Person-centred, dignity-first care: explain what you are doing, offer choice, watch for delirium, falls, skin, hydration, and loneliness. Document facts, not judgements.",
  },
  {
    id: "moving_assisting",
    title: "Moving and assisting people",
    notes:
      "Use agreed handling plans, equipment you are trained on, and enough staff. Do not lift manually against policy. After a fall, do not haul someone up if injury is possible — assess, reassure, follow fallen-person procedure.",
  },
  {
    id: "hswa",
    title: "Health and Safety at Work etc. Act",
    notes:
      "Take reasonable care of yourself and others, follow training, report hazards, and do not carry out tasks you are not competent or authorised to do.",
  },
];

function matchingCustom(scenarioId, openingText) {
  const hay = `${scenarioId} ${openingText || ""}`.toLowerCase();
  const list = loadCustomKnowledge().filter((k) => {
    if (!k.keywords?.length) return scenarioId === "general" || scenarioId === "medication";
    return k.keywords.some((kw) => hay.includes(kw) || scenarioId.includes(kw));
  });
  // For medication, prefer entries that mention refusal / medicine
  if (scenarioId === "medication") {
    const stronger = list.filter((k) =>
      /\b(medicine|medication|meds|refus|tablet|mar)\b/i.test(
        `${k.title} ${k.body} ${(k.keywords || []).join(" ")}`,
      ),
    );
    return stronger.length ? stronger : list;
  }
  return list;
}

export function adviceForScenario(scenarioId, openingText = "") {
  const commonDo = [
    "Stay calm and reassure the person.",
    "Check for immediate danger to them and you.",
    "Follow your service’s escalation pathway (nurse in charge / on-call / 999).",
    "Document facts: what you saw, what you did, time, who was informed.",
  ];
  const commonDont = [
    "Don’t leave an unsafe situation to ‘write the note first’.",
    "Don’t use restrictive holds unless you are currently trained, authorised, and it is a last resort under policy.",
    "Don’t blame the person in the record — stick to observable facts.",
  ];

  const map = {
    fall: {
      pillars: ["moving_assisting", "seniors", "hswa"],
      do: [
        ...commonDo,
        "If injury may be present, do not pull them up — keep them comfortable, check responsiveness, and get clinical advice.",
        "Look for head injury signs, pain, limb deformity, bleeding, and sudden confusion.",
        "After safe recovery, review footwear, mobility aid, lighting, and observation level.",
      ],
      dont: [
        ...commonDont,
        "Don’t use a fireman’s lift or unplanned manual lift.",
        "Don’t dismiss an unwitnessed fall — treat it seriously until assessed.",
        "Don’t delay informing the nurse in charge / family when policy requires it.",
      ],
    },
    skin: {
      pillars: ["seniors", "hswa"],
      do: [
        ...commonDo,
        "Note exact site, size/appearance if trained to, pain, and whether skin is broken.",
        "Reposition as care plan allows; keep pressure off the area.",
        "Inform nurse in charge for grading / dressing decisions if required.",
      ],
      dont: [
        ...commonDont,
        "Don’t apply creams or dressings outside your role/competence.",
        "Don’t ignore unbroken redness over a bony area.",
      ],
    },
    dysphagia: {
      pillars: ["dysphagia", "oliver_mcgowan", "seniors"],
      do: [
        ...commonDo,
        "Stop oral intake if coughing, choking, wet voice, or colour change.",
        "Keep upright; follow prescribed texture/fluid level only.",
        "Call for help early — choking is time-critical.",
      ],
      dont: [
        ...commonDont,
        "Don’t give food/drink against the dysphagia plan.",
        "Don’t leave someone alone while eating if supervision is required.",
        "Don’t do blind finger sweeps if choking.",
      ],
    },
    distress: {
      pillars: ["pmva_mapa", "oliver_mcgowan", "ligature", "hswa"],
      do: [
        ...commonDo,
        "Reduce stimulation, give space, use calm simple language, and offer known soothing strategies from the care plan.",
        "Scan for environmental risk (ligature points, weapons, exits) without escalating conflict.",
        "Call for trained support early; protect yourself and others.",
      ],
      dont: [
        ...commonDont,
        "Don’t crowd, shout, or threaten.",
        "Don’t use physical intervention unless trained, authorised, proportionate, and necessary as a last resort.",
        "Don’t ignore ligature risk to ‘talk it out’ from a distance if the person is in immediate danger — get help now.",
      ],
    },
    wellbeing: {
      pillars: ["seniors", "oliver_mcgowan"],
      do: [
        ...commonDo,
        "Ask about pain, mood, appetite, and what matters to them today.",
        "Note changes from their usual baseline.",
      ],
      dont: [
        ...commonDont,
        "Don’t skip hydration/nutrition checks when someone seems ‘fine’ but quieter than usual.",
      ],
    },
    medication: {
      pillars: ["hswa", "seniors"],
      do: [
        "Stay calm and do not force medicine.",
        "Follow your home’s medication / MAR policy and the person’s care plan.",
        "Inform the nurse in charge / on-call promptly.",
        "Document facts: what was offered, what was refused, time, and who was informed.",
      ],
      dont: [
        "Don’t hide medicine in food/drink unless the care plan and policy explicitly allow covert administration by authorised staff.",
        "Don’t force, threaten, or restrain someone to take medicine.",
        "Don’t leave a refused critical dose unreported.",
      ],
    },
    general: {
      pillars: ["hswa", "seniors"],
      do: commonDo,
      dont: commonDont,
    },
  };

  const block = { ...(map[scenarioId] || map.general) };
  const custom = matchingCustom(scenarioId, openingText);
  for (const k of custom) {
    if (k.doList?.length) block.do = [...block.do, ...k.doList];
    if (k.dontList?.length) block.dont = [...block.dont, ...k.dontList];
  }

  const pillarText = KNOWLEDGE_PILLARS.filter((p) => block.pillars.includes(p.id)).map(
    (p) => `${p.title}: ${p.notes}`,
  );
  const trainedText = custom.map((k) => `${k.title}: ${k.body}`);
  const images = visualsForAdvice(scenarioId, custom);
  return { ...block, pillarText, trainedText, custom, images };
}
