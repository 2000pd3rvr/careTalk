/**
 * Landing page: feedback + subscribe for updates.
 */
import {
  APP_VERSION,
  addSubscriber,
} from "./subscribers.js";

const FEEDBACK_KEY = "caretalk.landing.feedback";
/** Inbox for every landing-page feedback submission (opens the device mail app). */
export const FEEDBACK_EMAIL = "pd3rvr@icloud.com";

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

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function roleLabel(value) {
  if (value === "assistant") return "Care assistant / support worker";
  if (value === "supervisor") return "Supervisor / manager / nurse";
  return "Other / interested visitor";
}

function renderWall(list) {
  const wall = document.getElementById("feedbackWall");
  const empty = document.getElementById("feedbackWallEmpty");
  if (!wall) return;

  const items = list.slice(0, 8);
  wall.innerHTML = items
    .map((item) => {
      const when = item.at
        ? new Date(item.at).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : "";
      const who = [item.name, item.org].filter(Boolean).join(" · ");
      return `<article class="feedback-item">
        <p class="feedback-meta">${escapeHtml(roleLabel(item.role))}${when ? ` · ${escapeHtml(when)}` : ""}</p>
        <p class="feedback-body">${escapeHtml(item.message)}</p>
        ${who ? `<p class="feedback-who">${escapeHtml(who)}</p>` : ""}
      </article>`;
    })
    .join("");

  if (empty) empty.hidden = items.length > 0;
}

/** Build a mailto: URL so feedback is addressed to the project inbox. */
export function buildFeedbackMailto(entry) {
  const subject = encodeURIComponent(
    `[careTalk feedback] ${roleLabel(entry.role)} — v${entry.version || APP_VERSION}`,
  );
  const body = encodeURIComponent(
    [
      `careTalk feedback (v${entry.version || APP_VERSION})`,
      "",
      `Role: ${roleLabel(entry.role)}`,
      entry.name ? `Name: ${entry.name}` : null,
      entry.org ? `Organisation: ${entry.org}` : null,
      entry.at ? `Submitted: ${entry.at}` : null,
      "",
      "How careTalk might help:",
      entry.message || "",
      "",
      "— Sent from the careTalk landing page",
    ]
      .filter((line) => line !== null)
      .join("\n"),
  );
  return `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
}

function openFeedbackEmail(entry) {
  const mailto = buildFeedbackMailto(entry);
  try {
    const a = document.createElement("a");
    a.href = mailto;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    window.location.href = mailto;
  }
}

function initFeedbackForm() {
  const form = document.getElementById("feedbackForm");
  const status = document.getElementById("feedbackStatus");
  if (!form) return;

  renderWall(readFeedback());

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const role = String(data.get("role") || "").trim();
    const message = String(data.get("message") || "").trim();
    const name = String(data.get("name") || "").trim();
    const org = String(data.get("org") || "").trim();

    if (!role || message.length < 12) {
      if (status) {
        status.hidden = false;
        status.className = "feedback-status error";
        status.textContent =
          "Please choose your role and write at least a short note (12+ characters).";
      }
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

    const list = [entry, ...readFeedback()];
    writeFeedback(list);
    renderWall(list);
    form.reset();

    if (status) {
      status.hidden = false;
      status.className = "feedback-status ok";
      status.textContent =
        "Thanks — your note is saved on this device. Your email app will open so the message can be sent to pd3rvr@icloud.com.";
    }

    openFeedbackEmail(entry);
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

if (typeof document !== "undefined") {
  initSubscribeForm();
  initFeedbackForm();
}
