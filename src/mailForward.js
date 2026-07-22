/**
 * Client-side mail forwarding for the static landing page.
 * Uses FormSubmit’s AJAX endpoint so feedback reaches the inbox
 * without opening a device mail app.
 */

export const FEEDBACK_EMAIL = "pd3rvr@icloud.com";

const FORMSUBMIT_AJAX = `https://formsubmit.co/ajax/${encodeURIComponent(FEEDBACK_EMAIL)}`;

/**
 * @param {{
 *   subject: string,
 *   fields: Record<string, string>,
 * }} opts
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function forwardMail({ subject, fields }) {
  const payload = {
    ...fields,
    _subject: subject,
    _template: "table",
    _captcha: "false",
    _honey: "",
  };

  try {
    const res = await fetch(FORMSUBMIT_AJAX, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const msg =
        (data && (data.message || data.error)) ||
        `Mail forward failed (${res.status})`;
      return { ok: false, error: String(msg) };
    }

    // FormSubmit returns { success: "..." } or { error: "..." }
    if (data && data.error) {
      return { ok: false, error: String(data.error) };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: (err && err.message) || "Network error while sending feedback",
    };
  }
}
