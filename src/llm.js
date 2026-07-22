/**
 * Local open-source LLM via Ollama (http://127.0.0.1:11434).
 * Default model: qwen2.5:7b — strong open-weight chat on Apple Silicon.
 * Upgrade anytime: `ollama pull qwen2.5:14b` then set don.llm.model.
 * Falls back gracefully when Ollama is offline.
 */

const DEFAULT_BASE = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen2.5:7b";
const KEYS = {
  enabled: "don.llm.enabled",
  model: "don.llm.model",
  baseUrl: "don.llm.baseUrl",
};

export function getLlmSettings() {
  return {
    enabled: localStorage.getItem(KEYS.enabled) !== "0",
    model: localStorage.getItem(KEYS.model) || DEFAULT_MODEL,
    baseUrl: (localStorage.getItem(KEYS.baseUrl) || DEFAULT_BASE).replace(/\/$/, ""),
  };
}

export function saveLlmSettings({ enabled, model, baseUrl } = {}) {
  if (typeof enabled === "boolean") localStorage.setItem(KEYS.enabled, enabled ? "1" : "0");
  if (model) localStorage.setItem(KEYS.model, String(model).trim());
  if (baseUrl) localStorage.setItem(KEYS.baseUrl, String(baseUrl).trim().replace(/\/$/, ""));
}

export async function probeOllama() {
  const { baseUrl, model, enabled } = getLlmSettings();
  if (!enabled) return { ok: false, reason: "disabled", model, baseUrl };
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { method: "GET" });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, model, baseUrl };
    const data = await res.json();
    const names = (data.models || []).map((m) => m.name);
    const hasModel = names.some((n) => n === model || n.startsWith(`${model}:`) || n.startsWith(`${model.split(":")[0]}:`));
    return {
      ok: true,
      hasModel,
      models: names,
      model,
      baseUrl,
      reason: hasModel ? "ready" : "model_missing",
    };
  } catch (err) {
    return { ok: false, reason: err?.message || "unreachable", model, baseUrl };
  }
}

const SYSTEM_PROMPT = `You are careTalk, a digital head nurse — a calm, experienced male nurse supporting UK adult-care workers on the floor.
You sound like a real person in conversation: warm, steady, unhurried. Use contractions (I'm, we'll, that's). Short sentences. No bullet lists unless listing do/don't steps.

You help with triage chat, practical do/don't guidance, and support-worker documentation — not medical diagnosis.

Rules:
- One thought at a time. Pause mentally — don't rush or talk over the carer.
- Keep replies to 1–3 short spoken sentences unless listing do/don’t steps.
- Ask one useful question at a time, then wait.
- Never invent a resident’s name from words like “something”, “they”, “no”, “else”.
- If the carer says “something else”, treat that as “not fall/distress/swallow/skin/mood” and ask what is happening.
- If they say someone is a “difficult / challenging client”, treat that as behaviour support — stay with that thread.
- Safety first: if urgent danger, tell them to call 999 / get a colleague.
- Do not force medication; escalate refusals to the nurse in charge.
- Prefer observable facts for documentation.
- UK English spelling.

Honesty when unsure (important):
- Only use unsure/training-gap behaviour when the carer is asking for **advice or what to do** — not when they want a **report documented**.
- If they ask to make, write, take, or do a report, document, agency report, or “put on file”, do NOT say you are not trained. Help them record the facts.
- If you are not confident about the subject **and they want guidance**, say so plainly: “I’m not sure about this subject.”
- Do not invent clinical procedures, medicine doses, or home-specific policy.
- Still keep the person safe: tell them to ask the nurse in charge / follow the care plan.
- Then end your reply with exactly this line on its own:
[[ACTION:unsure_subject]]

When you have enough to start structured care guidance on a subject you do know, end with:
[[ACTION:start_care_flow]]
When medicine refusal has no clear home training, end with:
[[ACTION:request_training]]
Otherwise do not invent ACTION tags.`;

/**
 * Chat with the local model. Returns { say, action, raw } or null on failure.
 */
export async function chatWithLocalLlm({
  messages,
  slots = {},
  temperature = 0.38,
} = {}) {
  const { baseUrl, model, enabled } = getLlmSettings();
  if (!enabled) return null;

  const slotNote = [
    slots.carerName
      ? `Support worker speaking (address by first name only — not a resident): ${slots.carerName}`
      : null,
    slots.person ? `Resident/client in this case (not the carer): ${slots.person}` : null,
    slots.scenarioId ? `Topic so far: ${slots.scenarioId}` : null,
    slots.summary ? `Summary so far: ${slots.summary}` : null,
    slots.safetyChecked ? `Safety checked: ${slots.urgency || "noted"}` : null,
    slots.goal ? `Goal: ${slots.goal}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    model,
    stream: false,
    options: {
      temperature,
      num_predict: 220,
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT + (slotNote ? `\n\nCurrent case notes:\n${slotNote}` : "") },
      ...messages,
    ],
  };

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  const raw = String(data?.message?.content || "").trim();
  if (!raw) throw new Error("Empty model reply");

  let action = "none";
  let say = raw
    .replace(/\[\[ACTION:start_care_flow\]\]/gi, () => {
      action = "start_care_flow";
      return "";
    })
    .replace(/\[\[ACTION:request_training\]\]/gi, () => {
      action = "request_training";
      return "";
    })
    .replace(/\[\[ACTION:unsure_subject\]\]/gi, () => {
      action = "unsure_subject";
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Catch natural “I’m not sure about this subject” if the model forgot the tag (advice only — not report requests)
  const lastUser = messages?.length ? String(messages[messages.length - 1]?.content || "") : "";
  if (
    action === "none" &&
    /\bi('?m| am) not sure about (this |the )?subject\b/i.test(say) &&
    !/\b(make|write|take|do|need).{0,16}\breports?\b/i.test(lastUser) &&
    !/\b(document|on file|put on file|take note)\b/i.test(lastUser)
  ) {
    action = "unsure_subject";
  }

  return { say, action, raw, model };
}

export { DEFAULT_MODEL, DEFAULT_BASE };
