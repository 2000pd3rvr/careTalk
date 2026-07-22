import { createSpeechController } from "./speech.js";
import { bootstrapNativeShell } from "./native.js";
import { DON_META } from "./knowledge.js";
import { visualsHtml } from "./visualGuides.js";
import { forwardReportToAgency } from "./agency.js";
import { createDialogueBrain } from "./dialogue.js";
import { chatWithLocalLlm, probeOllama, getLlmSettings } from "./llm.js";
import { trainFromUrl } from "./trainFromUrl.js";
import { webTrainAllTopics, listWebTrainableTopics } from "./webTrain.js";
import {
  createTrainingIncident,
  reportTrainingGapToAgency,
  listUnresolvedIncidents,
  closeTrainingIncident,
  topicFromUnsureSubject,
} from "./trainingGaps.js";
import { listDonFamiliarTopics } from "./topicCatalog.js";
import {
  ensureDefaultPin,
  verifyTrainPin,
  setTrainPin,
  markTrainAuthed,
  isTrainAuthed,
  loadCustomKnowledge,
  addCustomKnowledge,
  removeCustomKnowledge,
  loadCustomTopics,
  addCustomTopic,
  removeCustomTopic,
  loadAgencySettings,
  saveAgencySettings,
  DEFAULT_PIN,
} from "./store.js";
import {
  getCurrentUser,
  signInUser,
  signOutUser,
  registerUser,
  canAccessModes,
  canAccessMode,
  isAdminUser,
  isApprovedUser,
  listUsersForAdmin,
  approveUser,
  rejectUser,
  loadUsers,
  verifyEmail,
  sendVerificationEmail,
  getUserStatistics,
  setCurrentUserId,
  resetUsersToDefaultAdmin,
  DEFAULT_ADMIN,
  ensureDefaultAdminAccount,
} from "./users.js";
import {
  matchesPinDocumentIntent,
  matchesFullReportRequest,
  matchesReportIntent,
  pinUserReportFromUtterance,
  pinUserReportFromSession,
  touchUserPresence,
  clearUserPresence,
  getAdminUserDashboard,
  getPinnedReportById,
  startLiveReport,
  ingestLiveReportSpeech,
  syncLiveReportFromSession,
  finalizeLiveReport,
} from "./userReports.js";
import { collectUnifiedReportItems } from "./reportIndex.js";
import { groupItemsByCategory } from "./reportCategories.js";
import {
  pickDonVoice,
  warmUpVoices,
  computeThinkDelayMs,
  sleep,
  POST_SPEECH_MIC_DELAY_MS,
} from "./voiceOutput.js";
import {
  isWakeOnly,
  isAmbiguousDonCall,
  mentionsDon,
  stripWake,
  startSession,
  currentQuestion,
  answerAndAdvance,
  buildRecord,
  addVoiceNote,
  greetingOnWake,
  formatAnswerForRecord,
  isConfirmYes,
  isConfirmNo,
  correctionFromUtterance,
  answerLooksTooShort,
  commitDocumentedAnswer,
  buildReportReviewHtml,
} from "./flows.js";
import {
  carerFirstName,
  isCarerName,
  answerEchoesQuestion,
  isPrematureConfirmToken,
} from "./names.js";

const els = {
  modeGate: document.getElementById("modeGate"),
  userAuth: document.getElementById("userAuth"),
  trainAuth: document.getElementById("trainAuth"),
  trainApp: document.getElementById("trainApp"),
  learnApp: document.getElementById("learnApp"),
  reportsApp: document.getElementById("reportsApp"),
  btnLearnMode: document.getElementById("btnLearnMode"),
  btnTrainMode: document.getElementById("btnTrainMode"),
  btnReports: document.getElementById("btnReports"),
  btnSignOut: document.getElementById("btnSignOut"),
  btnOpenAuth: document.getElementById("btnOpenAuth"),
  userAuthBack: document.getElementById("userAuthBack"),
  gateUserLine: document.getElementById("gateUserLine"),
  gateLockHint: document.getElementById("gateLockHint"),
  signInForm: document.getElementById("signInForm"),
  registerForm: document.getElementById("registerForm"),
  verifyEmailForm: document.getElementById("verifyEmailForm"),
  verifyEmail: document.getElementById("verifyEmail"),
  verifyCode: document.getElementById("verifyCode"),
  btnResendCode: document.getElementById("btnResendCode"),
  userAuthPending: document.getElementById("userAuthPending"),
  reportsExit: document.getElementById("reportsExit"),
  reportsList: document.getElementById("reportsList"),
  reportsCount: document.getElementById("reportsCount"),
  reportsDetail: document.getElementById("reportsDetail"),
  authForm: document.getElementById("authForm"),
  authBack: document.getElementById("authBack"),
  trainPin: document.getElementById("trainPin"),
  authHint: document.getElementById("authHint"),
  trainExit: document.getElementById("trainExit"),
  learnExit: document.getElementById("learnExit"),
  topicForm: document.getElementById("topicForm"),
  customTopicList: document.getElementById("customTopicList"),
  urlTrainForm: document.getElementById("urlTrainForm"),
  urlTrainBtn: document.getElementById("urlTrainBtn"),
  urlTrainPreview: document.getElementById("urlTrainPreview"),
  webTrainBtn: document.getElementById("webTrainBtn"),
  webTrainProgress: document.getElementById("webTrainProgress"),
  agencyForm: document.getElementById("agencyForm"),
  pinForm: document.getElementById("pinForm"),
  knowledgeList: document.getElementById("knowledgeList"),
  topicCatalog: document.getElementById("topicCatalog"),
  topicCount: document.getElementById("topicCount"),
  topicSearch: document.getElementById("topicSearch"),
  incidentList: document.getElementById("incidentList"),
  chat: document.getElementById("chat"),
  input: document.getElementById("input"),
  composer: document.getElementById("composer"),
  micBtn: document.getElementById("micBtn"),
  sendBtn: document.getElementById("sendBtn"),
  carerName: document.getElementById("carerName"),
  statusLine: document.getElementById("statusLine"),
  toast: document.getElementById("toast"),
};

let appMode = null; // "learn" | "train"
let session = null;
let speech = null;
let listening = false;
let voiceOn = true;
let toastTimer = null;
let lastHandled = "";
let lastHandledAt = 0;
let donSpeaking = false;
let donProcessing = false;
let lastUserAudioAt = 0;
let speakChain = Promise.resolve();
let wantListenAfterSpeak = false;
let learnReady = false;
const brain = createDialogueBrain();

function getLoggedInCarerName() {
  const u = getCurrentUser();
  const fromProfile = (u?.name || "").trim();
  const fromField = (els.carerName?.value || "").trim();
  return fromProfile || fromField || "Staff";
}

function syncCarerFromProfile() {
  const name = getLoggedInCarerName();
  if (els.carerName) els.carerName.value = (getCurrentUser()?.name || name || "").trim();
  brain.setCarerContext({
    fullName: name,
    firstName: carerFirstName(name),
  });
}
const llmHistory = [];
let llmReady = false;
let llmStatus = "checking…";

async function refreshLlmStatus() {
  const probe = await probeOllama();
  llmReady = Boolean(probe.ok && probe.hasModel);
  const { model } = getLlmSettings();
  if (!probe.ok) {
    llmStatus = probe.reason === "disabled" ? "LLM off" : "Ollama offline — rule brain";
  } else if (!probe.hasModel) {
    llmStatus = `Ollama up — pull ${model}`;
  } else {
    llmStatus = `LLM · ${model}`;
  }
  if (els.statusLine && appMode === "learn" && !session) {
    els.statusLine.textContent = llmStatus;
  }
  return probe;
}

function extractSlotsFromUtterance(raw, slots) {
  const next = { ...slots };
  const carer = getLoggedInCarerName();
  const about = raw.match(/\b(?:with|for|about|client|resident)\s+([A-Z][a-z]{1,20})\b/);
  const bare = raw.match(/^([A-Z][a-z]{1,20})$/);
  const name = about?.[1] || bare?.[1] || "";
  if (
    name &&
    !isCarerName(name, carer) &&
    !/^(Something|They|No|Else|Safe|Yes|Okay|Don|careTalk|CareTalk)$/i.test(name)
  ) {
    next.person = name;
  }
  if (/\b(fall|fell|fallen)\b/i.test(raw)) next.scenarioId = "fall";
  else if (/\b(difficult|challenging|distress|agitated|behaviour|behavior)\b/i.test(raw)) next.scenarioId = "distress";
  else if (/\b(swallow|chok)/i.test(raw)) next.scenarioId = "dysphagia";
  else if (/\b(skin|pressure|sore)\b/i.test(raw)) next.scenarioId = "skin";
  else if (/\b(mood|wellbeing|well-being)\b/i.test(raw)) next.scenarioId = "wellbeing";
  else if (/^something else\b/i.test(raw)) next.scenarioId = next.scenarioId || "general";
  if (/\b(safe|not urgent|no danger)\b/i.test(raw)) {
    next.safetyChecked = true;
    next.urgency = "normal";
  }
  if (raw.split(/\s+/).length >= 5) next.summary = raw;
  return next;
}

