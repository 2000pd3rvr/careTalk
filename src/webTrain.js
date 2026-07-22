/**
 * Search the web for up-to-date care training pages per topic,
 * then fetch + train careTalk (trusted UK sources preferred).
 */

import { trainFromUrl } from "./trainFromUrl.js";
import {
  addCustomKnowledge,
  loadCustomKnowledge,
  loadCustomTopics,
  markCustomTopicTrained,
} from "./store.js";
import { KNOWLEDGE_PILLARS } from "./knowledge.js";
import { SCENARIOS } from "./flows.js";
import { TRAINING_TOPICS } from "./trainingGaps.js";

const TRUSTED_HOSTS = [
  "gov.uk",
  "nhs.uk",
  "nice.org.uk",
  "scie.org.uk",
  "skillsforcare.org.uk",
  "cqc.org.uk",
  "england.nhs.uk",
  "bild.org.uk",
  "autism.org.uk",
  "mencap.org.uk",
  "alzheimers.org.uk",
  "who.int",
  "wikipedia.org",
];

/** Built-in search plan (pillars, scenarios, capabilities). */
function builtInSearchPlan() {
  return [
    ...KNOWLEDGE_PILLARS.map((p) => ({
      id: `pillar_${p.id}`,
      title: p.title,
      keywords: p.id.replace(/_/g, ", "),
      queries: [
        `${p.title} adult social care UK training`,
        `site:gov.uk OR site:scie.org.uk OR site:skillsforcare.org.uk ${p.title}`,
      ],
      seeds: [],
    })),
    ...SCENARIOS.filter((s) => s.id !== "general").map((s) => ({
      id: `scenario_${s.id}`,
      title: s.label,
      keywords: `${s.id}, ${s.label.toLowerCase()}`,
      queries: [
        `${s.label} care home support worker guidance UK`,
        `site:nhs.uk OR site:gov.uk OR site:scie.org.uk ${s.label} adult social care`,
      ],
      seeds: seedUrlsForScenario(s.id),
    })),
    ...TRAINING_TOPICS.map((t) => ({
      id: `capability_${t.id}`,
      title: t.label,
      keywords: t.keywords.join(", "),
      queries: [
        `${t.label} care home MAR policy UK guidance`,
        `site:gov.uk OR site:scie.org.uk OR site:nice.org.uk ${t.label} adult social care`,
      ],
      seeds: [
        "https://www.scie.org.uk/medication/",
        "https://www.gov.uk/government/publications/administration-of-medication-in-care-homes",
      ],
    })),
  ];
}

function customTopicsPlan() {
  return loadCustomTopics().map((t) => {
    const kw = (t.keywords || []).join(", ") || t.title.toLowerCase();
    return {
      id: t.id,
      title: t.title,
      keywords: kw,
      queries: [
        `${t.title} adult social care UK training guidance`,
        `site:gov.uk OR site:nhs.uk OR site:scie.org.uk OR site:nice.org.uk ${t.title}`,
        `${t.title} care home support worker ${kw}`,
      ],
      seeds: [],
      customTopicId: t.id,
    };
  });
}

function getSearchPlan() {
  return [...builtInSearchPlan(), ...customTopicsPlan()];
}

function seedUrlsForScenario(id) {
  const map = {
    fall: [
      "https://www.nice.org.uk/guidance/cg161",
      "https://www.scie.org.uk/falls-prevention/",
    ],
    dysphagia: [
      "https://www.nhs.uk/conditions/swallowing-problems-dysphagia/",
      "https://www.scie.org.uk/",
    ],
    distress: [
      "https://www.scie.org.uk/person-centred-care/",
      "https://www.gov.uk/government/publications/positive-and-proactive-care-reducing-the-need-for-restrictive-interventions",
    ],
    skin: [
      "https://www.nice.org.uk/guidance/cg179",
      "https://www.nhs.uk/conditions/pressure-sores/",
    ],
    medication: [
      "https://www.scie.org.uk/medication/",
      "https://www.nice.org.uk/guidance/sc1",
    ],
    wellbeing: ["https://www.scie.org.uk/person-centred-care/"],
  };
  return map[id] || [];
}

function isTrusted(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return TRUSTED_HOSTS.some((t) => host === t || host.endsWith(`.${t}`));
  } catch {
    return false;
  }
}

function alreadyHaveSource(url) {
  const list = loadCustomKnowledge();
  return list.some((k) => k.sourceUrl && k.sourceUrl === url);
}

