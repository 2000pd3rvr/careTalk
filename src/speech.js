import { Capacitor } from "@capacitor/core";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";

export function isNative() {
  return Capacitor.isNativePlatform();
}

export function platform() {
  return Capacitor.getPlatform();
}

/**
 * Web speech with explicit mic unlock first.
 * Chrome’s SpeechRecognition often throws "audio-capture" if permission
 * was never granted via getUserMedia, or if the mic is busy.
 */
export function createSpeechController({
  onFinal,
  onPartial,
  onStart,
  onEnd,
  onError,
  lang = "en-GB",
}) {
  let active = false;
  let recognition = null;
  let nativePartialListener = null;
  let nativeStateListener = null;
  let shouldRun = false;
  let lastPartial = "";
  let lastFinalAt = 0;
  let lastFinalText = "";
  let partialTimer = null;
  let restartTimer = null;
  let usingLang = lang;
  let starting = false;
  let pausedForTts = false;
  let inputBlocked = false;
  let audioCaptureFails = 0;
  let micLabel = "";

  function isJunkTranscript(text) {
    const t = String(text || "").trim();
    if (!t) return true;
    // Page URL / host leaking into ASR or status echoes
    try {
      if (t === window.location.href || t === window.location.origin || t === window.location.host) return true;
      if (t === `${window.location.protocol}//${window.location.host}`) return true;
    } catch {
      /* ignore */
    }
    if (/^https?:\/\//i.test(t)) return true;
    if (/\blocalhost(:\d+)?\b/i.test(t) || /\b127\.0\.0\.1\b/.test(t)) return true;
    if (/mic (issue|blocked|busy)|speech needs internet|no microphone|asking for microphone/i.test(t)) {
      return true;
    }
    // Need at least one real word (letters)
    if (!/[a-zA-Z]{2,}/.test(t)) return true;
    return false;
  }

  function emitFinal(text) {
    const t = String(text || "").trim();
    if (!t || isJunkTranscript(t)) return;
    if (inputBlocked || pausedForTts) return;
    const now = Date.now();
    if (t.toLowerCase() === lastFinalText.toLowerCase() && now - lastFinalAt < 1200) return;
    lastFinalText = t;
    lastFinalAt = now;
    lastPartial = "";
    clearTimeout(partialTimer);
    onFinal?.(t);
  }

  function schedulePartialFinal(text) {
    const t = String(text || "").trim();
    if (!t || isJunkTranscript(t)) return;
    lastPartial = t;
    onPartial?.(t);
    clearTimeout(partialTimer);
    // Wait for a natural pause — longer utterances need more silence
    const words = t.split(/\s+/).filter(Boolean).length;
    const delay = words <= 3 ? 1100 : words <= 8 ? 1500 : 1900;
    partialTimer = setTimeout(() => {
      if (lastPartial === t && !inputBlocked && !pausedForTts) emitFinal(t);
    }, delay);
  }

  function pickChunk(result) {
    let chunk = "";
    for (let a = 0; a < result.length; a += 1) {
      const cand = (result[a]?.transcript || "").trim();
      if (!cand) continue;
      if (!chunk) chunk = cand;
      if (/\b(don|dawn|done|dom|dun|donn|donald)\b/i.test(cand)) {
        chunk = cand;
        break;
      }
    }
    return chunk;
  }

  /**
   * Ask for mic permission and prove a capture device exists.
   * Releases the stream before SpeechRecognition starts.
   */
  async function unlockMicrophone() {
    if (!window.isSecureContext) {
      throw new Error("Mic blocked on insecure URL — open http://localhost:5173 in Chrome");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This window can’t use the mic — open the app in Chrome or Edge");
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = err?.name || "";
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        throw new Error("No microphone detected — plug one in (System Settings → Sound → Input)");
      }
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        throw new Error("Microphone permission denied — click the lock icon → Microphone → Allow");
      }
      if (name === "NotReadableError" || name === "TrackStartError") {
        throw new Error("Microphone is busy — quit Zoom/Teams/FaceTime/OBS, then tap the mic again");
      }
      throw new Error(err?.message || "Could not open microphone");
    }

    const track = stream.getAudioTracks()[0];
    micLabel = track?.label || "Microphone";
    // Prove audio is actually live briefly
    if (track && track.readyState !== "live") {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Microphone track inactive — check Mac Sound input device");
    }

    stream.getTracks().forEach((t) => t.stop());
    // Give the OS a moment to release the device for SpeechRecognition
    await new Promise((r) => setTimeout(r, 180));

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      if (!inputs.length) {
        throw new Error("No audio input devices listed — check System Settings → Sound → Input");
      }
    } catch (err) {
      if (err?.message?.startsWith("No audio")) throw err;
      /* enumerate can fail before permission; ignore */
    }

    return micLabel;
  }

  function safeStartWeb() {
    if (!shouldRun || !recognition || starting || pausedForTts) return;
    starting = true;
    try {
      recognition.lang = usingLang;
      recognition.start();
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (!/already started|InvalidStateError/i.test(msg)) {
        onError?.(msg || "Could not start mic");
      }
    } finally {
      setTimeout(() => {
        starting = false;
      }, 300);
    }
  }

  function scheduleRestart(delay = 300) {
    if (!shouldRun || pausedForTts) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (!shouldRun || pausedForTts) return;
      safeStartWeb();
    }, delay);
  }

  function ensureWebRecognition() {
    if (recognition) return recognition;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      throw new Error("Speech not supported here — use Chrome or Edge (not Safari), or type to careTalk");
    }

    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;
    recognition.lang = usingLang;

    recognition.onstart = () => {
      active = true;
      starting = false;
      audioCaptureFails = 0;
      onStart?.();
    };

    recognition.onend = () => {
      active = false;
      onEnd?.();
      if (pausedForTts) return;
      // Do NOT flush partials here — Chrome restarts often and that was
      // inventing fake user lines (e.g. page URL / noise).
      clearTimeout(partialTimer);
      lastPartial = "";
      scheduleRestart(320);
    };

    recognition.onerror = (event) => {
      const err = event.error;
      if (err === "aborted") return;
      if (err === "no-speech") return;

      if (err === "audio-capture") {
        audioCaptureFails += 1;
        if (audioCaptureFails <= 2 && shouldRun) {
          onError?.("Mic busy — retrying… close other apps using the mic");
          // Re-unlock then restart
          clearTimeout(restartTimer);
          restartTimer = setTimeout(async () => {
            if (!shouldRun) return;
            try {
              await unlockMicrophone();
              safeStartWeb();
            } catch (e) {
              shouldRun = false;
              onError?.(e?.message || "no microphone available");
            }
          }, 600);
          return;
        }
        shouldRun = false;
        onError?.(
          micLabel
            ? `Can’t capture “${micLabel}” — quit Zoom/Teams/FaceTime, allow mic for this site, tap again`
            : "Can’t open microphone — allow mic in the address bar, quit apps using the mic, use Chrome on localhost",
        );
        return;
      }

      if (err === "not-allowed" || err === "service-not-allowed") {
        shouldRun = false;
        onError?.("Mic blocked — lock icon in address bar → Microphone → Allow, then tap mic");
        return;
      }
      if (err === "network") {
        onError?.("Speech needs internet (Chrome voice service)");
        scheduleRestart(1200);
        return;
      }
      if (err === "language-not-supported" && usingLang !== "en-US") {
        usingLang = "en-US";
        recognition.lang = usingLang;
        scheduleRestart(300);
        return;
      }
      onError?.(err);
      scheduleRestart(500);
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const chunk = pickChunk(result);
        if (!chunk || isJunkTranscript(chunk)) continue;
        // Prefer real finals from the engine; only use partial timer as backup
        if (result.isFinal) {
          if (!inputBlocked && !pausedForTts) emitFinal(chunk);
        } else interim += `${chunk} `;
      }
      if (interim.trim() && !inputBlocked) {
        onPartial?.(interim.trim());
        lastPartial = interim.trim();
        schedulePartialFinal(interim.trim());
      }
    };

    return recognition;
  }

  async function ensureNativePermission() {
    const avail = await SpeechRecognition.available();
    if (!avail?.available) throw new Error("Speech recognition unavailable on this device");
    const perm = await SpeechRecognition.checkPermissions();
    if (perm.speechRecognition !== "granted") {
      const req = await SpeechRecognition.requestPermissions();
      if (req.speechRecognition !== "granted") throw new Error("Microphone / speech permission denied");
    }
  }

  async function startNative() {
    await ensureNativePermission();
    lastPartial = "";
    nativePartialListener = await SpeechRecognition.addListener("partialResults", (data) => {
      const text = (data?.matches || []).filter(Boolean).join(" ").trim();
      if (!text) return;
      schedulePartialFinal(text);
    });
    nativeStateListener = await SpeechRecognition.addListener("listeningState", (data) => {
      if (data.status === "started") {
        active = true;
        onStart?.();
      }
      if (data.status === "stopped") {
        active = false;
        onEnd?.();
        if (shouldRun && !pausedForTts) {
          clearTimeout(restartTimer);
          restartTimer = setTimeout(() => {
            if (shouldRun) startNative().catch((e) => onError?.(e?.message || "mic restart failed"));
          }, 400);
        }
      }
    });
    await SpeechRecognition.start({
      language: usingLang,
      maxResults: 5,
      partialResults: true,
      popup: false,
    });
    active = true;
    onStart?.();
  }

  async function stopNative() {
    clearTimeout(partialTimer);
    clearTimeout(restartTimer);
    try {
      await SpeechRecognition.stop();
    } catch {
      /* ignore */
    }
    if (lastPartial && !isJunkTranscript(lastPartial)) emitFinal(lastPartial);
    try {
      await nativePartialListener?.remove();
      await nativeStateListener?.remove();
    } catch {
      /* ignore */
    }
    nativePartialListener = null;
    nativeStateListener = null;
    active = false;
    onEnd?.();
  }

  return {
    get listening() {
      return active;
    },
    get micLabel() {
      return micLabel;
    },
    setInputBlocked(block) {
      inputBlocked = Boolean(block);
      if (inputBlocked) {
        clearTimeout(partialTimer);
        lastPartial = "";
      }
    },
    async start() {
      shouldRun = true;
      pausedForTts = false;
      lastPartial = "";
      audioCaptureFails = 0;
      if (isNative()) {
        await startNative();
        return;
      }
      const label = await unlockMicrophone();
      void label;
      ensureWebRecognition();
      safeStartWeb();
    },
    async pause() {
      pausedForTts = true;
      inputBlocked = true;
      clearTimeout(restartTimer);
      clearTimeout(partialTimer);
      if (isNative()) {
        try {
          await SpeechRecognition.stop();
        } catch {
          /* ignore */
        }
        active = false;
        onEnd?.();
        return;
      }
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
      active = false;
      onEnd?.();
    },
    async resume() {
      pausedForTts = false;
      inputBlocked = false;
      shouldRun = true;
      if (isNative()) {
        await startNative();
        return;
      }
      safeStartWeb();
    },
    async stop() {
      shouldRun = false;
      pausedForTts = false;
      clearTimeout(restartTimer);
      clearTimeout(partialTimer);
      starting = false;
      if (isNative()) {
        await stopNative();
        return;
      }
      const pending = lastPartial;
      lastPartial = "";
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
      // Only flush on intentional stop if it looks like real speech
      if (pending && !isJunkTranscript(pending)) emitFinal(pending);
      active = false;
      onEnd?.();
    },
  };
}