async function respondWithLlmOrRules(raw, { fromType = false } = {}) {
  const seeded = fromType && !brain.isOpen() ? `careTalk, ${raw}` : raw;
  const reportAsk = matchesReportIntent(raw);
  // Always run rule brain for wake / ignore / structured actions as safety net
  const rules = brain.respond(seeded);
  if (rules.ignore) return { ...rules, via: "rules" };
  if (rules.action === "stay_quiet" || rules.action === "close") {
    llmHistory.length = 0;
    return { ...rules, via: "rules" };
  }
  if (
    reportAsk &&
    (rules.action === "unsure_subject" || rules.action === "request_training")
  ) {
    return {
      say: "Okay — I'll take this as a report and document what you tell me.",
      status: "Report — documenting",
      action: "start_care_flow",
      reportOnly: true,
      opening: rules.opening || raw,
      keepOpen: true,
      via: "rules",
    };
  }
  if (rules.action === "start_care_flow" || rules.action === "request_training" || rules.action === "unsure_subject") {
    return { ...rules, via: "rules" };
  }

  if (!llmReady || !brain.isOpen()) {
    return { ...rules, via: "rules" };
  }

  // Keep LLM history in sync with the conversation
  llmHistory.push({ role: "user", content: raw });
  if (llmHistory.length > 16) llmHistory.splice(0, llmHistory.length - 16);

  try {
    const slots = {
      ...extractSlotsFromUtterance(raw, brain.getSlots()),
      carerName: getLoggedInCarerName(),
    };
    const llm = await chatWithLocalLlm({
      messages: llmHistory.slice(-12),
      slots,
    });
    if (!llm?.say) return { ...rules, via: "rules" };

    llmHistory.push({ role: "assistant", content: llm.say });

    // Prefer LLM wording; keep structured actions from either side
    let action = llm.action !== "none" ? llm.action : rules.action;
    let reportOnly = rules.reportOnly;
    if (reportAsk && (action === "request_training" || action === "unsure_subject")) {
      action = "start_care_flow";
      reportOnly = true;
    } else if (rules.action === "request_training" || rules.action === "unsure_subject") {
      action = rules.action;
    }

    return {
      say: llm.say,
      status: llmStatus,
      action,
      reportOnly,
      opening: rules.opening || raw,
      trainingTopic: rules.trainingTopic,
      keepOpen: true,
      via: "llm",
    };
  } catch (err) {
    console.warn("LLM fallback:", err);
    llmReady = false;
    llmStatus = "LLM error — rule brain";
    return { ...rules, via: "rules" };
  }
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function showOnly(which) {
  els.modeGate.classList.toggle("hidden", which !== "gate");
  els.userAuth?.classList.toggle("hidden", which !== "user");
  els.trainAuth.classList.toggle("hidden", which !== "auth");
  els.trainApp.classList.toggle("hidden", which !== "train");
  els.learnApp.classList.toggle("hidden", which !== "learn");
  els.reportsApp?.classList.toggle("hidden", which !== "reports");
}

let reportsTab = "all";
let reportsSelectedId = null;
let usersSelectedId = null;
let usersSubPanel = null;
let pendingMode = null;
/** Report Q&A: only accept mic/typed answers when careTalk has finished speaking. */
let docAcceptingAnswer = false;

function setAdviceAwaitingOk(on) {
  if (!session || session.phase !== "advice") return;
  session.adviceAwaitingOk = Boolean(on);
  if (on) {
    els.statusLine.innerHTML = `Your turn — say <strong>okay</strong> when you want the record questions`;
  } else {
    els.statusLine.innerHTML = `careTalk is speaking — <strong>wait</strong> until I ask for okay`;
  }
}

function isAdviceContinuePhrase(raw) {
  const t = stripWake(raw).trim().toLowerCase();
  if (!t) return false;
  if (/^(ok|okay|yes|yeah|yep|yup|ready|continue|go on|go ahead|proceed|start)\b/.test(t)) return true;
  if (/^(ask|questions|document)\b/.test(t)) return true;
  return /\b(okay|ok|ready)\b/.test(t) && /\b(question|record|document)\b/.test(t);
}

function beginQuestionsFromAdvice({ skipIntro = false } = {}) {
  if (!session || session.phase !== "advice") return;
  window.speechSynthesis?.cancel();
  donSpeaking = false;
  setMicInputBlocked(false);
  session.phase = "questions";
  session.adviceAwaitingOk = false;
  setDocAcceptingAnswer(false);
  if (skipIntro) {
    addBubble(
      "don",
      `<p>Alright — record questions only. One at a time, and I’ll check each answer with you.</p>`,
      { speakText: false },
    );
    speak("Alright — record questions only. I'll check each answer with you.", {
      onDone: () => askNextQuestion(),
    });
    return;
  }
  addBubble(
    "don",
    `<p>Good. I’ll ask one question at a time, document your answers, and confirm each one with you before the next.</p>`,
    { speakText: false },
  );
  speak("Good. One question at a time — I'll check each answer with you before the next.", {
    onDone: () => askNextQuestion(),
  });
}

function setDocAcceptingAnswer(on) {
  docAcceptingAnswer = Boolean(on);
  if (!session) return;
  if (on) {
    if (session.phase === "report_review") {
      els.statusLine.textContent = "Your turn — is this report correct?";
    } else if (session.docTurn === "confirming") {
      els.statusLine.textContent = "Your turn — yes, or no and what to change";
    } else {
      els.statusLine.textContent = "Your turn — answer for the record";
    }
  } else if (session.phase === "questions" || session.phase === "report_review") {
    els.statusLine.innerHTML = `careTalk is speaking — <strong>wait</strong> until you hear your turn`;
  }
}

function refreshGateSession() {
  const user = getCurrentUser();
  if (user) syncCarerFromProfile();
  const approved = canAccessModes(user);
  const admin = isAdminUser(user);
  if (els.gateUserLine) {
    if (!user) {
      els.gateUserLine.textContent = "Not signed in";
    } else {
      els.gateUserLine.textContent = `${user.name} · ${admin ? "admin" : "support worker"}`;
    }
  }
  if (els.btnSignOut) els.btnSignOut.hidden = !user;
  if (els.btnOpenAuth) {
    els.btnOpenAuth.hidden = Boolean(user && approved);
    els.btnOpenAuth.textContent = user ? "Account" : "Sign in";
  }
  if (els.gateLockHint) {
    if (!approved) {
      els.gateLockHint.textContent =
        "Support workers must be approved by a manager, nurse, or supervisor before sign-in.";
    } else if (admin) {
      els.gateLockHint.textContent = "Admin — Talk to careTalk, Give careTalk more knowledge, and Reports are available.";
    } else {
      els.gateLockHint.textContent = "Support worker — Talk to careTalk only. Give careTalk more knowledge and Reports need admin.";
    }
  }
  if (els.btnLearnMode) {
    els.btnLearnMode.classList.toggle("locked", false);
    els.btnLearnMode.disabled = false;
  }
  if (els.btnTrainMode) {
    const allow = canAccessMode("train", user);
    els.btnTrainMode.classList.toggle("locked", approved && !allow);
    els.btnTrainMode.disabled = approved && !allow;
    const span = els.btnTrainMode.querySelector("span");
    if (span) {
      span.textContent = !approved
        ? "Head nurse — add knowledge (admin + PIN)"
        : allow
          ? "Head nurse — add knowledge (admin + PIN)"
          : "Admin only — managers / nurses / supervisors";
    }
  }
  if (els.btnReports) {
    const allow = canAccessMode("reports", user);
    els.btnReports.classList.toggle("locked", approved && !allow);
    els.btnReports.disabled = approved && !allow;
    const span = els.btnReports.querySelector("span");
    if (span) {
      span.textContent = !approved
        ? "Reports, training gaps & registrations"
        : allow
          ? "Reports, training gaps & registrations"
          : "Admin only — managers / nurses / supervisors";
    }
  }
}

function requireModeAccess(mode) {
  const user = getCurrentUser();
  if (!canAccessModes(user)) {
    enterUserAuth({ mode, tab: loadUsers().length ? "signin" : "register" });
    toast("Sign in with an approved account");
    return false;
  }
  if (!canAccessMode(mode, user)) {
    toast(
      mode === "learn"
        ? "Talk to careTalk is not available for this account"
        : "Give careTalk more knowledge and Reports are for admins only (manager / nurse / supervisor)",
    );
    return false;
  }
  return true;
}

function enterUserAuth({ mode = null, tab = "signin" } = {}) {
  pendingMode = mode;
  void stopMicQuiet();
  showOnly("user");
  const showReg = tab === "register";
  els.signInForm?.classList.toggle("hidden", showReg);
  els.registerForm?.classList.toggle("hidden", !showReg);
  els.verifyEmailForm?.classList.add("hidden");
  els.userAuth?.querySelectorAll("[data-user-auth-tab]").forEach((b) => {
    const on = b.getAttribute("data-user-auth-tab") === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (els.userAuthPending) {
    els.userAuthPending.hidden = true;
    els.userAuthPending.textContent = "";
  }
  if (loadUsers().length === 0 && els.registerForm) {
    els.signInForm?.classList.add("hidden");
    els.registerForm.classList.remove("hidden");
    els.userAuth?.querySelectorAll("[data-user-auth-tab]").forEach((b) => {
      const on = b.getAttribute("data-user-auth-tab") === "register";
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (els.userAuthPending) {
      els.userAuthPending.hidden = false;
      els.userAuthPending.textContent =
        "No accounts yet — register the first manager / nurse / supervisor (admin) for this device.";
    }
  }
}

function showEmailVerify(email) {
  els.signInForm?.classList.add("hidden");
  els.registerForm?.classList.add("hidden");
  els.verifyEmailForm?.classList.remove("hidden");
  els.userAuth?.querySelectorAll("[data-user-auth-tab]").forEach((b) => {
    b.classList.toggle("active", false);
    b.setAttribute("aria-selected", "false");
  });
  if (els.verifyEmail) els.verifyEmail.value = email;
  if (els.verifyCode) els.verifyCode.value = "";
  if (els.userAuthPending) {
    els.userAuthPending.hidden = false;
    els.userAuthPending.textContent = `Verification email sent to ${email}. Enter the 6-digit code below.`;
  }
}

function requireApprovedUser(mode) {
  return requireModeAccess(mode);
}

function continuePendingMode() {
  const mode = pendingMode;
  pendingMode = null;
  if (mode === "learn") void enterLearn();
  else if (mode === "train") {
    if (!canAccessMode("train")) {
      toast("Give careTalk more knowledge is for admins only");
      enterGate({ force: true });
      return;
    }
    if (isTrainAuthed()) enterTrain();
    else enterTrainAuth();
  } else if (mode === "reports") {
    if (!canAccessMode("reports")) {
      toast("Reports are for admins only");
      enterGate({ force: true });
      return;
    }
    enterReports();
  } else enterGate({ force: true });
}

function collectReportItems() {
  return collectUnifiedReportItems();
}

function formatReportWhen(at) {
  if (!at) return "";
  return new Date(at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderReportListItem(item) {
  const when = formatReportWhen(item.at);
  const active = reportsSelectedId === item.id ? " active" : "";
  const open = item.status === "unresolved" || item.status === "live" ? " open" : "";
  const cat = item.categoryLabel && item.kind === "report" ? escapeHtml(item.categoryLabel) : "";
  return `<li class="reports-item${active}${open}" data-id="${escapeHtml(item.id)}">
    <div class="reports-row">
      <span class="reports-kind kind-${item.kind}">${escapeHtml(item.kindLabel)}</span>
      <span class="reports-when">${when}</span>
    </div>
    <strong class="reports-title">${escapeHtml(item.title)}</strong>
    <span class="reports-meta">${escapeHtml(item.meta || item.status)}${cat ? ` · ${cat}` : ""}</span>
  </li>`;
}

function renderGroupedReportsList(reportItems) {
  const groups = groupItemsByCategory(reportItems);
  if (!groups.length) {
    return `<li class="reports-empty">No support-worker reports yet — from carers or admins on this device.</li>`;
  }
  return groups
    .map((g) => {
      const rows = g.items.map((item) => renderReportListItem(item)).join("");
      return `<li class="reports-category">
        <h3 class="reports-category-title">${escapeHtml(g.categoryLabel)} <span class="reports-category-count">${g.items.length}</span></h3>
        <ul class="reports-category-list">${rows}</ul>
      </li>`;
    })
    .join("");
}

function renderRegistrations() {
  if (!els.reportsList) return;
  const admin = isAdminUser();
  const users = listUsersForAdmin();
  const pendingAdmin = users.filter(
    (u) => u.status === "pending" && u.requestedRole === "admin" && u.emailVerified,
  ).length;
  els.reportsCount.textContent = admin
    ? `${users.length} accounts${pendingAdmin ? ` · ${pendingAdmin} admin pending` : ""}`
    : "Admin only — manager / nurse / supervisor";

  if (!admin) {
    els.reportsList.innerHTML = `<li class="reports-empty">Only admins can approve admin registrations.</li>`;
    els.reportsDetail.classList.add("hidden");
    return;
  }

  const actionable = users.filter(
    (u) =>
      u.status === "pending" ||
      u.status === "approved" ||
      u.status === "rejected",
  );

  els.reportsList.innerHTML = actionable.length
    ? actionable
        .map((u) => {
          const when = u.createdAt
            ? new Date(u.createdAt).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "";
          const emailTag = u.emailVerified ? " · email verified" : " · awaiting email";
          let actions = "";
          if (u.status === "pending" && u.requestedRole === "admin" && u.emailVerified) {
            actions = `<div class="reg-actions">
                   <button type="button" class="primary-btn compact" data-approve="${escapeHtml(u.id)}" data-role="admin">Approve admin</button>
                   <button type="button" class="ghost-btn compact" data-reject="${escapeHtml(u.id)}">Decline</button>
                 </div>`;
          } else if (u.status === "pending") {
            actions = `<span class="reports-meta">${
              u.requestedRole === "admin"
                ? "Awaiting email verification, then admin approval"
                : "Awaiting email verification (auto-approves as carer)"
            }</span>`;
          } else if (u.status === "approved") {
            actions = `<div class="reg-actions">
                     <span class="reports-meta">${u.role === "admin" ? "Admin" : "Support worker"}</span>
                     ${
                       u.role !== "admin"
                         ? `<button type="button" class="ghost-btn compact" data-approve="${escapeHtml(u.id)}" data-role="admin">Make admin</button>`
                         : ""
                     }
                   </div>`;
          } else {
            actions = `<span class="reports-meta">Declined</span>`;
          }
          return `<li class="reports-item reg-item status-${escapeHtml(u.status)}" data-reg-id="${escapeHtml(u.id)}">
            <div class="reports-row">
              <span class="reports-kind kind-${u.status === "pending" ? "gap" : "report"}">${escapeHtml(u.status)}</span>
              <span class="reports-when">${when}</span>
            </div>
            <strong class="reports-title">${escapeHtml(u.name)}</strong>
            <span class="reports-meta">${escapeHtml(u.email)}${u.status === "pending" ? emailTag : ""}${
              u.requestedRole === "admin" ? " · admin request" : ""
            }</span>
            ${actions}
          </li>`;
        })
        .join("")
    : `<li class="reports-empty">No registrations yet.</li>`;
  els.reportsDetail.classList.add("hidden");
}

function renderUserStatistics() {
  if (!els.reportsList) return;
  const admin = isAdminUser();
  const s = getUserStatistics();
  const dash = getAdminUserDashboard();
  const carers = dash.carerAccounts;
  const loggedInCount = carers.filter((c) => c.loggedIn || c.activeNow).length;
  els.reportsCount.textContent = admin
    ? `${carers.length} carer account${carers.length === 1 ? "" : "s"} · ${loggedInCount} active now · ${dash.totalPinned} report${dash.totalPinned === 1 ? "" : "s"}`
    : "Admin only";

  if (!admin) {
    els.reportsList.innerHTML = `<li class="reports-empty">User statistics are for admins only.</li>`;
    els.reportsDetail.classList.add("hidden");
    return;
  }

  const usersHtml = carers.length
    ? carers
        .map((u) => {
          const expanded = usersSelectedId === u.userId;
          const when = u.lastSeenAt
            ? new Date(u.lastSeenAt).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—";
          const joined = u.createdAt
            ? new Date(u.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : "—";
          const approved = u.approvedAt
            ? new Date(u.approvedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : "—";
          const onlineLabel = u.loggedIn
            ? "Logged in now"
            : u.activeNow
              ? "Active on this device"
              : "Not on this device now";
          const docList = u.documents.length
            ? `<ul class="carer-doc-list user-reports-panel">${u.documents
                .map((d) => {
                  const docWhen = d.createdAt
                    ? new Date(d.createdAt).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "";
                  const title =
                    d.status === "draft"
                      ? `Live report${d.person ? ` · ${d.person}` : ""}`
                      : [d.person, d.noteType].filter(Boolean).join(" · ") || "Voice report";
                  const active = reportsSelectedId === d.id ? " active" : "";
                  const draftTag =
                    d.status === "draft"
                      ? `<span class="reports-kind kind-gap">live</span>`
                      : "";
                  return `<li class="carer-doc-item${active}${d.status === "draft" ? " draft" : ""}" data-pin-id="${escapeHtml(d.id)}">
                    <button type="button" class="carer-doc-btn" data-pin-id="${escapeHtml(d.id)}">
                      <span class="reports-row">${draftTag}<span class="reports-when">${docWhen}</span></span>
                      <span class="carer-doc-title">${escapeHtml(title)}</span>
                      <span class="reports-meta">${escapeHtml((d.utterance || "").slice(0, 72))}${(d.utterance || "").length > 72 ? "…" : ""}</span>
                    </button>
                  </li>`;
                })
                .join("")}</ul>`
            : `<p class="reports-meta user-reports-panel">No reports pinned for this carer yet.</p>`;
          const profilePanel = expanded
            ? `<div class="user-profile-panel">
            <h4 class="user-panel-heading">Profile</h4>
            <dl class="user-profile-dl">
              <div><dt>Name</dt><dd>${escapeHtml(u.userName)}</dd></div>
              <div><dt>Email</dt><dd>${escapeHtml(u.userEmail)}</dd></div>
              <div><dt>Role</dt><dd>Support worker</dd></div>
              <div><dt>Status</dt><dd>${escapeHtml(onlineLabel)}</dd></div>
              <div><dt>Last activity</dt><dd>${escapeHtml(when)}${u.lastMode ? ` · ${escapeHtml(u.lastMode)}` : ""}</dd></div>
              <div><dt>Registered</dt><dd>${escapeHtml(joined)}</dd></div>
              <div><dt>Approved</dt><dd>${escapeHtml(approved)}</dd></div>
            </dl>
            <h4 class="user-panel-heading">Reports <span class="user-menu-count">${u.documents.length}</span></h4>
            ${docList}
          </div>`
            : "";
          return `<li class="reports-item user-session carer-account${expanded ? " expanded" : ""}" data-user-id="${escapeHtml(u.userId)}">
            <button type="button" class="user-session-head" data-user-id="${escapeHtml(u.userId)}" aria-expanded="${expanded ? "true" : "false"}">
              <span class="presence-dot${u.loggedIn || u.activeNow ? "" : " off"}" aria-hidden="true"></span>
              <span class="user-session-text">
                <strong class="reports-title">${escapeHtml(u.userName)}</strong>
                <span class="reports-meta">${escapeHtml(u.userEmail)} · ${u.documents.length} report${u.documents.length === 1 ? "" : "s"} · ${escapeHtml(onlineLabel)}</span>
              </span>
            </button>
            ${profilePanel}
          </li>`;
        })
        .join("")
    : `<li class="reports-empty">No support worker accounts yet. Carers register and verify email to appear here.</li>`;

  const cards = [
    ["Total accounts", s.total],
    ["Approved", s.approved],
    ["Support workers", s.carers],
    ["Admins", s.admins],
    ["Pending", s.pending],
    ["Awaiting email", s.awaitingEmail],
    ["Admin pending approval", s.pendingAdmin],
    ["Declined", s.rejected],
  ];

  els.reportsList.innerHTML = `
    <li class="reports-empty" style="padding-top:0">Carer accounts — tap a name for <strong>profile</strong> and <strong>reports</strong></li>
    ${usersHtml}
    <li class="reports-empty" style="padding-top:0.75rem">Account summary</li>
    <li class="reports-item stats-grid">
      ${cards
        .map(
          ([label, val]) => `<div class="stat-card">
            <span class="stat-val">${escapeHtml(String(val))}</span>
            <span class="stat-label">${escapeHtml(label)}</span>
          </div>`,
        )
        .join("")}
    </li>
    <li class="reports-empty" style="padding-top:0.5rem">Recent registrations</li>
    ${
      s.recent.length
        ? s.recent
            .map((u) => {
              const when = u.createdAt
                ? new Date(u.createdAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "";
              return `<li class="reports-item">
                <div class="reports-row">
                  <span class="reports-kind kind-${u.role === "admin" ? "report" : "gap"}">${escapeHtml(u.status)}</span>
                  <span class="reports-when">${when}</span>
                </div>
                <strong class="reports-title">${escapeHtml(u.name)}</strong>
                <span class="reports-meta">${escapeHtml(u.email)} · ${escapeHtml(u.role)}${
                  u.emailVerified ? "" : " · email not verified"
                }</span>
              </li>`;
            })
            .join("")
        : `<li class="reports-empty">No registrations yet.</li>`
    }
    <li class="reports-item" style="cursor:default">
      <p class="hint">Default admin after reset: <strong>${escapeHtml(DEFAULT_ADMIN.email)}</strong> / password <strong>${escapeHtml(DEFAULT_ADMIN.password)}</strong></p>
      <button type="button" class="ghost-btn compact" id="btnResetDevice">Reset all device data (test)</button>
      <button type="button" class="ghost-btn compact" id="btnResetUsers">Reset all users to default admin</button>
    </li>`;
  const selectedPin = reportsSelectedId ? getPinnedReportById(reportsSelectedId) : null;
  if (selectedPin?.reportBody && els.reportsDetail) {
    els.reportsDetail.classList.remove("hidden");
    els.reportsDetail.textContent = selectedPin.reportBody;
  } else {
    els.reportsDetail.classList.add("hidden");
    els.reportsDetail.textContent = "";
  }
}

function renderReports() {
  if (!els.reportsList) return;
  if (reportsTab === "regs") {
    renderRegistrations();
    return;
  }
  if (reportsTab === "users") {
    renderUserStatistics();
    return;
  }

  const all = collectReportItems();
  const items =
    reportsTab === "reports"
      ? all.filter((i) => i.kind === "report")
      : reportsTab === "gaps"
        ? all.filter((i) => i.kind === "gap")
        : all;

  const reportRows = all.filter((i) => i.kind === "report");
  const gapRows = all.filter((i) => i.kind === "gap");
  const openGaps = gapRows.filter((i) => i.status === "unresolved").length;
  const categoryCount = groupItemsByCategory(reportRows).length;

  if (items.length) {
    els.reportsCount.textContent =
      reportsTab === "reports"
        ? `${reportRows.length} report${reportRows.length === 1 ? "" : "s"} in ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"} · carers & admins (this device)`
        : reportsTab === "gaps"
          ? `${gapRows.length} gap${gapRows.length === 1 ? "" : "s"}${openGaps ? ` · ${openGaps} open` : ""}`
          : `${reportRows.length} report${reportRows.length === 1 ? "" : "s"} · ${gapRows.length} gap${gapRows.length === 1 ? "" : "s"}${openGaps ? ` · ${openGaps} open` : ""} · ${categoryCount} categories`;
  } else {
    els.reportsCount.textContent = "Nothing logged yet";
  }

  if (reportsTab === "reports") {
    els.reportsList.innerHTML = renderGroupedReportsList(items);
  } else if (reportsTab === "all") {
    const gapHtml = gapRows.length
      ? `<li class="reports-category">
          <h3 class="reports-category-title">Training gaps <span class="reports-category-count">${gapRows.length}</span></h3>
          <ul class="reports-category-list">${gapRows.map((item) => renderReportListItem(item)).join("")}</ul>
        </li>`
      : "";
    const reportHtml = reportRows.length ? renderGroupedReportsList(reportRows) : "";
    els.reportsList.innerHTML =
      gapHtml || reportHtml
        ? `${gapHtml}${reportHtml}`
        : `<li class="reports-empty">No reports or incidents yet.</li>`;
  } else {
    els.reportsList.innerHTML = items.length
      ? items.map((item) => renderReportListItem(item)).join("")
      : `<li class="reports-empty">No training gaps yet.</li>`;
  }

  const selected = items.find((i) => i.id === reportsSelectedId) || all.find((i) => i.id === reportsSelectedId);
  if (selected?.body) {
    els.reportsDetail.classList.remove("hidden");
    els.reportsDetail.textContent = selected.body;
  } else {
    els.reportsDetail.classList.add("hidden");
    els.reportsDetail.textContent = "";
    if (!selected) reportsSelectedId = null;
  }
}

function enterReports() {
  if (!requireModeAccess("reports")) return;
  appMode = "reports";
  void stopMicQuiet();
  reportsSelectedId = null;
  const user = getCurrentUser();
  if (user) touchUserPresence({ user, mode: "reports" });
  showOnly("reports");
  renderReports();
}

async function stopMicQuiet() {
  wantListenAfterSpeak = false;
  window.speechSynthesis?.cancel();
  donSpeaking = false;
  try {
    await speech?.stop();
  } catch {
    /* ignore */
  }
}

async function pauseMicForReply() {
  if (!speech?.listening && !listening) return;
  wantListenAfterSpeak = true;
  try {
    await speech?.pause?.();
  } catch {
    try {
      await speech?.stop();
    } catch {
      /* ignore */
    }
  }
}

async function resumeMicAfterReply() {
  if (!wantListenAfterSpeak || !speech || appMode !== "learn") return;
  wantListenAfterSpeak = false;
  try {
    if (speech.resume) await speech.resume();
    else await speech.start();
  } catch {
    /* ignore */
  }
}

function userStillSpeaking() {
  // Only treat as “still speaking” for a brief window after the latest partial (not the whole pause).
  return Date.now() - lastUserAudioAt < 350;
}

function setMicInputBlocked(block) {
  try {
    speech?.setInputBlocked?.(block);
  } catch {
    /* ignore */
  }
}

function speak(text, { onDone } = {}) {
  if (!voiceOn || !window.speechSynthesis || appMode !== "learn") {
    onDone?.();
    return;
  }
  const clean = String(text)
    .replace(/\*\*/g, "")
    .replace(/[•\-]\s/g, "")
    .replace(/\n+/g, ". ")
    .slice(0, 500);
  if (!clean.trim()) {
    onDone?.();
    return;
  }

  speakChain = speakChain.then(
    () =>
      new Promise((resolve) => {
        void pauseMicForReply().then(() => {
          donSpeaking = true;
          setMicInputBlocked(true);
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(clean);
          u.lang = "en-GB";
          u.rate = 0.93;
          u.pitch = 0.98;
          const voice = pickDonVoice();
          if (voice) u.voice = voice;
          const finish = () => {
            donSpeaking = false;
            setTimeout(() => {
              setMicInputBlocked(false);
              onDone?.();
              void resumeMicAfterReply();
              resolve();
            }, POST_SPEECH_MIC_DELAY_MS);
          };
          // Safari / muted: if speech never starts, still unblock
          const safety = setTimeout(() => {
            if (donSpeaking) finish();
          }, Math.max(12000, clean.length * 80));
          u.onstart = () => clearTimeout(safety);
          u.onend = () => {
            clearTimeout(safety);
            finish();
          };
          u.onerror = () => {
            clearTimeout(safety);
            finish();
          };
          window.speechSynthesis.speak(u);
        });
      }),
  );
}

function addBubble(role, html, { speakText } = {}) {
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = role === "don" ? "careTalk" : "You";
  div.appendChild(who);
  const body = document.createElement("div");
  body.innerHTML = html;
  div.appendChild(body);
  els.chat.appendChild(div);
  els.chat.scrollTop = els.chat.scrollHeight;
  if (role === "don" && speakText !== false) {
    speak(body.innerText);
  }
  return div;
}

function adviceHtml(sess) {
  const trained =
    sess.advice.trainedText?.length > 0
      ? `<p><strong>From your home’s trained knowledge</strong></p><ul>${sess.advice.trainedText
          .map((x) => `<li>${escapeHtml(x)}</li>`)
          .join("")}</ul>`
      : "";
  const doItems = sess.advice.do.map((x) => `<li>${escapeHtml(x)}</li>`).join("");
  const dontItems = sess.advice.dont.map((x) => `<li>${escapeHtml(x)}</li>`).join("");
  const visuals = visualsHtml(sess.advice.images || [], escapeHtml);
  return `
    <p>${escapeHtml(openingLine(sess))}</p>
    <p><strong>Do next</strong></p>
    <ul>${doItems}</ul>
    <p><strong>Don’t</strong></p>
    <ul>${dontItems}</ul>
    ${visuals}
    ${trained}
    <p class="muted-line">${escapeHtml(DON_META.disclaimer)}</p>
    <div class="actions">
      <button type="button" class="primary" data-act="start-qs">Okay — ask me the record questions</button>
      <button type="button" data-act="skip-advice">I’ve got this — questions only</button>
    </div>
  `;
}

function openingLine(sess) {
  const who = sess.person || "them";
  if (sess.scenarioId === "fall") {
    return `I’m with you. We’ll look after ${who} and get a proper support-worker report. First, safe-practice reminders — then voice notes and documentation questions.`;
  }
  if (sess.scenarioId === "distress") {
    return `Okay. Safety first for ${who} and the team. Here’s what training points us to — then we’ll document for the agency.`;
  }
  if (sess.scenarioId === "dysphagia") {
    return `Got it — swallow/choking risk. Dysphagia awareness comes first. Then we’ll capture the report.`;
  }
  if (sess.scenarioId === "medication") {
    return `Medication${sess.person ? ` for ${sess.person}` : ""} — I’ll use your home’s trained guidance. Then we’ll document for the agency.`;
  }
  return `Okay${sess.person ? ` — about ${sess.person}` : ""}. I’ll take voice notes, guide the record, and forward a support-worker report to the care agency.`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function askNextQuestion() {
  const q = currentQuestion(session);
  if (!q) {
    beginReportReview();
    return;
  }
  session.docTurn = "waiting_answer";
  session.pendingAnswer = "";
  session.pendingDocumented = "";
  session.questionAskedAt = Date.now();
  setDocAcceptingAnswer(false);
  const n = session.step + 1;
  const total = session.questions.length;
  const carer = carerFirstName(getLoggedInCarerName()) || "there";
  addBubble(
    "don",
    `<p><strong>Question ${n} of ${total}</strong></p><p>${escapeHtml(q.ask)}</p><p class="muted-line">I’ll wait for your answer, write it in the report, and check it’s correct before the next question.</p>`,
    { speakText: false },
  );
  speak(`${carer}, question ${n} of ${total}. ${q.ask}`, { onDone: () => setDocAcceptingAnswer(true) });
}

function offerAnswerConfirm(rawAnswer) {
  const q = currentQuestion(session);
  if (!q) return;
  const documented = formatAnswerForRecord(q, rawAnswer, { person: session.person });
  session.pendingAnswer = rawAnswer;
  session.pendingDocumented = documented;
  session.docTurn = "confirming";
  setDocAcceptingAnswer(false);
  const carer = carerFirstName(getLoggedInCarerName());
  const residentBit = session.person ? ` about ${session.person}` : " for the resident";
  addBubble(
    "don",
    `<p><strong>I’ve written this in the report</strong>${session.person ? ` (service user <strong>${escapeHtml(session.person)}</strong>)` : ""}:</p>
     <p class="record-line">${escapeHtml(documented)}</p>
     <p>Is that correct? Say <strong>yes</strong>, or <strong>no</strong> and what to change.</p>`,
    { speakText: false },
  );
  const spokenCarer = carer ? `${carer}, ` : "";
  speak(
    `${spokenCarer}I've written for the report${residentBit}: ${documented}. Is that correct? Say yes, or no and tell me what to change.`,
    {
      onDone: () => setDocAcceptingAnswer(true),
    },
  );
}

function beginReportReview() {
  session.phase = "report_review";
  session.docTurn = "final_confirm";
  setDocAcceptingAnswer(false);
  const html = buildReportReviewHtml(session, escapeHtml);
  addBubble(
    "don",
    `<p><strong>Before I file this — please check the report</strong></p>
     ${html}
     <p>Is everything correct? Say <strong>yes</strong> to send it, or <strong>no</strong> and what to change.</p>`,
    { speakText: false },
  );
  speak(
    "I've documented everything above. Please check it's correct. Say yes to file the report, or no and tell me what to change.",
    { onDone: () => setDocAcceptingAnswer(true) },
  );
}

function handleDocumentationInput(raw) {
  if (!session) return;

  if (session.phase === "report_review") {
    if (session.docTurn === "fix_listen") {
      const note = correctionFromUtterance(raw);
      session.correctionNote = note;
      session.docTurn = "final_confirm";
      const html = buildReportReviewHtml(session, escapeHtml);
      addBubble(
        "don",
        `<p>Updated — I’ve added your correction:</p>${html}<p>Is it correct now? Say <strong>yes</strong> or <strong>no</strong>.</p>`,
        { speakText: false },
      );
      setDocAcceptingAnswer(false);
      speak("I've added your correction. Is the report correct now?", { onDone: () => setDocAcceptingAnswer(true) });
      return;
    }
    if (isConfirmYes(raw)) {
      setDocAcceptingAnswer(false);
      void finishRecord();
      return;
    }
    if (isConfirmNo(raw)) {
      session.docTurn = "fix_listen";
      setDocAcceptingAnswer(false);
      addBubble(
        "don",
        `<p>No problem — tell me what needs changing for the record.</p>`,
        { speakText: false },
      );
      speak("Tell me what needs changing.", { onDone: () => setDocAcceptingAnswer(true) });
      return;
    }
    addBubble("don", `<p>Say <strong>yes</strong> if the report is correct, or <strong>no</strong> and what to change.</p>`, {
      speakText: true,
    });
    return;
  }

  if (session.phase !== "questions") return;

  const q = currentQuestion(session);
  if (!q) {
    beginReportReview();
    return;
  }

  if (session.docTurn === "confirming") {
    if (!session.pendingAnswer || !session.pendingDocumented) {
      session.docTurn = "waiting_answer";
      setDocAcceptingAnswer(true);
      addBubble("don", `<p>Tell me your answer first — then I’ll read it back to check.</p>`, { speakText: true });
      return;
    }
    if (isConfirmYes(raw)) {
      const { done } = commitDocumentedAnswer(session, {
        raw: session.pendingAnswer,
        documented: session.pendingDocumented,
      });
      syncLiveReportFromSession(session);
      setDocAcceptingAnswer(false);
      if (done) beginReportReview();
      else askNextQuestion();
      return;
    }
    if (isConfirmNo(raw)) {
      const corrected = correctionFromUtterance(raw);
      if (corrected.length > 3 && corrected.toLowerCase() !== raw.trim().toLowerCase()) {
        offerAnswerConfirm(corrected);
        return;
      }
      session.docTurn = "waiting_answer";
      setDocAcceptingAnswer(false);
      addBubble("don", `<p>Okay — let’s try again. ${escapeHtml(q.ask)}</p>`, { speakText: false });
      speak(`Let's try again. ${q.ask}`, { onDone: () => setDocAcceptingAnswer(true) });
      return;
    }
    addBubble(
      "don",
      `<p>Please say <strong>yes</strong> if I’ve got it right, or <strong>no</strong> and the correction.</p>`,
      { speakText: true },
    );
    return;
  }

  if (session.docTurn === "waiting_answer") {
    if (isWakeOnly(raw) || isAmbiguousDonCall(raw)) {
      addBubble("don", `<p>Still here — ${escapeHtml(q.ask)}</p>`, { speakText: true });
      return;
    }
    if (isPrematureConfirmToken(raw, session.docTurn)) {
      addBubble(
        "don",
        `<p>I’m waiting for your answer to put in the report — not yes or no yet. ${escapeHtml(q.ask)}</p>`,
        { speakText: true },
      );
      return;
    }
    if (answerEchoesQuestion(raw, q.ask)) {
      addBubble(
        "don",
        `<p>I’m listening for your answer — what would you put in the report?</p>`,
        { speakText: true },
      );
      return;
    }
    const trimmed = raw.trim();
    if (trimmed.split(/\s+/).length <= 2 && isCarerName(trimmed, getLoggedInCarerName())) {
      addBubble(
        "don",
        `<p>That’s your name on the profile — I need details about the <strong>resident</strong>. ${escapeHtml(q.ask)}</p>`,
        { speakText: true },
      );
      return;
    }
    if (session.questionAskedAt && Date.now() - session.questionAskedAt < 500) {
      return;
    }
    if (answerLooksTooShort(raw)) {
      addBubble("don", `<p>I need a bit more for the record. ${escapeHtml(q.ask)}</p>`, { speakText: true });
      return;
    }
    offerAnswerConfirm(raw);
  }
}

async function finishRecord() {
  const snap = session;
  if (!snap) return;
  const record = buildRecord(snap);
  const agency = loadAgencySettings();

  addBubble(
    "don",
    `<p>That’s everything. Here’s the <strong>support worker report</strong> — voice notes included.</p>
     <pre class="record">${escapeHtml(record)}</pre>
     <div class="actions">
       <button type="button" class="primary" data-act="copy">Copy report</button>
       <button type="button" data-act="forward">Forward to agency again</button>
       <button type="button" data-act="new">Something else?</button>
     </div>`,
    { speakText: false },
  );

  session = null;
  docAcceptingAnswer = false;
  els.statusLine.innerHTML = `Say <strong>careTalk</strong> anytime. I’ll ask if you need help.`;
  brain.reset();

  const pinned = snap.liveReportId
    ? finalizeLiveReport(snap.liveReportId, record)
    : pinUserReportFromSession(snap, record);
  if (pinned) {
    toast("Report saved to your profile");
  }

  if (agency.autoForward !== false) {
    speak("Report ready. I’m forwarding it to the care agency now.");
    await doForward(record, snap);
  } else {
    speak("Report ready. You can copy it or forward it to the care agency.");
  }
}

async function doForward(record, snap) {
  try {
    const { packet, agency } = await forwardReportToAgency(record, {
      carer: snap?.carer || getLoggedInCarerName(),
      person: snap?.person || "",
      scenario: snap?.scenarioLabel || "",
    });
    const via = packet.channels.filter((c) => c !== "outbox").join(" + ") || "saved on this device";
    toast(`Forwarded to ${agency.name} (${via})`);
    addBubble(
      "don",
      `<p>Support worker report forwarded to <strong>${escapeHtml(agency.name)}</strong>${
        agency.email ? ` (${escapeHtml(agency.email)})` : ""
      }. Channel: ${escapeHtml(via)}.</p>`,
      { speakText: false },
    );
  } catch (err) {
    toast(err?.message || "Forward failed — report saved locally");
  }
}

function startCareFlow(openingText, { reportOnly = false } = {}) {
  const payload = stripWake(openingText) || openingText;
  syncCarerFromProfile();
  const carer = getLoggedInCarerName();
  session = startSession({
    opening: payload,
    carer,
    carerProfileName: carer,
  });
  docAcceptingAnswer = false;
  els.statusLine.textContent = `${session.scenarioLabel}${session.person ? ` · ${session.person}` : ""} · voice notes on`;

  if (reportOnly) {
    session.phase = "questions";
    session.reportOnly = true;
    const live = startLiveReport({ opening: payload, session });
    if (live) {
      session.liveReportId = live.id;
      toast("Report started — updating on your profile as you speak");
    }
    addBubble(
      "don",
      `<p>I've opened a <strong>live report</strong> on your profile — admins can see it updating as you speak.</p>
       <p class="muted-line">One question at a time; I'll write each answer in the report and check it's correct with you.</p>`,
      { speakText: false },
    );
    speak(
      "I'll take this as a report and document what you tell me. One question at a time — I'll check each answer with you.",
      { onDone: () => askNextQuestion() },
    );
    return;
  }

  session.phase = "advice";
  session.adviceAwaitingOk = false;
  const bubble = addBubble("don", adviceHtml(session), { speakText: false });
  speak(
    openingLine(session) +
      (session.advice.images?.length
        ? " I’ve included pictures to show you the actions. "
        : " ") +
      "I’ve listed what to do and what not to do. Say okay when you want the record questions.",
    { onDone: () => setAdviceAwaitingOk(true) },
  );
  bubble.querySelector('[data-act="start-qs"]')?.addEventListener("click", () => beginQuestionsFromAdvice());
  bubble.querySelector('[data-act="skip-advice"]')?.addEventListener("click", () =>
    beginQuestionsFromAdvice({ skipIntro: true }),
  );
}

function isJunkUserText(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  try {
    if (t === window.location.href || t === window.location.origin || t === window.location.host) return true;
  } catch {
    /* ignore */
  }
  if (/^https?:\/\//i.test(t)) return true;
  if (/\blocalhost(:\d+)?\b/i.test(t) || /\b127\.0\.0\.1\b/.test(t)) return true;
  if (!/[a-zA-Z]{2,}/.test(t)) return true;
  return false;
}

function handleUserText(text) {
  void handleUserTextAsync(text);
}

async function handleUserTextAsync(text) {
  if (appMode !== "learn") return;
  const raw = String(text || "").trim();
  if (!raw) return;
  if (isJunkUserText(raw)) {
    els.statusLine.textContent = "Listening… say “Hi careTalk”";
    return;
  }

  const typedValue = els.input.value.trim();
  const fromType = Boolean(typedValue) && typedValue === raw;

  if (!fromType && donSpeaking) {
    return;
  }
  if (!fromType && donProcessing) {
    return;
  }
  if (session?.phase === "advice" && !session.adviceAwaitingOk && !fromType) {
    els.statusLine.innerHTML = `careTalk is speaking — <strong>wait</strong> until I ask for okay`;
    return;
  }

  const now = Date.now();
  if (raw.toLowerCase() === lastHandled.toLowerCase() && now - lastHandledAt < 1800) return;

  const mentionsDonNow = /\b(care\s*talk|caretalk|don)\b/i.test(raw) || isWakeOnly(raw);
  if (!fromType) {
    const thinkMs = mentionsDonNow ? 280 : Math.min(1200, computeThinkDelayMs(raw));
    els.statusLine.textContent = "…";
    await sleep(thinkMs);
    if (donSpeaking) return;
  }

  lastHandled = raw;
  lastHandledAt = Date.now();
  donProcessing = true;
  try {
    await handleUserTextCore(raw, { fromType });
  } finally {
    donProcessing = false;
  }
}

async function handleUserTextCore(raw, { fromType = false } = {}) {
  const user = getCurrentUser();
  if (user) touchUserPresence({ user, mode: "learn" });

  const liveDoc = ingestLiveReportSpeech(raw, { session, startIfReportAsk: true });
  if (liveDoc && matchesFullReportRequest(raw)) {
    toast("Live report — saving to your profile");
  }

  let pinnedThisTurn = null;
  if (matchesPinDocumentIntent(raw)) {
    const pr = pinUserReportFromUtterance(raw, {
      slots: brain.getSlots(),
      session,
      mode: "learn",
    });
    if (pr.pinned) pinnedThisTurn = pr.doc;
  }

  // Mid structured documentation — one question at a time; careTalk documents & confirms
  if (session?.phase === "questions" || session?.phase === "report_review") {
    const typedValue = els.input.value.trim();
    const fromType = Boolean(typedValue) && typedValue === raw;
    if (donSpeaking && !fromType) {
      return;
    }
    if (!docAcceptingAnswer && !fromType) {
      els.statusLine.innerHTML = `careTalk is speaking — <strong>wait</strong> for your turn to answer`;
      return;
    }

    addBubble("user", `<p>${escapeHtml(raw)}</p>`, { speakText: false });
    els.input.value = "";
    if (pinnedThisTurn) {
      addVoiceNote(session, raw);
      addBubble(
        "don",
        `<p>Noted — pinned under <strong>${escapeHtml(user?.name || "your profile")}</strong> for managers.</p>`,
        { speakText: false },
      );
      toast("Pinned to your profile");
    }
    handleDocumentationInput(raw);
    if (session?.liveReportId) syncLiveReportFromSession(session);
    return;
  }

  if (session?.phase === "advice") {
    if (donSpeaking && !fromType) {
      return;
    }
    if (!session.adviceAwaitingOk && !fromType) {
      els.statusLine.innerHTML = `careTalk is speaking — <strong>wait</strong> until I ask for okay`;
      return;
    }

    addBubble("user", `<p>${escapeHtml(raw)}</p>`, { speakText: false });
    els.input.value = "";
    if (isAdviceContinuePhrase(raw)) {
      beginQuestionsFromAdvice();
      return;
    }
    setAdviceAwaitingOk(false);
    addBubble(
      "don",
      `<p>Take your time with the do’s and don’ts. Say <strong>okay</strong> when you want the record questions.</p>`,
      { speakText: false },
    );
    speak("When you're ready, say okay and I'll start the record questions.", {
      onDone: () => setAdviceAwaitingOk(true),
    });
    return;
  }

  // Conversational path — local OSS LLM when available, else rule brain
  const out = await respondWithLlmOrRules(raw, { fromType });
  if (out.ignore) {
    if (pinnedThisTurn) {
      addBubble("user", `<p>${escapeHtml(raw)}</p>`, { speakText: false });
      addBubble(
        "don",
        `<p>Pinned that to <strong>${escapeHtml(user?.name || "your profile")}</strong>. Admins can read it under Reports → Users.</p>`,
        { speakText: true },
      );
      toast("Pinned to your profile");
      els.input.value = "";
    } else if (mentionsDon(raw) || isWakeOnly(raw)) {
      addBubble("user", `<p>${escapeHtml(raw)}</p>`, { speakText: false });
      els.input.value = "";
      const wake = brain.respond(raw);
      if (wake.say) {
        addBubble("don", `<p>${escapeHtml(wake.say)}</p>`, { speakText: true });
      }
      els.statusLine.textContent = wake.status || "Engaged";
    } else {
      els.statusLine.textContent = `Heard “${raw.slice(0, 60)}” — say careTalk if you need me`;
    }
    return;
  }

  addBubble("user", `<p>${escapeHtml(raw)}</p>`, { speakText: false });
  els.input.value = "";

  if (out.say) {
    addBubble("don", `<p>${escapeHtml(out.say)}</p>`, { speakText: true });
  }
  if (out.status) els.statusLine.textContent = out.status;

  if (out.action === "pin_user_report" && !pinnedThisTurn) {
    const pr = pinUserReportFromUtterance(out.opening || raw, {
      slots: brain.getSlots(),
      session,
      mode: "learn",
    });
    if (pr.pinned) {
      pinnedThisTurn = pr.doc;
      toast("Pinned to your profile");
    }
  } else if (pinnedThisTurn) {
    toast("Pinned to your profile");
  }

  if (out.action === "start_care_flow") {
    startCareFlow(out.opening || raw, { reportOnly: Boolean(out.reportOnly) });
  }
  if (out.action === "request_training" && !matchesReportIntent(raw)) {
    void handleTrainingGap(out, raw);
  }
  if (out.action === "unsure_subject" && !matchesReportIntent(raw)) {
    void handleUnsureSubject(out, raw);
  }
  if (out.action === "stay_quiet" || out.action === "close") {
    els.statusLine.innerHTML = `Say <strong>careTalk</strong> anytime.`;
    llmHistory.length = 0;
  }
}

async function handleUnsureSubject(out, raw) {
  const slots = brain.getSlots();
  const label = out.opening || slots.summary || raw;
  const topic = out.trainingTopic || slots.trainingTopic || topicFromUnsureSubject(label, raw);
  const { incident, created } = createTrainingIncident({
    topic,
    utterance: label,
    person: slots.person || "",
    carer: getLoggedInCarerName(),
  });
  try {
    const { agency } = await reportTrainingGapToAgency(incident);
    const emailNote = agency.email
      ? ` I’ve flagged this to <strong>${escapeHtml(agency.name)}</strong> so a head nurse can train me.`
      : ` I’ve logged it under Reports → Gaps — set an agency email in Give careTalk more knowledge to auto-notify.`;
    addBubble(
      "don",
      `<p>I’m <strong>not sure about this subject</strong>, so I won’t invent guidance.</p>
       <p>Logged as training gap <strong>${escapeHtml(incident.id)}</strong>${
         created ? "" : " (already open)"
       }.${emailNote}</p>
       <p class="muted-line">Please check with the nurse in charge now. Say if you want me to help document what happened anyway.</p>`,
      { speakText: true },
    );
    toast(created ? "Subject gap logged" : "Open subject gap already logged");
  } catch (err) {
    toast(err?.message || "Could not notify agency — gap still logged");
  }
}

async function handleTrainingGap(out, raw) {
  const slots = brain.getSlots();
  const topic = out.trainingTopic || slots.trainingTopic;
  if (!topic) return;
  const { incident, created } = createTrainingIncident({
    topic,
    utterance: out.opening || raw,
    person: slots.person || "",
    carer: getLoggedInCarerName(),
  });
  try {
    const { agency } = await reportTrainingGapToAgency(incident);
    const emailNote = agency.email
      ? ` I’ve emailed <strong>${escapeHtml(agency.name)}</strong> (${escapeHtml(agency.email)}) that I need training on this.`
      : ` I’ve logged this for the agency — set an agency email in Give careTalk more knowledge so future gaps email automatically.`;
    addBubble(
      "don",
      `<p>Training incident <strong>${escapeHtml(incident.id)}</strong> is <strong>unresolved</strong> until a head nurse adds knowledge in Give careTalk more knowledge.${emailNote}</p>
       <p class="muted-line">Meanwhile: do not force medicine — inform the nurse in charge now and document the refusal.</p>`,
      { speakText: true },
    );
    toast(created ? "Training gap reported to agency" : "Open training incident already logged");
  } catch (err) {
    toast(err?.message || "Could not notify agency — incident still logged in Give careTalk more knowledge");
  }
}

function setListening(on) {
  listening = on;
  els.micBtn.setAttribute("aria-pressed", String(on));
  if (on) {
    const cur = els.statusLine.textContent || "";
    if (!donSpeaking && !/^(Hearing:|Heard:)/i.test(cur)) {
      els.statusLine.textContent = "Listening… say “Hi careTalk”";
    }
  } else if (!donSpeaking) {
    const cur = els.statusLine.textContent || "";
    if (!/^(Hearing:|Heard:)/i.test(cur)) {
      els.statusLine.innerHTML = `Say <strong>careTalk</strong> anytime. I’ll ask if you need help.`;
    }
  }
}

function initSpeech() {
  if (speech) return;
  speech = createSpeechController({
    lang: "en-GB",
    onStart: () => setListening(true),
    onEnd: () => setListening(false),
    onError: (err) => {
      els.statusLine.textContent = `Mic issue: ${err}`;
      toast(`Mic: ${err}`);
    },
    onFinal: (text) => {
      if (donSpeaking) return;
      els.statusLine.textContent = `Heard: ${text}`;
      if (text) handleUserText(text);
    },
    onPartial: (p) => {
      if (!donSpeaking) lastUserAudioAt = Date.now();
      if (donSpeaking) return;
      els.statusLine.textContent = `Hearing: ${p.slice(0, 80)}`;
    },
  });
}

function enterGate({ force = false } = {}) {
  appMode = null;
  learnReady = false;
  session = null;
  brain.reset();
  markTrainAuthed(false);
  pendingMode = null;
  void stopMicQuiet();
  // Seed default admin account for recovery credentials — never auto-login
  if (loadUsers().length === 0) ensureDefaultAdminAccount();
  refreshGateSession();
  if (!getCurrentUser()) {
    enterUserAuth({ tab: "signin" });
    return;
  }
  showOnly("gate");
}

async function enterLearn() {
  if (!requireModeAccess("learn")) return;
  appMode = "learn";
  donProcessing = false;
  donSpeaking = false;
  setMicInputBlocked(false);
  showOnly("learn");
  llmHistory.length = 0;
  void refreshLlmStatus();
  const user = getCurrentUser();
  syncCarerFromProfile();
  if (user) touchUserPresence({ user, mode: "learn" });
  initSpeech();
  const first = carerFirstName(user?.name || "");
  if (!learnReady) {
    els.chat.innerHTML = "";
    addBubble(
      "don",
      `<p>${first ? `Hi <strong>${escapeHtml(first)}</strong> —` : "Hi —"} I’m <strong>careTalk</strong>. You’re in <strong>Talk to careTalk</strong> (carer help).</p>
       <p>I’m listening now — say <em>“Hi careTalk”</em>. If you say yes, I’ll ask what’s happening like a nurse on the floor.</p>
       <p>Or go straight in: <em>“careTalk, Meggie just fell…”</em> (use the resident’s name, not yours.)</p>`,
      { speakText: false },
    );
    learnReady = true;
  }
  window.speechSynthesis?.cancel();
  donSpeaking = false;
  els.statusLine.textContent = "Asking for microphone…";
  try {
    if (listening || speech?.listening) return;
    await speech.start();
    const label = speech.micLabel ? ` · ${speech.micLabel}` : "";
    els.statusLine.textContent = `Listening… speak now${label}`;
    toast("Listening — speak now");
  } catch (err) {
    const msg = err?.message || "Mic failed";
    toast(msg);
    els.statusLine.textContent = msg;
  }
}

function enterTrainAuth() {
  if (!requireModeAccess("train")) return;
  ensureDefaultPin();
  els.authHint.textContent = `Default PIN on first install: ${DEFAULT_PIN} — change it after sign-in.`;
  els.trainPin.value = "";
  showOnly("auth");
  els.trainPin.focus();
}

function enterTrain() {
  if (!requireModeAccess("train")) return;
  appMode = "train";
  markTrainAuthed(true);
  showOnly("train");
  renderTopicCatalog();
  renderCustomTopicList();
  renderKnowledgeList();
  renderIncidentList();
  fillAgencyForm();
}

function renderTopicCatalog() {
  if (!els.topicCatalog) return;
  const q = (els.topicSearch?.value || "").trim().toLowerCase();
  const all = listDonFamiliarTopics();
  const topics = q
    ? all.filter((t) => {
        const blob = `${t.title} ${t.summary} ${t.source} ${t.kindLabel} ${t.meta || ""}`.toLowerCase();
        return blob.includes(q);
      })
    : all;
  const counts = all.reduce((acc, t) => {
    acc[t.kind] = (acc[t.kind] || 0) + 1;
    return acc;
  }, {});
  if (els.topicCount) {
    els.topicCount.textContent = q
      ? `Showing ${topics.length} of ${all.length} topics`
      : `${all.length} topics · ${counts.pillar || 0} pillars · ${counts.scenario || 0} situations · ${
          counts.home || 0
        } home-trained · ${counts.capability || 0} special capabilities`;
  }

  const kindOrder = ["capability", "home", "scenario", "visual", "pillar"];
  const sorted = [...topics].sort((a, b) => {
    const d = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);
    if (d !== 0) return d;
    return a.title.localeCompare(b.title);
  });

  if (!sorted.length) {
    els.topicCatalog.innerHTML = `<li><p>No topics match “${escapeHtml(els.topicSearch?.value || "")}”.</p></li>`;
    return;
  }

  els.topicCatalog.innerHTML = sorted
    .map((t) => {
      const sourceHtml = t.sourceUrl
        ? `<a href="${escapeHtml(t.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(t.sourceUrl)}</a>`
        : escapeHtml(t.source);
      const badge =
        t.meta === "untrained"
          ? `<span class="badge warn">needs training</span>`
          : t.meta === "ready"
            ? `<span class="badge ok">trained</span>`
            : t.kind === "home"
              ? `<span class="badge home">home</span>`
              : `<span class="badge">${escapeHtml(t.kindLabel)}</span>`;
      return `<li class="topic-row kind-${escapeHtml(t.kind)}">
        <div class="topic-head">
          <h3>${escapeHtml(t.title)}</h3>
          ${badge}
        </div>
        <p>${escapeHtml((t.summary || "").slice(0, 260))}${(t.summary || "").length > 260 ? "…" : ""}</p>
        <div class="meta"><strong>Source:</strong> ${sourceHtml}</div>
        ${t.meta && t.meta !== "ready" && t.meta !== "untrained" ? `<div class="meta">${escapeHtml(t.meta)}</div>` : ""}
      </li>`;
    })
    .join("");
}

function renderKnowledgeList() {
  const list = loadCustomKnowledge();
  if (!list.length) {
    els.knowledgeList.innerHTML = `<li><p>No custom knowledge yet. Add the first item above.</p></li>`;
    return;
  }
  els.knowledgeList.innerHTML = list
    .map(
      (k) => `<li data-id="${escapeHtml(k.id)}">
        <h3>${escapeHtml(k.title)}</h3>
        <p>${escapeHtml(k.body.slice(0, 220))}${k.body.length > 220 ? "…" : ""}</p>
        <div class="meta">${escapeHtml(k.keywords?.join(", ") || "all topics")} · ${escapeHtml(
          k.addedBy || "Head nurse",
        )}${k.images?.length ? ` · ${k.images.length} image(s)` : ""}${
          k.sourceUrl
            ? ` · <a href="${escapeHtml(k.sourceUrl)}" target="_blank" rel="noopener">source</a>`
            : ""
        }</div>
        <button type="button" data-del="${escapeHtml(k.id)}">Remove</button>
      </li>`,
    )
    .join("");
}

function renderIncidentList() {
  if (!els.incidentList) return;
  const list = listUnresolvedIncidents();
  if (!list.length) {
    els.incidentList.innerHTML = `<li><p>No unresolved incidents. careTalk is covered for logged training gaps.</p></li>`;
    return;
  }
  els.incidentList.innerHTML = list
    .map(
      (inc) => `<li data-inc="${escapeHtml(inc.id)}">
        <h3>${escapeHtml(inc.topicLabel)}</h3>
        <p>${escapeHtml(inc.question)}</p>
        <div class="meta">${escapeHtml(inc.person || "—")} · ${escapeHtml(inc.carer || "—")} · ${escapeHtml(
          new Date(inc.createdAt).toLocaleString("en-GB"),
        )}${inc.agencyNotified ? " · agency notified" : ""}</div>
        <p class="hint">Carer said: ${escapeHtml(inc.utterance || "—")}</p>
        <button type="button" data-resolve="${escapeHtml(inc.id)}">Resolve — add topic &amp; web train</button>
      </li>`,
    )
    .join("");
}

function fillAgencyForm() {
  const a = loadAgencySettings();
  document.getElementById("agencyName").value = a.name || "";
  document.getElementById("agencyEmail").value = a.email || "";
  document.getElementById("agencyWebhook").value = a.webhookUrl || "";
  document.getElementById("agencyAuto").checked = a.autoForward !== false;
}

function renderCustomTopicList() {
  if (!els.customTopicList) return;
  const list = loadCustomTopics();
  if (!list.length) {
    els.customTopicList.innerHTML = `<li><p>No custom topics yet. Add one above, then fetch &amp; train.</p></li>`;
    return;
  }
  els.customTopicList.innerHTML = list
    .map(
      (t) => `<li data-topic="${escapeHtml(t.id)}">
        <h3>${escapeHtml(t.title)}</h3>
        <p>${escapeHtml(t.notes || "Ready to fetch & train from the web.")}</p>
        <div class="meta">${escapeHtml((t.keywords || []).join(", ") || "no keywords")}${
          t.lastTrainedAt
            ? ` · trained ${escapeHtml(new Date(t.lastTrainedAt).toLocaleString("en-GB"))}`
            : " · not trained yet"
        }</div>
        <button type="button" class="primary" data-train-topic="${escapeHtml(t.id)}">Fetch &amp; train</button>
        <button type="button" data-del-topic="${escapeHtml(t.id)}">Remove</button>
      </li>`,
    )
    .join("");
}

/* —— Mode gate —— */
els.topicSearch?.addEventListener("input", () => {
  renderTopicCatalog();
});

els.btnLearnMode.addEventListener("click", () => {
  void enterLearn();
});
els.btnTrainMode.addEventListener("click", () => {
  if (!requireModeAccess("train")) return;
  if (isTrainAuthed()) enterTrain();
  else enterTrainAuth();
});
els.btnReports?.addEventListener("click", () => enterReports());
els.btnOpenAuth?.addEventListener("click", () => enterUserAuth({ tab: "signin" }));
els.userAuthBack?.addEventListener("click", () => {
  pendingMode = null;
  els.signInForm?.reset();
  els.registerForm?.reset();
  if (els.userAuthPending) {
    els.userAuthPending.hidden = true;
    els.userAuthPending.textContent = "";
  }
  enterGate({ force: true });
});
els.btnSignOut?.addEventListener("click", () => {
  const id = getCurrentUser()?.id;
  signOutUser();
  if (id) clearUserPresence(id);
  markTrainAuthed(false);
  toast("Signed out");
  enterGate({ force: true });
});
els.userAuth?.querySelectorAll("[data-user-auth-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.getAttribute("data-user-auth-tab") || "signin";
    enterUserAuth({ mode: pendingMode, tab });
  });
});
els.signInForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    const user = signInUser({
      email: document.getElementById("signInEmail").value,
      password: document.getElementById("signInPassword").value,
    });
    touchUserPresence({ user, mode: "gate" });
    syncCarerFromProfile();
    els.signInForm.reset();
    toast(`Welcome, ${user.name}`);
    continuePendingMode();
    refreshGateSession();
  } catch (err) {
    refreshGateSession();
    const msg = err?.message || "Sign-in failed";
    if (/verify your email/i.test(msg)) {
      const email = document.getElementById("signInEmail")?.value?.trim().toLowerCase();
      if (email) showEmailVerify(email);
    }
    if (els.userAuthPending) {
      els.userAuthPending.hidden = false;
      els.userAuthPending.textContent = msg;
    }
    toast(msg);
  }
});
document.getElementById("btnRecoverDefaultAdmin")?.addEventListener("click", () => {
  if (
    !window.confirm(
      "Restore default admin on this device?\n\nThis removes all other accounts and data (reports, training, pins).\n\nEmail: admin@don.local\nPassword: 2473",
    )
  ) {
    return;
  }
  try {
    const r = resetDonDeviceData();
    if (els.userAuthPending) {
      els.userAuthPending.hidden = true;
      els.userAuthPending.textContent = "";
    }
    toast(`Restored ${r.credentials.email} — sign in with password ${r.credentials.password}`);
    refreshGateSession();
    enterUserAuth({ tab: "signin" });
    if (els.userAuthPending) {
      els.userAuthPending.hidden = false;
      els.userAuthPending.textContent = `Default admin ready: ${r.credentials.email} / ${r.credentials.password}`;
    }
  } catch (err) {
    toast(err?.message || "Could not restore default admin");
  }
});
els.registerForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    const email = document.getElementById("regEmail").value;
    const { user, isFirstAdmin, needsEmailVerification } = registerUser({
      name: document.getElementById("regName").value,
      email,
      password: document.getElementById("regPassword").value,
      role: document.getElementById("regRole").value,
    });
    els.registerForm.reset();
    if (isFirstAdmin || isApprovedUser(user)) {
      toast(isFirstAdmin ? "Admin account created" : `Welcome, ${user.name}`);
      continuePendingMode();
    } else if (needsEmailVerification) {
      toast("Check your email for the verification code");
      showEmailVerify(email.trim().toLowerCase());
    }
    refreshGateSession();
  } catch (err) {
    toast(err?.message || "Registration failed");
  }
});
els.verifyEmailForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    const result = verifyEmail({
      email: els.verifyEmail?.value,
      code: els.verifyCode?.value,
    });
    els.verifyEmailForm.reset();
    if (result.autoApproved) {
      toast(`Email verified — welcome, ${result.user.name}`);
      setCurrentUserId(result.user.id);
      continuePendingMode();
    } else if (result.needsAdminApproval) {
      toast("Email verified — waiting for an admin to approve your access");
      enterUserAuth({ tab: "signin" });
      if (els.userAuthPending) {
        els.userAuthPending.hidden = false;
        els.userAuthPending.textContent =
          "Email verified. Another admin must approve your manager / supervisor account before you can sign in.";
      }
    }
    refreshGateSession();
  } catch (err) {
    toast(err?.message || "Verification failed");
  }
});
els.btnResendCode?.addEventListener("click", () => {
  try {
    const email = els.verifyEmail?.value;
    if (!email) {
      toast("Enter your email on the register form first");
      return;
    }
    sendVerificationEmail(email);
    toast("New code sent — check your email");
  } catch (err) {
    toast(err?.message || "Could not resend code");
  }
});
els.reportsExit?.addEventListener("click", () => enterGate());
els.reportsApp?.querySelectorAll("[data-reports-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    reportsTab = btn.getAttribute("data-reports-tab") || "all";
    els.reportsApp.querySelectorAll("[data-reports-tab]").forEach((b) => {
      const on = b === btn;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    reportsSelectedId = null;
    if (reportsTab !== "users") {
      usersSelectedId = null;
      usersSubPanel = null;
    }
    renderReports();
  });
});
els.reportsList?.addEventListener("click", (e) => {
  if (e.target.id === "btnResetDevice") {
    e.preventDefault();
    if (
      !window.confirm(
        "Clear ALL careTalk data on this device?\n\nUsers, reports, training, pins, agency settings — then default admin only.\n\nThis cannot be undone.",
      )
    ) {
      return;
    }
    try {
      const r = resetDonDeviceData();
      markTrainAuthed(false);
      toast(`Device reset — ${r.credentials.email} / ${r.credentials.password}`);
      refreshGateSession();
      enterGate({ force: true });
      if (reportsTab === "users") renderReports();
    } catch (err) {
      toast(err?.message || "Could not reset device data");
    }
    return;
  }
  if (e.target.id === "btnResetUsers") {
    e.preventDefault();
    if (
      !window.confirm(
        "Remove every registered user and keep only the default admin?\n\nThis cannot be undone.",
      )
    ) {
      return;
    }
    try {
      markTrainAuthed(false);
      resetUsersToDefaultAdmin();
      toast(`Users cleared — default admin: ${DEFAULT_ADMIN.email}`);
      refreshGateSession();
      enterGate({ force: true });
    } catch (err) {
      toast(err?.message || "Could not reset users");
    }
    return;
  }
  if (reportsTab === "users") {
    const pinId = e.target.closest?.("[data-pin-id]")?.getAttribute?.("data-pin-id");
    if (pinId) {
      e.preventDefault();
      reportsSelectedId = pinId;
      const doc = getPinnedReportById(pinId);
      if (doc?.reportBody && els.reportsDetail) {
        els.reportsDetail.classList.remove("hidden");
        els.reportsDetail.textContent = doc.reportBody;
      }
      renderUserStatistics();
      return;
    }
    const headUserId = e.target.closest?.(".user-session-head")?.getAttribute?.("data-user-id");
    if (headUserId) {
      e.preventDefault();
      if (usersSelectedId === headUserId) {
        usersSelectedId = null;
        reportsSelectedId = null;
        els.reportsDetail?.classList.add("hidden");
      } else {
        usersSelectedId = headUserId;
        usersSubPanel = "profile";
      }
      renderUserStatistics();
      return;
    }
  }
  const approveId = e.target.getAttribute?.("data-approve");
  if (approveId) {
    e.preventDefault();
    try {
      const role = e.target.getAttribute("data-role") || "carer";
      const u = approveUser(approveId, { role });
      toast(`Approved ${u.name} as ${u.role}`);
      renderReports();
    } catch (err) {
      toast(err?.message || "Could not approve");
    }
    return;
  }
  const rejectId = e.target.getAttribute?.("data-reject");
  if (rejectId) {
    e.preventDefault();
    try {
      const u = rejectUser(rejectId);
      toast(`Declined ${u.name}`);
      renderReports();
    } catch (err) {
      toast(err?.message || "Could not decline");
    }
    return;
  }
  if (reportsTab === "regs" || reportsTab === "users") return;
  const row = e.target.closest(".reports-item[data-id]");
  if (!row) return;
  reportsSelectedId = reportsSelectedId === row.dataset.id ? null : row.dataset.id;
  renderReports();
});
els.authBack.addEventListener("click", () => enterGate());
els.learnExit.addEventListener("click", () => enterGate());
els.trainExit.addEventListener("click", () => {
  markTrainAuthed(false);
  enterGate();
});

