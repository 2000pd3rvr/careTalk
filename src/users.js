/**
 * Device-local user registration, email verification & admin approval.
 * Carers: auto-approved after email is verified.
 * Admins: email verify + another admin must approve.
 */

const KEYS = {
  users: "don.users",
  sessionUser: "don.session.userId",
};

const VERIFY_TTL_MS = 30 * 60 * 1000;

function hashSecret(value) {
  const s = `don.user|${String(value || "").trim()}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeUserRow(u) {
  const row = { ...u };
  if (row.emailVerified === undefined) {
    row.emailVerified = row.status === "approved";
  }
  if (!row.requestedRole) row.requestedRole = row.role === "admin" ? "admin" : "carer";
  return row;
}

export function loadUsers() {
  return readJson(KEYS.users, []).map(normalizeUserRow);
}

export function saveUsers(list) {
  writeJson(KEYS.users, Array.isArray(list) ? list : []);
}

export function publicUser(u) {
  if (!u) return null;
  const {
    passwordHash,
    verificationCodeHash,
    verificationExpiresAt,
    ...rest
  } = u;
  return rest;
}

export function getCurrentUserId() {
  return sessionStorage.getItem(KEYS.sessionUser) || "";
}

export function getCurrentUser() {
  const id = getCurrentUserId();
  if (!id) return null;
  const user = publicUser(loadUsers().find((u) => u.id === id) || null);
  if (user && user.status !== "approved") {
    setCurrentUserId("");
    return null;
  }
  return user;
}

export function setCurrentUserId(id) {
  if (id) sessionStorage.setItem(KEYS.sessionUser, id);
  else sessionStorage.removeItem(KEYS.sessionUser);
}

export function signOutUser() {
  setCurrentUserId("");
}

export function isApprovedUser(user = getCurrentUser()) {
  return Boolean(user && user.status === "approved");
}

export function isAdminUser(user = getCurrentUser()) {
  return isApprovedUser(user) && user.role === "admin";
}

export function isApprover(user = getCurrentUser()) {
  return isAdminUser(user);
}

export function canAccessModes(user = getCurrentUser()) {
  return isApprovedUser(user);
}

export function canAccessMode(mode, user = getCurrentUser()) {
  if (!isApprovedUser(user)) return false;
  if (mode === "learn") return true;
  if (mode === "train" || mode === "reports") return isAdminUser(user);
  return false;
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function applyCarerAutoApprove(list, idx) {
  const u = list[idx];
  if (u.requestedRole !== "admin" && u.role !== "admin") {
    list[idx] = {
      ...u,
      status: "approved",
      role: "carer",
      emailVerified: true,
      approvedAt: new Date().toISOString(),
      approvedBy: "email_verified",
      verificationCodeHash: null,
      verificationExpiresAt: null,
    };
  } else {
    list[idx] = {
      ...u,
      emailVerified: true,
      verificationCodeHash: null,
      verificationExpiresAt: null,
    };
  }
}

/**
 * Open the user's email app with a verification code (device-local; no server).
 */
export function sendVerificationEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  const list = loadUsers();
  const idx = list.findIndex((u) => u.email === e);
  if (idx < 0) throw new Error("No registration found for that email");

  const code = generateVerificationCode();
  list[idx].verificationCodeHash = hashSecret(code);
  list[idx].verificationExpiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
  saveUsers(list);

  const subject = encodeURIComponent("careTalk — verify your email");
  const body = encodeURIComponent(
    `Your careTalk verification code is: ${code}\n\nEnter this code in the app to verify your email.\n\nCode expires in 30 minutes.`,
  );
  const mailto = `mailto:${encodeURIComponent(e)}?subject=${subject}&body=${body}`;
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

  return { email: e, expiresAt: list[idx].verificationExpiresAt, codeForDev: code };
}

export function verifyEmail({ email, code }) {
  const e = String(email || "").trim().toLowerCase();
  const c = String(code || "").trim();
  if (!c) throw new Error("Enter the verification code from your email");

  const list = loadUsers();
  const idx = list.findIndex((u) => u.email === e);
  if (idx < 0) throw new Error("No registration found for that email");

  const u = list[idx];
  if (u.emailVerified && u.status === "approved") {
    return { user: publicUser(u), autoApproved: true, needsAdminApproval: false };
  }

  const exp = u.verificationExpiresAt ? new Date(u.verificationExpiresAt).getTime() : 0;
  if (!u.verificationCodeHash || exp < Date.now()) {
    throw new Error("Verification code expired — request a new code");
  }
  if (hashSecret(c) !== u.verificationCodeHash) {
    throw new Error("Incorrect verification code");
  }

  applyCarerAutoApprove(list, idx);
  saveUsers(list);

  const updated = publicUser(list[idx]);
  const autoApproved = updated.status === "approved";
  return {
    user: updated,
    autoApproved,
    needsAdminApproval: updated.status === "pending" && updated.requestedRole === "admin",
  };
}

export function listPendingUsers() {
  return loadUsers()
    .filter((u) => u.status === "pending")
    .map(publicUser);
}

/** Pending admin registrations that still need another admin (after email verified). */
export function listPendingAdminApprovals() {
  return loadUsers()
    .filter((u) => u.status === "pending" && u.requestedRole === "admin" && u.emailVerified)
    .map(publicUser);
}

export function listUsersForAdmin() {
  return loadUsers()
    .map(publicUser)
    .sort((a, b) => {
      const rank = { pending: 0, approved: 1, rejected: 2 };
      const d = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      if (d !== 0) return d;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
}

export function listApprovedCarers() {
  return loadUsers()
    .filter((u) => u.status === "approved" && u.role === "carer")
    .map(publicUser);
}

export function getUserStatistics() {
  const users = loadUsers();
  const pub = users.map(publicUser);
  const approved = pub.filter((u) => u.status === "approved");
  const pending = pub.filter((u) => u.status === "pending");
  const rejected = pub.filter((u) => u.status === "rejected");
  const carers = approved.filter((u) => u.role === "carer");
  const admins = approved.filter((u) => u.role === "admin");
  const pendingAdminList = pending.filter((u) => u.requestedRole === "admin" && u.emailVerified);
  const awaitingEmail = pending.filter((u) => !u.emailVerified);
  const pendingAdminUnverified = pending.filter((u) => u.requestedRole === "admin" && !u.emailVerified);

  return {
    total: pub.length,
    approved: approved.length,
    pending: pending.length,
    rejected: rejected.length,
    carers: carers.length,
    admins: admins.length,
    pendingAdmin: pendingAdminList.length,
    awaitingEmail: awaitingEmail.length,
    pendingAdminUnverified: pendingAdminUnverified.length,
    recent: [...pub]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 8),
  };
}

/**
 * @param {{ name: string, email: string, password: string, role?: 'carer'|'admin' }} data
 */
export function registerUser({ name, email, password, role = "carer" }) {
  const n = String(name || "").trim();
  const e = String(email || "").trim().toLowerCase();
  const p = String(password || "").trim();
  const wantAdmin = role === "admin";

  if (n.length < 2) throw new Error("Enter your full name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("Enter a valid email");
  if (p.length < 4) throw new Error("Password must be at least 4 characters");

  const list = loadUsers();
  if (list.some((u) => u.email === e)) throw new Error("That email is already registered");

  const firstUser = list.length === 0;
  const user = {
    id: `user_${Date.now()}`,
    name: n,
    email: e,
    passwordHash: hashSecret(p),
    role: firstUser ? "admin" : "carer",
    requestedRole: wantAdmin ? "admin" : "carer",
    status: firstUser ? "approved" : "pending",
    emailVerified: firstUser,
    verificationCodeHash: null,
    verificationExpiresAt: null,
    createdAt: new Date().toISOString(),
    approvedAt: firstUser ? new Date().toISOString() : null,
    approvedBy: firstUser ? "bootstrap" : null,
  };
  list.unshift(user);
  saveUsers(list);

  if (user.status === "approved") setCurrentUserId(user.id);

  let verification = null;
  if (!firstUser) {
    verification = sendVerificationEmail(e);
  }

  return {
    user: publicUser(user),
    isFirstAdmin: firstUser,
    needsEmailVerification: !firstUser,
    verification,
  };
}

export function signInUser({ email, password }) {
  const e = String(email || "").trim().toLowerCase();
  const p = String(password || "").trim();
  let user = loadUsers().find((u) => u.email === e);
  if ((!user || user.passwordHash !== hashSecret(p)) && e === DEFAULT_ADMIN.email.toLowerCase()) {
    ensureDefaultAdminAccount({ repairPassword: true });
    user = loadUsers().find((u) => u.email === e);
  }
  if (!user || user.passwordHash !== hashSecret(p)) {
    if (e === DEFAULT_ADMIN.email.toLowerCase() && !loadUsers().some((u) => u.email === e)) {
      throw new Error(
        "Default admin is not set up on this device. Use “restore default admin” on the sign-in screen, or open ?reset=1 on localhost.",
      );
    }
    throw new Error("Email or password not recognised");
  }
  if (!user.emailVerified) {
    setCurrentUserId("");
    throw new Error("Verify your email first — enter the code we sent to your inbox.");
  }
  if (user.status === "pending" && user.requestedRole === "admin") {
    setCurrentUserId("");
    throw new Error(
      "Your email is verified. Another admin (manager / nurse / supervisor) must approve your admin access before you can sign in.",
    );
  }
  if (user.status === "pending") {
    setCurrentUserId("");
    throw new Error("Your account is not active yet — complete email verification or contact your manager.");
  }
  if (user.status === "rejected") {
    setCurrentUserId("");
    throw new Error("This registration was declined. Contact your manager or head nurse.");
  }
  if (user.status !== "approved") {
    setCurrentUserId("");
    throw new Error("Account is not approved for sign-in yet.");
  }
  setCurrentUserId(user.id);
  return publicUser(user);
}

export function approveUser(userId, { role, actorId } = {}) {
  const actor = getCurrentUser();
  if (!isAdminUser(actor)) throw new Error("Only an admin can approve registrations");

  const list = loadUsers();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx < 0) throw new Error("User not found");

  const target = list[idx];

  // Promote an already-approved carer to admin
  if (target.status === "approved" && role === "admin") {
    list[idx] = { ...target, role: "admin" };
    saveUsers(list);
    return publicUser(list[idx]);
  }

  if (target.status !== "pending") {
    throw new Error("Only pending registrations need approval here");
  }
  if (!target.emailVerified) {
    throw new Error("User must verify their email before admin approval");
  }
  if (target.requestedRole !== "admin") {
    throw new Error("Support workers are approved automatically after email verification");
  }

  const nextRole = role === "carer" ? "carer" : "admin";

  list[idx] = {
    ...list[idx],
    status: "approved",
    role: nextRole,
    approvedAt: new Date().toISOString(),
    approvedBy: actorId || actor.id,
  };
  saveUsers(list);
  return publicUser(list[idx]);
}

export function rejectUser(userId) {
  const actor = getCurrentUser();
  if (!isAdminUser(actor)) throw new Error("Only an admin can reject registrations");

  const list = loadUsers();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx < 0) throw new Error("User not found");
  if (list[idx].id === actor.id) throw new Error("You cannot reject yourself");

  list[idx] = {
    ...list[idx],
    status: "rejected",
    approvedAt: null,
    approvedBy: actor.id,
    rejectedAt: new Date().toISOString(),
  };
  saveUsers(list);
  return publicUser(list[idx]);
}

export function setUserRole(userId, role) {
  const actor = getCurrentUser();
  if (!isAdminUser(actor)) throw new Error("Only an admin can change roles");
  if (role !== "admin" && role !== "carer") throw new Error("Invalid role");

  const list = loadUsers();
  const idx = list.findIndex((u) => u.id === userId);
  if (idx < 0) throw new Error("User not found");

  list[idx] = { ...list[idx], role };
  saveUsers(list);
  return publicUser(list[idx]);
}

/** Default bootstrap admin (device-local). Change password after first sign-in. */
export const DEFAULT_ADMIN = {
  name: "careTalk Admin",
  email: "admin@don.local",
  password: "2473",
};

function buildDefaultAdminRow() {
  const now = new Date().toISOString();
  return {
    id: "user_default_admin",
    name: DEFAULT_ADMIN.name,
    email: DEFAULT_ADMIN.email,
    passwordHash: hashSecret(DEFAULT_ADMIN.password),
    role: "admin",
    requestedRole: "admin",
    status: "approved",
    emailVerified: true,
    verificationCodeHash: null,
    verificationExpiresAt: null,
    createdAt: now,
    approvedAt: now,
    approvedBy: "default_reset",
  };
}

/**
 * Fresh device or recovery: ensure admin@don.local exists with password 2473.
 * @param {{ repairPassword?: boolean }} opts — reset password hash for default admin if present
 */
export function ensureDefaultAdminAccount({ repairPassword = false } = {}) {
  const email = DEFAULT_ADMIN.email.toLowerCase();
  let list = loadUsers();

  if (list.length === 0) {
    const user = buildDefaultAdminRow();
    saveUsers([user]);
    setCurrentUserId(user.id);
    return { user: publicUser(user), created: true, credentials: { ...DEFAULT_ADMIN } };
  }

  const idx = list.findIndex((u) => u.email === email);
  if (idx < 0) {
    return { user: null, created: false, credentials: { ...DEFAULT_ADMIN } };
  }

  const row = list[idx];
  const expectedHash = hashSecret(DEFAULT_ADMIN.password);
  const needsRepair =
    repairPassword ||
    row.passwordHash !== expectedHash ||
    row.status !== "approved" ||
    !row.emailVerified ||
    row.role !== "admin";

  if (needsRepair) {
    list[idx] = {
      ...row,
      passwordHash: expectedHash,
      role: "admin",
      requestedRole: "admin",
      status: "approved",
      emailVerified: true,
      approvedAt: row.approvedAt || new Date().toISOString(),
      approvedBy: row.approvedBy || "default_repair",
    };
    saveUsers(list);
    return { user: publicUser(list[idx]), created: false, repaired: true, credentials: { ...DEFAULT_ADMIN } };
  }

  return { user: publicUser(row), created: false, credentials: { ...DEFAULT_ADMIN } };
}

/**
 * Remove all accounts and leave only the default admin.
 * @param {{ skipAuth?: boolean }} opts — skipAuth for recovery (browser console only).
 */
export function resetUsersToDefaultAdmin({ skipAuth = false } = {}) {
  if (!skipAuth) {
    const actor = getCurrentUser();
    if (!isAdminUser(actor)) {
      throw new Error("Only an admin can reset all users");
    }
  }

  const now = new Date().toISOString();
  const user = buildDefaultAdminRow();
  user.createdAt = now;
  user.approvedAt = now;
  saveUsers([user]);
  setCurrentUserId(user.id);
  return { user: publicUser(user), credentials: { ...DEFAULT_ADMIN } };
}
