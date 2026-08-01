/**
 * Shared public feedback feed for the landing ticker.
 * FormSubmit emails the full submission to the inbox; this store holds
 * display-safe fields (name / workplace / role / message) so every visitor
 * sees the same ticker — not only the browser that submitted.
 */
export const FEEDBACK_FEED_URL =
  "https://jsonblob.com/api/jsonBlob/019fbe73-98af-789a-9ebc-7b6a719c712e";

function asList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.entries)) return data.entries;
  return [];
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const message = String(entry.message || "").trim();
  if (!message) return null;
  return {
    id: String(entry.id || `fb_${Date.now()}`),
    at: entry.at || new Date().toISOString(),
    role:
      entry.role === "supervisor" || entry.role === "assistant" || entry.role === "other"
        ? entry.role
        : "other",
    name: String(entry.name || "").trim(),
    org: String(entry.org || "").trim(),
    message: message.slice(0, 2000),
  };
}

/** Deployed JSON fallback (curated / backfilled from FormSubmit inbox). */
export async function fetchDeployedFeedbackFeed() {
  try {
    const res = await fetch("./feedback-feed.json", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    return asList(await res.json()).map(normalizeEntry).filter(Boolean);
  } catch {
    return [];
  }
}

/** Live shared store (successful form posts append here). */
export async function fetchSharedFeedbackFeed() {
  try {
    const res = await fetch(FEEDBACK_FEED_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    return asList(await res.json()).map(normalizeEntry).filter(Boolean);
  } catch {
    return [];
  }
}

/** Merge shared + deployed + local entries (newest first, unique). */
export function mergeFeedbackLists(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const raw of list || []) {
      const entry = normalizeEntry(raw);
      if (!entry) continue;
      const key = entry.id || `${entry.message}|${entry.org}|${entry.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return out.slice(0, 60);
}

/** Append one display entry to the shared live feed (best-effort, retried). */
export async function publishFeedbackToSharedFeed(entry) {
  const publicEntry = normalizeEntry(entry);
  if (!publicEntry) return { ok: false, error: "empty feedback" };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const current = await fetchSharedFeedbackFeed();
      if (current.some((e) => e.id === publicEntry.id)) return { ok: true, already: true };
      if (
        current.some(
          (e) =>
            e.message === publicEntry.message &&
            e.name === publicEntry.name &&
            e.org === publicEntry.org,
        )
      ) {
        return { ok: true, already: true };
      }

      const next = [publicEntry, ...current].slice(0, 60);
      const res = await fetch(FEEDBACK_FEED_URL, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(next),
      });
      if (res.ok) return { ok: true };
    } catch (err) {
      if (attempt === 2) {
        return { ok: false, error: err?.message || "publish failed" };
      }
    }
  }
  return { ok: false, error: "publish failed" };
}