els.authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!verifyTrainPin(els.trainPin.value)) {
    toast("Incorrect PIN");
    return;
  }
  enterTrain();
  toast("Give careTalk more knowledge unlocked");
});

els.topicForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    const row = addCustomTopic({
      title: document.getElementById("topicTitle").value,
      keywords: document.getElementById("topicKeywords").value,
      notes: document.getElementById("topicNotes").value,
    });
    els.topicForm.reset();
    renderCustomTopicList();
    renderTopicCatalog();
    toast(`Topic added — fetch & train “${row.title}”`);
  } catch (err) {
    toast(err?.message || "Could not add topic");
  }
});

els.customTopicList?.addEventListener("click", async (e) => {
  const del = e.target.getAttribute?.("data-del-topic");
  if (del) {
    removeCustomTopic(del);
    renderCustomTopicList();
    renderTopicCatalog();
    toast("Topic removed");
    return;
  }
  const trainId = e.target.getAttribute?.("data-train-topic");
  if (!trainId) return;
  const topic = loadCustomTopics().find((t) => t.id === trainId);
  if (!topic) return;
  const btn = e.target;
  btn.disabled = true;
  const log = els.webTrainProgress;
  log.classList.remove("hidden");
  const lines = [];
  const push = (msg) => {
    lines.push(msg);
    log.innerHTML = `<p><strong>Train: ${escapeHtml(topic.title)}</strong></p><pre class="record">${escapeHtml(
      lines.join("\n"),
    )}</pre>`;
  };
  push(`Searching the web for “${topic.title}”…`);
  try {
    const summary = await webTrainAllTopics({
      topicIds: [trainId],
      maxUrlsPerTopic: 2,
      onProgress: push,
    });
    renderCustomTopicList();
    renderTopicCatalog();
    renderKnowledgeList();
    toast(summary.trained ? `Trained ${topic.title}` : `No new sources for ${topic.title}`);
  } catch (err) {
    push(err?.message || "Train failed");
    toast(err?.message || "Train failed");
  } finally {
    btn.disabled = false;
  }
});

