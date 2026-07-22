import { loadAgencySettings, pushOutbox } from "./store.js";

/**
 * Forward a support-worker report to the care agency.
 * Always saves to on-device outbox; optional webhook POST + email draft.
 */
export async function forwardReportToAgency(reportText, meta = {}) {
  const agency = loadAgencySettings();
  const packet = {
    id: `fwd_${Date.now()}`,
    at: new Date().toISOString(),
    agencyName: agency.name,
    agencyEmail: agency.email,
    carer: meta.carer || "",
    person: meta.person || "",
    scenario: meta.scenario || "",
    report: reportText,
    status: "queued",
    channels: [],
  };

  packet.channels.push("outbox");

  if (agency.webhookUrl) {
    try {
      const res = await fetch(agency.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "don.support_worker_report",
          ...packet,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      packet.channels.push("webhook");
    } catch (err) {
      packet.webhookError = err?.message || "webhook failed";
    }
  }

  if (agency.email) {
    const subject = encodeURIComponent(
      `careTalk support worker report — ${meta.person || "resident"} — ${meta.scenario || "care"}`,
    );
    const body = encodeURIComponent(reportText.slice(0, 1800));
    const mailto = `mailto:${encodeURIComponent(agency.email)}?subject=${subject}&body=${body}`;
    packet.mailto = mailto;
    packet.channels.push("email");
    try {
      const a = document.createElement("a");
      a.href = mailto;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      /* ignore */
    }
  }

  packet.status =
    packet.channels.includes("webhook") || packet.channels.includes("email") ? "sent" : "saved_local";

  pushOutbox(packet);
  return { packet, agency };
}
