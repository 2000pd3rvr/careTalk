/**
 * careTalk’s spoken voice — male UK preference, paced delivery, thinking pauses.
 */

const VOICE_PREF_KEY = "don.voice.name";

/** Pause after the carer stops talking before careTalk thinks/responds (feels human, avoids overlap). */
export function computeThinkDelayMs(text = "") {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.min(1800, 400 + words * 70);
}

/** Extra silence after careTalk finishes TTS before mic reopens. */
export const POST_SPEECH_MIC_DELAY_MS = 450;

export function pickDonVoice() {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;

  const saved = localStorage.getItem(VOICE_PREF_KEY);
  if (saved) {
    const exact = voices.find((v) => v.name === saved);
    if (exact) return exact;
  }

  const gb = voices.filter((v) => /en-GB/i.test(v.lang));
  const maleHint =
    /daniel|arthur|oliver|malcolm|james|thomas|ralph|gordon|uk english male|google uk english male|microsoft.*male|lee\b|aaron|nathan|fred/i;
  const femaleHint = /female|woman|samantha|moira|martha|serena|victoria|kate|fiona|zira|susan|hazel|emma|amy/i;

  let pick =
    gb.find((v) => maleHint.test(v.name)) ||
    gb.find((v) => !femaleHint.test(v.name)) ||
    voices.find((v) => maleHint.test(v.name)) ||
    gb[0] ||
    voices.find((v) => /^en(-GB|-US)?/i.test(v.lang));

  if (pick?.name) {
    try {
      localStorage.setItem(VOICE_PREF_KEY, pick.name);
    } catch {
      /* ignore */
    }
  }
  return pick || null;
}

export function warmUpVoices() {
  if (!window.speechSynthesis) return;
  pickDonVoice();
  window.speechSynthesis.getVoices();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