els.incidentList?.addEventListener("click", async (e) => {
  const id = e.target.getAttribute?.("data-resolve");
  if (!id) return;
  const inc = listUnresolvedIncidents().find((i) => i.id === id);
  if (!inc) return;
  const topic = addCustomTopic({
    title: inc.topicLabel,
    keywords: "medicine, medication, refuse, refusal, meds, tablets, mar",
    notes: inc.question,
  });
  closeTrainingIncident(id, { note: `Linked to topic ${topic.id} — web train started` });
  renderIncidentList();
  renderCustomTopicList();
  toast("Topic added — fetching training now…");
  const log = els.webTrainProgress;
  log.classList.remove("hidden");
  const lines = [];
  const push = (msg) => {
    lines.push(msg);
    log.innerHTML = `<p><strong>Resolve: ${escapeHtml(inc.topicLabel)}</strong></p><pre class="record">${escapeHtml(
      lines.join("\n"),
    )}</pre>`;
  };
  try {
    await webTrainAllTopics({ topicIds: [topic.id], maxUrlsPerTopic: 2, onProgress: push });
    renderTopicCatalog();
    renderKnowledgeList();
    renderCustomTopicList();
    toast("Incident resolved — careTalk trained from the web");
  } catch (err) {
    toast(err?.message || "Web train failed — topic still added");
  }
});

