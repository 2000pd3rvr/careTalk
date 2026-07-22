/**
 * Landing-page feedback for care assistants & supervisors (device-local + GitHub issue).
 */
const FEEDBACK_KEY = "caretalk.landing.feedback";
const APP_VERSION = "1.1.2";
const ISSUE_URL = "https://github.com/2000pd3rvr/careTalk/issues/new";

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

function openGithubIssue(entry) {
  const title = encodeURIComponent(
    `[Feedback] ${roleLabel(entry.role)} — careTalk ${APP_VERSION}`,
  );
  const body = encodeURIComponent(
    [
      `## Visitor feedback (careTalk ${APP_VERSION})`,
      "",
      `**Role:** ${roleLabel(entry.role)}`,
      entry.name ? `**Name:** ${entry.name}` : null,
      entry.org ? `**Organisation:** ${entry.org}` : null,
      "",
      "### How careTalk might help",
      entry.message,
      "",
      "_Submitted from the public landing page._",
    ]
      .filter((line) => line !== null)
      .join("\n"),
  );
  const url = `${ISSUE_URL}?title=${title}&body=${body}&labels=feedback`;
  window.open(url, "_blank", "noopener,noreferrer");
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
        "Thanks — your note is saved on this device. A GitHub feedback draft will open so we can read it.";
    }

    openGithubIssue(entry);
  });
}

initFeedbackForm();
