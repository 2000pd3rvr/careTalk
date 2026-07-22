/** Keep logged-in carer separate from resident / service user names. */

export function normalizeNameKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z'-]/g, "");
}

export function namesMatch(a, b) {
  const na = normalizeNameKey(a);
  const nb = normalizeNameKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const fa = na.split(/\s+/)[0];
  const fb = nb.split(/\s+/)[0];
  return fa.length > 1 && fa === fb;
}

export function carerFirstName(fullName) {
  const n = String(fullName || "").trim();
  if (!n) return "";
  return n.split(/\s+/)[0];
}

export function isCarerName(candidate, carerFullName) {
  return namesMatch(candidate, carerFullName);
}

export function answerEchoesQuestion(answer, questionAsk) {
  const a = String(answer || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s'-]/g, "");
  const q = String(questionAsk || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s'-]/g, "");
  if (!a || !q) return false;
  if (a === q) return true;
  if (a.length > 8 && q.includes(a)) return true;
  if (q.length > 12 && a.includes(q.slice(0, Math.min(24, q.length)))) return true;
  return false;
}

/** Yes/no before careTalk has an answer to check. */
export function isPrematureConfirmToken(text, docTurn) {
  if (docTurn !== "waiting_answer") return false;
  return /^(yes|yeah|yep|yup|no|nope|nah|ok|okay|correct|right|wrong)$/i.test(String(text || "").trim());
}