els.webTrainBtn?.addEventListener("click", async () => {
  const btn = els.webTrainBtn;
  const log = els.webTrainProgress;
  const gapsOnly = document.getElementById("webTrainGapsOnly")?.checked;
  btn.disabled = true;
  btn.textContent = "Searching & training…";
  log.classList.remove("hidden");
  const lines = [];
  const push = (msg) => {
    lines.push(msg);
    log.innerHTML = `<p><strong>Web train</strong></p><pre class="record">${escapeHtml(lines.join("\n"))}</pre>`;
    log.scrollTop = log.scrollHeight;
  };
  push("Starting web search for topics…");
  try {
    let topicIds = null;
    if (gapsOnly) {
      const customIds = loadCustomTopics()
        .filter((t) => !t.lastTrainedAt)
        .map((t) => t.id);
      topicIds = [
        ...listWebTrainableTopics()
          .filter((t) => t.id.startsWith("capability_"))
          .map((t) => t.id),
        ...customIds,
      ];
      push(`Gaps / untrained topics (${topicIds.length})`);
    }
    const summary = await webTrainAllTopics({
      topicIds,
      maxUrlsPerTopic: 2,
      onProgress: push,
    });
    renderTopicCatalog();
    renderCustomTopicList();
    renderKnowledgeList();
    toast(`Web train finished — ${summary.trained} source(s) added`);
  } catch (err) {
    push(err?.message || "Web train failed");
    toast(err?.message || "Web train failed");
  } finally {
    btn.disabled = false;
    btn.textContent = "Search web & train careTalk";
  }
});

