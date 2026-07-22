/**
 * Light / dark theme toggle — preference stored in localStorage.
 */

const KEY = "don.ui.theme";
const META = {
  light: "#1e3a5f",
  dark: "#0b1220",
};

function systemTheme() {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return systemTheme();
}

export function getTheme() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return resolveTheme();
}

function updateMeta(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", META[theme] || META.light);
}

function updateToggle(btn, theme) {
  if (!btn) return;
  const next = theme === "dark" ? "light" : "dark";
  btn.setAttribute("aria-label", `Switch to ${next} theme`);
  btn.setAttribute("title", next === "dark" ? "Dark theme" : "Light theme");
  btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  btn.dataset.theme = theme;
}

export function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  updateMeta(t);
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => updateToggle(btn, t));
  return t;
}

export function setTheme(theme) {
  const t = applyTheme(theme);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
  return t;
}

export function toggleTheme() {
  return setTheme(getTheme() === "dark" ? "light" : "dark");
}

/** Apply saved/system theme and wire all [data-theme-toggle] buttons. */
export function initTheme() {
  applyTheme(resolveTheme());
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    if (btn.dataset.themeBound === "1") return;
    btn.dataset.themeBound = "1";
    btn.addEventListener("click", () => toggleTheme());
  });
}