async function searchWikipedia(query) {
  const api = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
    query,
  )}&limit=4&namespace=0&format=json&origin=*`;
  const res = await fetch(api);
  if (!res.ok) return [];
  const data = await res.json();
  const urls = data?.[3] || [];
  return urls.filter((u) => typeof u === "string");
}

async function searchDuckDuckGoViaReader(query) {
  const ddg = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const reader = `https://r.jina.ai/${ddg}`;
  const res = await fetch(reader, { headers: { Accept: "text/plain" } });
  if (!res.ok) return [];
  const text = await res.text();
  const urls = [];
  // Markdown links and raw https URLs
  for (const m of text.matchAll(/https?:\/\/[^\s\)\]\>\"']+/g)) {
    let u = m[0].replace(/[.,;:]+$/, "");
    // DuckDuckGo redirect unwrap
    const uddg = u.match(/uddg=([^&]+)/);
    if (uddg) {
      try {
        u = decodeURIComponent(uddg[1]);
      } catch {
        /* keep */
      }
    }
    if (/duckduckgo\.com|google\.com|bing\.com|facebook\.com/i.test(u)) continue;
    urls.push(u);
  }
  return [...new Set(urls)];
}

/**
 * Find candidate training URLs for one topic.
 */
export async function findTrainingUrlsForTopic(topic, { max = 3 } = {}) {
  const found = [];
  const push = (url) => {
    if (!url || found.includes(url)) return;
    if (alreadyHaveSource(url)) return;
    found.push(url);
  };

  for (const seed of topic.seeds || []) push(seed);

  for (const q of topic.queries || []) {
    if (found.length >= max) break;
    try {
      const wiki = await searchWikipedia(q);
      wiki.filter(isTrusted).forEach(push);
    } catch {
      /* ignore */
    }
    if (found.length >= max) break;
    try {
      const web = await searchDuckDuckGoViaReader(q);
      web.filter(isTrusted).forEach(push);
      // If trusted filter emptied everything, take top non-junk anyway (still http)
      if (!found.length) {
        web.slice(0, 2).forEach(push);
      }
    } catch {
      /* ignore */
    }
  }

  return found.slice(0, max);
}

export function listWebTrainableTopics() {
  return getSearchPlan().map((t) => ({
    id: t.id,
    title: t.title,
    keywords: t.keywords,
  }));
}

/**
 * Search + fetch + save knowledge for each topic.
 * @param {{ onProgress?: (msg: string) => void, topicIds?: string[], maxUrlsPerTopic?: number }} opts
 */
export async function webTrainAllTopics(opts = {}) {
  const {
    onProgress = () => {},
    topicIds = null,
    maxUrlsPerTopic = 2,
  } = opts;

  const fullPlan = getSearchPlan();
  const plan = topicIds?.length ? fullPlan.filter((t) => topicIds.includes(t.id)) : fullPlan;

  const results = [];
  let trained = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < plan.length; i += 1) {
    const topic = plan[i];
    onProgress(`(${i + 1}/${plan.length}) Searching: ${topic.title}…`);

    let urls = [];
    try {
      urls = await findTrainingUrlsForTopic(topic, { max: maxUrlsPerTopic });
    } catch (err) {
      failed += 1;
      results.push({ topic: topic.title, ok: false, error: err?.message || "search failed" });
      onProgress(`Search failed for ${topic.title}: ${err?.message || "error"}`);
      continue;
    }

    if (!urls.length) {
      skipped += 1;
      results.push({ topic: topic.title, ok: false, error: "no trusted URLs found" });
      onProgress(`No new sources for ${topic.title}`);
      continue;
    }

    let gotOne = false;
    for (const url of urls) {
      onProgress(`Fetching ${topic.title} ← ${url}`);
      try {
        const draft = await trainFromUrl(url);
        addCustomKnowledge({
          title: `${topic.title} — ${draft.title}`.slice(0, 140),
          keywords: topic.keywords,
          body: draft.body,
          doList: draft.doList,
          dontList: draft.dontList,
          images: draft.images || [],
          sourceUrl: draft.sourceUrl,
          addedBy: "careTalk web train",
        });
        trained += 1;
        gotOne = true;
        results.push({ topic: topic.title, ok: true, url: draft.sourceUrl });
        onProgress(`Trained: ${topic.title}`);
      } catch (err) {
        failed += 1;
        results.push({ topic: topic.title, ok: false, url, error: err?.message || "fetch failed" });
        onProgress(`Could not train from ${url}: ${err?.message || "error"}`);
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    if (gotOne && topic.customTopicId) markCustomTopicTrained(topic.customTopicId);
  }

  onProgress(`Done. Trained ${trained} source(s). Skipped ${skipped}. Failed ${failed}.`);
  return { trained, skipped, failed, results };
}