els.urlTrainForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = document.getElementById("kUrl").value;
  const btn = els.urlTrainBtn;
  btn.disabled = true;
  btn.textContent = "Fetching…";
  els.urlTrainPreview.classList.add("hidden");
  try {
    toast("Pulling knowledge from URL…");
    const draft = await trainFromUrl(url);
    const saved = addCustomKnowledge({
      title: draft.title,
      keywords: draft.keywords,
      body: draft.body,
      doList: draft.doList,
      dontList: draft.dontList,
      images: draft.images || [],
      sourceUrl: draft.sourceUrl,
      addedBy: "Head nurse (URL train)",
    });

    els.urlTrainPreview.innerHTML = `
      <p><strong>Trained from URL</strong> (${escapeHtml(draft.via)} · ${draft.chars} chars${
        draft.images?.length ? ` · ${draft.images.length} image(s)` : ""
      })</p>
      <p class="hint"><a href="${escapeHtml(draft.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(
        draft.sourceUrl,
      )}</a></p>
      <p><strong>${escapeHtml(saved.title)}</strong></p>
      <p>${escapeHtml(saved.body.slice(0, 360))}${saved.body.length > 360 ? "…" : ""}</p>
      <p class="hint">Saved to careTalk’s knowledge.</p>
    `;
    els.urlTrainPreview.classList.remove("hidden");
    renderTopicCatalog();
    renderKnowledgeList();
    toast("careTalk trained from URL");
    document.getElementById("kUrl").value = "";
  } catch (err) {
    toast(err?.message || "URL train failed");
    els.urlTrainPreview.innerHTML = `<p class="hint">${escapeHtml(err?.message || "URL train failed")}</p>`;
    els.urlTrainPreview.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Fetch & train careTalk";
  }
});

