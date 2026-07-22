/**
 * Landing page: feedback + subscribe for updates.
 */
import {
  APP_VERSION,
  addSubscriber,
} from "./subscribers.js";
import { FEEDBACK_EMAIL, forwardMail } from "./mailForward.js";
import { initTheme } from "./theme.js";

const FEEDBACK_KEY = "caretalk.landing.feedback";

export { FEEDBACK_EMAIL };

function readFeedback() {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeFeedback(list) {
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(list.slice(0, 40)));
}

function roleLabel(value) {
  if (value === "assistant") return "Care assistant / support worker";
  if (value === "supervisor") return "Supervisor / manager / nurse";
  return "Other / interested visitor";
}

/** Fields posted to the mail forwarder (also used as email body content). */
export function buildFeedbackMailFields(entry) {
  return {
    form: "careTalk landing feedback",
    version: String(entry.version || APP_VERSION),
    role: roleLabel(entry.role),
    name: entry.name || "(not given)",
    organisation: entry.org || "(not given)",
    submitted_at: entry.at || new Date().toISOString(),
    message: entry.message || "",
  };
}

function setFeedbackStatus(statusEl, { ok, text }) {
  if (!statusEl) return;
  statusEl.hidden = false;
  statusEl.className = `feedback-status ${ok ? "ok" : "error"}`;
  statusEl.textContent = text;
}

function initFeedbackForm() {
  const form = document.getElementById("feedbackForm");
  const status = document.getElementById("feedbackStatus");
  const submitBtn = form?.querySelector('button[type="submit"]');
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const role = String(data.get("role") || "").trim();
    const message = String(data.get("message") || "").trim();
    const name = String(data.get("name") || "").trim();
    const org = String(data.get("org") || "").trim();
    // Honeypot — bots fill this; humans never see it
    const honey = String(data.get("_honey") || "").trim();

    if (honey) {
      setFeedbackStatus(status, {
        ok: true,
        text: "Thanks — your note was sent.",
      });
      form.reset();
      return;
    }

    if (!role || message.length < 12) {
      setFeedbackStatus(status, {
        ok: false,
        text: "Please choose your role and write at least a short note (12+ characters).",
      });
      return;
    }

    const entry = {
      id: `fb_${Date.now()}`,
      at: new Date().toISOString(),
      version: APP_VERSION,
      role,
      name,
      org,
      message,
    };

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";
    }
    setFeedbackStatus(status, { ok: true, text: "Sending your feedback…" });

    const result = await forwardMail({
      subject: `[careTalk feedback] ${roleLabel(entry.role)} — v${entry.version}`,
      fields: buildFeedbackMailFields(entry),
    });

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send feedback";
    }

    if (!result.ok) {
      // Keep a local backup if email send fails
      const list = [entry, ...readFeedback()];
      writeFeedback(list);
      setFeedbackStatus(status, {
        ok: false,
        text:
          result.error?.includes("confirm") || result.error?.includes("Activation")
            ? "Almost there — check pd3rvr@icloud.com for a one-time FormSubmit confirmation, then send again."
            : `Email send failed (${result.error || "unknown error"}). Please try again.`,
      });
      return;
    }

    writeFeedback([entry, ...readFeedback()]);
    form.reset();

    setFeedbackStatus(status, {
      ok: true,
      text: "Thanks — your feedback was emailed to the careTalk inbox.",
    });
  });
}

function initSubscribeForm() {
  const form = document.getElementById("subscribeForm");
  const status = document.getElementById("subscribeStatus");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const name = String(data.get("name") || "").trim();
    const result = addSubscriber({ email, name, source: "landing" });

    if (!result.ok) {
      if (status) {
        status.hidden = false;
        status.className = "feedback-status error";
        status.textContent = result.error;
      }
      return;
    }

    form.reset();
    if (status) {
      status.hidden = false;
      status.className = "feedback-status ok";
      status.textContent = result.created
        ? "You’re on the list — we’ll use this email for careTalk update notes on this device."
        : "You’re already subscribed with that email on this device.";
    }
  });
}

function initHeroSlides() {
  const slides = [...document.querySelectorAll(".hero-slide")];
  if (slides.length < 2) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let index = slides.findIndex((el) => el.classList.contains("is-active"));
  if (index < 0) index = 0;

  window.setInterval(() => {
    slides[index].classList.remove("is-active");
    index = (index + 1) % slides.length;
    slides[index].classList.add("is-active");
  }, 6200);
}

if (typeof document !== "undefined") {
  initTheme();
  initHeroSlides();
  initSubscribeForm();
  initFeedbackForm();
}
