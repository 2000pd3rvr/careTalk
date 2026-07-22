/**
 * Discreet ops admin: sign in and review update subscribers collected on this device.
 */
import {
  APP_VERSION,
  clearSubscribers,
  isUpdatesAdminAuthed,
  readSubscribers,
  removeSubscriber,
  signInUpdatesAdmin,
  signOutUpdatesAdmin,
  subscribersToCsv,
} from "./subscribers.js";
import { initTheme } from "./theme.js";

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function showPanel(authed) {
  const login = document.getElementById("adminLogin");
  const panel = document.getElementById("adminPanel");
  if (login) login.hidden = authed;
  if (panel) panel.hidden = !authed;
}

function renderList() {
  const list = readSubscribers();
  const tbody = document.getElementById("subscriberRows");
  const empty = document.getElementById("subscriberEmpty");
  const count = document.getElementById("subscriberCount");
  if (count) count.textContent = String(list.length);
  if (!tbody) return;

  tbody.innerHTML = list
    .map(
      (row) => `<tr data-id="${escapeHtml(row.id)}">
        <td>${escapeHtml(row.email)}</td>
        <td>${escapeHtml(row.name || "—")}</td>
        <td>${escapeHtml(formatWhen(row.at))}</td>
        <td>${escapeHtml(row.version || "—")}</td>
        <td>
          <button type="button" class="btn btn-ghost btn-tiny" data-remove="${escapeHtml(row.id)}">Remove</button>
        </td>
      </tr>`,
    )
    .join("");

  if (empty) empty.hidden = list.length > 0;
}

function downloadCsv() {
  const csv = subscribersToCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `caretalk-subscribers-${APP_VERSION}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function init() {
  initTheme();
  const verEls = document.querySelectorAll("[data-app-version]");
  verEls.forEach((el) => {
    el.textContent = APP_VERSION;
  });

  const authed = isUpdatesAdminAuthed();
  showPanel(authed);
  if (authed) renderList();

  const form = document.getElementById("adminLoginForm");
  const status = document.getElementById("adminLoginStatus");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const result = signInUpdatesAdmin(data.get("username"), data.get("password"));
    if (!result.ok) {
      if (status) {
        status.hidden = false;
        status.className = "feedback-status error";
        status.textContent = result.error;
      }
      return;
    }
    if (status) status.hidden = true;
    form.reset();
    showPanel(true);
    renderList();
  });

  document.getElementById("adminSignOut")?.addEventListener("click", () => {
    signOutUpdatesAdmin();
    showPanel(false);
  });

  document.getElementById("exportSubscribers")?.addEventListener("click", downloadCsv);

  document.getElementById("clearSubscribers")?.addEventListener("click", () => {
    if (!window.confirm("Remove every subscriber on this device?")) return;
    clearSubscribers();
    renderList();
  });

  document.getElementById("subscriberRows")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-remove]");
    if (!btn) return;
    removeSubscriber(btn.getAttribute("data-remove"));
    renderList();
  });
}

init();