els.knowledgeList.addEventListener("click", (e) => {
  const id = e.target.getAttribute?.("data-del");
  if (!id) return;
  removeCustomKnowledge(id);
  renderTopicCatalog();
  renderKnowledgeList();
  toast("Removed");
});

els.agencyForm.addEventListener("submit", (e) => {
  e.preventDefault();
  saveAgencySettings({
    name: document.getElementById("agencyName").value,
    email: document.getElementById("agencyEmail").value,
    webhookUrl: document.getElementById("agencyWebhook").value,
    autoForward: document.getElementById("agencyAuto").checked,
  });
  toast("Agency settings saved");
});

els.pinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    setTrainPin(document.getElementById("newPin").value);
    document.getElementById("newPin").value = "";
    toast("PIN updated");
  } catch (err) {
    toast(err?.message || "PIN not updated");
  }
});

els.chat.addEventListener("click", async (e) => {
  const zoomBtn = e.target.closest("[data-zoom-src]");
  if (zoomBtn) {
    const box = document.getElementById("lightbox");
    const img = document.getElementById("lightboxImg");
    img.src = zoomBtn.getAttribute("data-zoom-src");
    img.alt = zoomBtn.getAttribute("data-zoom-alt") || "";
    box.classList.remove("hidden");
    return;
  }
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.getAttribute("data-act");
  if (act === "copy") {
    const pre = btn.closest(".bubble")?.querySelector(".record");
    try {
      await navigator.clipboard.writeText(pre?.textContent || "");
      toast("Report copied");
    } catch {
      toast("Could not copy");
    }
  }
  if (act === "forward") {
    const pre = btn.closest(".bubble")?.querySelector(".record");
    await doForward(pre?.textContent || "", {
      carer: getLoggedInCarerName(),
      person: "",
      scenarioLabel: "Care situation",
    });
  }
  if (act === "new") {
    session = null;
    brain.reset();
    addBubble("don", `<p>${escapeHtml(greetingOnWake())}</p>`);
    brain.engage();
  }
  if (act === "start-qs" && session) {
    beginQuestionsFromAdvice();
  }
  if (act === "skip-advice" && session) {
    beginQuestionsFromAdvice({ skipIntro: true });
  }
});

