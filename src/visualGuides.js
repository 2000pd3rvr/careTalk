/**
 * Visual action guides careTalk shows carers when steps are easier with a picture.
 */

/** @typedef {{ id: string, title: string, caption: string, src: string, alt: string }} GuideImage */

/** @type {Record<string, GuideImage[]>} */
export const SCENARIO_VISUALS = {
  fall: [
    {
      id: "fall-assess",
      title: "Assess first",
      caption: "Stay with them, check responsiveness and injury before any move.",
      src: "/guides/fall-assess.svg",
      alt: "Carer kneeling beside a person on the floor after a fall, asking if they are hurt",
    },
    {
      id: "fall-no-lift",
      title: "Don’t haul them up",
      caption: "If injury may be present, keep them comfortable and get clinical advice.",
      src: "/guides/fall-no-lift.svg",
      alt: "Warning not to lift a fallen person without assessment",
    },
  ],
  dysphagia: [
    {
      id: "dysphagia-upright",
      title: "Sit upright",
      caption: "Upright posture for eating and drinking; follow texture plan.",
      src: "/guides/dysphagia-upright.svg",
      alt: "Person sitting upright in a chair for safe eating and drinking",
    },
    {
      id: "dysphagia-stop",
      title: "Stop if choking signs",
      caption: "Coughing, wet voice or colour change — stop intake and call for help.",
      src: "/guides/dysphagia-stop.svg",
      alt: "Stop cup or food when choking warning signs appear",
    },
  ],
  distress: [
    {
      id: "distress-space",
      title: "Give space",
      caption: "Reduce stimulation, keep a calm distance, use care-plan strategies.",
      src: "/guides/distress-space.svg",
      alt: "Carer giving a person space during distress",
    },
  ],
  skin: [
    {
      id: "skin-check",
      title: "Note site & look",
      caption: "Record exact site, appearance and pain; escalate for grading/dressings.",
      src: "/guides/skin-check.svg",
      alt: "Diagram highlighting checking pressure areas on the body",
    },
  ],
};

/**
 * Merge built-in scenario visuals with images from trained knowledge entries.
 * @param {string} scenarioId
 * @param {Array<{ title?: string, images?: string[], body?: string }>} custom
 * @returns {GuideImage[]}
 */
export function visualsForAdvice(scenarioId, custom = []) {
  const builtIn = SCENARIO_VISUALS[scenarioId] || [];
  const trained = [];
  for (const k of custom) {
    const urls = Array.isArray(k.images) ? k.images : [];
    urls.forEach((src, i) => {
      const url = String(src || "").trim();
      if (!url) return;
      trained.push({
        id: `trained_${k.id || i}_${i}`,
        title: k.title || "Home training image",
        caption: "From your home’s trained knowledge",
        src: url,
        alt: `${k.title || "Training"} illustration ${i + 1}`,
      });
    });
  }
  // Deduplicate by src
  const seen = new Set();
  return [...builtIn, ...trained].filter((img) => {
    if (seen.has(img.src)) return false;
    seen.add(img.src);
    return true;
  });
}

/** HTML block for careTalk bubbles — figures with captions. */
export function visualsHtml(images, escapeHtml) {
  if (!images?.length) return "";
  const figures = images
    .map(
      (img) => `
      <figure class="guide-fig">
        <button type="button" class="guide-zoom" data-zoom-src="${escapeHtml(img.src)}" data-zoom-alt="${escapeHtml(
          img.alt || img.title,
        )}" aria-label="Enlarge ${escapeHtml(img.title)}">
          <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt || img.title)}" loading="lazy" />
        </button>
        <figcaption>
          <strong>${escapeHtml(img.title)}</strong>
          <span>${escapeHtml(img.caption || "")}</span>
        </figcaption>
      </figure>`,
    )
    .join("");
  return `
    <div class="guide-strip">
      <p><strong>Show me how</strong> — pictures for this action</p>
      <div class="guide-grid">${figures}</div>
    </div>
  `;
}
