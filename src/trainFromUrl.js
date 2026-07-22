/**
 * Pull knowledge from a URL and shape it for careTalk’s training store.
 * Uses direct fetch when CORS allows; falls back to Jina Reader text proxy.
 */

const CARE_TERMS = [
  "fall",
  "falls",
  "choking",
  "dysphagia",
  "swallow",
  "ligature",
  "restraint",
  "pmva",
  "mapa",
  "safeguarding",
  "pressure",
  "ulcer",
  "medication",
  "dementia",
  "autism",
  "learning disability",
  "infection",
  "hydration",
  "nutrition",
  "moving",
  "handling",
  "emergency",
  "999",
  "consent",
  "capacity",
  "dignity",
  "observation",
  "risk",
];

function normalizeUrl(input) {
  let u = String(input || "").trim();
  if (!u) throw new Error("Enter a URL");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error("That doesn’t look like a valid URL");
  }
  if (!/^https?:$/i.test(parsed.protocol)) throw new Error("Only http(s) URLs are supported");
  return parsed.href;
}

function stripHtml(html, pageUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, svg, iframe").forEach((n) => n.remove());
  const title = (doc.querySelector("title")?.textContent || "").trim();
  const main =
    doc.querySelector("article, main, [role='main'], .content, #content") || doc.body;
  const text = (main?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const images = [];
  const og = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
  if (og) images.push(absolutize(og, pageUrl));
  main?.querySelectorAll("img[src]")?.forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) return;
    if (/pixel|spacer|icon|logo|avatar|sprite/i.test(src)) return;
    const w = Number(img.getAttribute("width") || 0);
    const h = Number(img.getAttribute("height") || 0);
    if ((w && w < 80) || (h && h < 80)) return;
    images.push(absolutize(src, pageUrl));
  });

  return { title, text, images: [...new Set(images)].slice(0, 6) };
}

function absolutize(src, pageUrl) {
  try {
    return new URL(src, pageUrl).href;
  } catch {
    return src;
  }
}

async function fetchTextFromUrl(url) {
  // 1) Direct fetch (works for CORS-friendly sources)
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (res.ok) {
      const ctype = res.headers.get("content-type") || "";
      const raw = await res.text();
      if (/html/i.test(ctype) || /<html/i.test(raw.slice(0, 200))) {
        const { title, text, images } = stripHtml(raw, url);
        if (text.length > 80) return { title, text, images, via: "direct" };
      } else if (raw.trim().length > 80) {
        return { title: "", text: raw.trim(), images: [], via: "direct" };
      }
    }
  } catch {
    /* CORS or network — try reader */
  }

  // 2) Jina Reader — returns readable page text, usually CORS-ok
  const readerUrl = `https://r.jina.ai/${url}`;
  const res = await fetch(readerUrl, {
    headers: { Accept: "text/plain" },
  });
  if (!res.ok) {
    throw new Error(`Could not read that page (HTTP ${res.status}). Try another URL or paste the text manually.`);
  }
  const text = (await res.text()).trim();
  if (text.length < 40) throw new Error("Page returned almost no text to train from");
  const titleMatch = text.match(/^Title:\s*(.+)$/im);
  // Pull markdown images ![alt](url)
  const images = [];
  for (const m of text.matchAll(/!\[[^\]]*]\((https?:[^)\s]+)\)/g)) {
    images.push(m[1]);
  }
  return {
    title: titleMatch?.[1]?.trim() || "",
    text,
    images: [...new Set(images)].slice(0, 6),
    via: "reader",
  };
}

function linesOf(text) {
  return String(text || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function extractDoDont(text) {
  const doList = [];
  const dontList = [];
  for (const line of linesOf(text)) {
    const clean = line.replace(/^[-*•\d.)\s]+/, "").trim();
    if (!clean || clean.length > 220) continue;
    if (/^(don'?t|do not|never|avoid)\b/i.test(clean) || /\bdon'?t\b/i.test(clean.slice(0, 40))) {
      dontList.push(clean.replace(/^(don'?t|do not)\s+/i, "Don’t "));
    } else if (/^(do|always|ensure|must|should)\b/i.test(clean) && !/^don'?t/i.test(clean)) {
      doList.push(clean.replace(/^do\s+/i, ""));
    }
  }
  return {
    doList: [...new Set(doList)].slice(0, 12),
    dontList: [...new Set(dontList)].slice(0, 10),
  };
}

function extractKeywords(text, title) {
  const hay = `${title} ${text}`.toLowerCase();
  const found = CARE_TERMS.filter((t) => hay.includes(t));
  // also pull a few capitalized tokens that look like topics
  const extras = (title.match(/\b[A-Z][a-z]{3,}\b/g) || []).map((x) => x.toLowerCase());
  return [...new Set([...found, ...extras])].slice(0, 12);
}

function summariseBody(text, maxChars = 1400) {
  // Prefer markdown-ish paragraphs; drop reader chrome
  let body = text
    .replace(/^URL Source:.*$/gim, "")
    .replace(/^Markdown Content:.*$/gim, "")
    .replace(/^Title:.*$/gim, "")
    .replace(/^Published Time:.*$/gim, "")
    .trim();

  const paras = body
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 40);

  let out = "";
  for (const p of paras) {
    if (out.length + p.length + 1 > maxChars) break;
    out += (out ? "\n\n" : "") + p;
  }
  if (!out) out = body.slice(0, maxChars);
  return out.trim();
}

function titleFrom(url, fetchedTitle, body) {
  if (fetchedTitle && fetchedTitle.length > 3 && !/^untitled$/i.test(fetchedTitle)) {
    return fetchedTitle.slice(0, 120);
  }
  const first = body.split(/\n/)[0]?.replace(/^#+\s*/, "").trim();
  if (first && first.length > 8 && first.length < 120) return first;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return `Knowledge from ${host}`;
  } catch {
    return "Imported knowledge";
  }
}

/**
 * Fetch a URL and produce a knowledge entry draft for careTalk.
 * @param {string} urlInput
 * @returns {Promise<{title:string, body:string, keywords:string, doList:string, dontList:string, sourceUrl:string, via:string, chars:number}>}
 */
export async function trainFromUrl(urlInput) {
  const sourceUrl = normalizeUrl(urlInput);
  const { title: fetchedTitle, text, images = [], via } = await fetchTextFromUrl(sourceUrl);
  const body = summariseBody(text);
  if (body.length < 60) throw new Error("Not enough readable content on that page to train careTalk");

  const title = titleFrom(sourceUrl, fetchedTitle, body);
  const { doList, dontList } = extractDoDont(text);
  const keywords = extractKeywords(body, title);

  return {
    title,
    body,
    keywords: keywords.join(", "),
    doList: doList.join("\n"),
    dontList: dontList.join("\n"),
    images,
    sourceUrl,
    via,
    chars: body.length,
  };
}