document.getElementById("lightboxClose")?.addEventListener("click", () => {
  document.getElementById("lightbox")?.classList.add("hidden");
});
document.getElementById("lightbox")?.addEventListener("click", (e) => {
  if (e.target.id === "lightbox") e.currentTarget.classList.add("hidden");
});

els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  handleUserText(els.input.value);
});

els.micBtn.addEventListener("click", async () => {
  if (appMode !== "learn") return;
  if (!speech) return toast("Voice unavailable — type instead");
  if (listening || speech.listening) {
    wantListenAfterSpeak = false;
    window.speechSynthesis?.cancel();
    donSpeaking = false;
    await speech.stop();
    toast("Mic off");
    return;
  }
  window.speechSynthesis?.cancel();
  donSpeaking = false;
  els.statusLine.textContent = "Asking for microphone…";
  try {
    await speech.start();
    const label = speech.micLabel ? ` · ${speech.micLabel}` : "";
    els.statusLine.textContent = `Listening… speak now${label}`;
    toast("Listening — speak now");
  } catch (err) {
    const msg = err?.message || "Mic failed";
    toast(msg);
    els.statusLine.textContent = msg;
  }
});

function isLocalResetHost() {
  const h = window.location.hostname;
  return import.meta.env.DEV || h === "localhost" || h === "127.0.0.1";
}

async function boot() {
  await bootstrapNativeShell();
  if (isLocalResetHost() && new URLSearchParams(window.location.search).get("reset") === "1") {
    try {
      resetDonDeviceData();
      const url = new URL(window.location.href);
      url.searchParams.delete("reset");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    } catch (err) {
      console.error("Device reset failed", err);
    }
  }
  ensureDefaultPin();
  if (loadUsers().length === 0) ensureDefaultAdminAccount();
  warmUpVoices();
  window.speechSynthesis?.addEventListener?.("voiceschanged", () => warmUpVoices());
  void refreshLlmStatus();
  enterGate();
}

boot();
