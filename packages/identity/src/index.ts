import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type UserStatus = "invited" | "active" | "suspended";
export type IdentityRole = "user" | "admin";
export type IdentityCapability = "identity.read" | "identity.manage" | "factory.approve" | "factory.publish" | "credentials.manage";

export interface UserRecord {
  id: string;
  email: string;
  normalizedEmail: string;
  displayName: string;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRecord {
  id: string;
  userId: string;
  role: "admin";
  scope: "global";
  capabilities: IdentityCapability[];
  grantedAt: string;
  grantedBy: string;
  active: boolean;
}

export type IdentityAuditEvent = {
  id: string;
  action: "user.created" | "admin.granted" | "admin.revoked" | "user.suspended" | "user.activated" | "user.email_verified";
  actorId: string;
  targetId: string;
  recordedAt: string;
  metadata?: Record<string, string>;
};

export interface EmailVerificationRecord { id: string; userId: string; tokenHash: string; createdAt: string; expiresAt: string; status: "pending" | "sent" | "sent_unverified" | "failed" | "consumed"; consumedAt?: string; providerMessageId?: string; }
export interface VerificationEmailSender { send(input: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<{ providerMessageId: string; state?: "verified" | "accepted_unverified" }>; }

interface IdentityState { users: UserRecord[]; admins: AdminRecord[]; audit: IdentityAuditEvent[]; verifications: EmailVerificationRecord[]; }

export class IdentityStore {
  private state: IdentityState;
  constructor(private readonly storagePath: string) {
    mkdirSync(dirname(storagePath), { recursive: true });
    if (existsSync(storagePath)) {
      const parsed = JSON.parse(readFileSync(storagePath, "utf8")) as Partial<IdentityState>;
      this.state = { users: parsed.users ?? [], admins: parsed.admins ?? [], audit: parsed.audit ?? [], verifications: parsed.verifications ?? [] };
    } else this.state = { users: [], admins: [], audit: [], verifications: [] };
  }
  getUser(id: string): UserRecord | undefined { return this.state.users.find((user) => user.id === id); }
  getUserByEmail(email: string): UserRecord | undefined { return this.state.users.find((user) => user.normalizedEmail === normalizeEmail(email)); }
  getAdminForUser(userId: string): AdminRecord | undefined { return this.state.admins.find((admin) => admin.userId === userId && admin.active); }
  listUsers(): UserRecord[] { return this.state.users.map((user) => ({ ...user })); }
  listAdmins(): AdminRecord[] { return this.state.admins.filter((admin) => admin.active).map((admin) => ({ ...admin, capabilities: [...admin.capabilities] })); }
  listAudit(): IdentityAuditEvent[] { return this.state.audit.map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined })); }
  listVerifications(): EmailVerificationRecord[] { return this.state.verifications.map((record) => ({ ...record })); }

  createUser(input: { id: string; email: string; displayName: string; actorId: string; status?: UserStatus; emailVerified?: boolean }): UserRecord {
    if (this.getUser(input.id)) throw new Error(`duplicate user ${input.id}`);
    if (this.getUserByEmail(input.email)) throw new Error(`duplicate email ${input.email}`);
    const now = new Date().toISOString();
    const user: UserRecord = { id: input.id, email: input.email, normalizedEmail: normalizeEmail(input.email), displayName: input.displayName, status: input.status ?? "invited", emailVerified: input.emailVerified ?? false, createdAt: now, updatedAt: now };
    this.state.users.push(user); this.record("user.created", input.actorId, user.id); this.persist(); return { ...user };
  }

  grantAdmin(input: { id: string; userId: string; grantedBy: string; capabilities?: IdentityCapability[] }): AdminRecord {
    const user = this.getUser(input.userId); if (!user) throw new Error(`unknown user ${input.userId}`);
    if (this.getAdminForUser(input.userId)) throw new Error(`active admin already exists for ${input.userId}`);
    const admin: AdminRecord = { id: input.id, userId: user.id, role: "admin", scope: "global", capabilities: input.capabilities ?? ["identity.read", "identity.manage", "factory.approve", "factory.publish", "credentials.manage"], grantedAt: new Date().toISOString(), grantedBy: input.grantedBy, active: true };
    this.state.admins.push(admin); this.record("admin.granted", input.grantedBy, user.id, { adminId: admin.id }); this.persist(); return { ...admin, capabilities: [...admin.capabilities] };
  }

  createEmailVerification(userId: string, baseUrl: string, sender: VerificationEmailSender, now = new Date(), ttlMs = 30 * 60 * 1000): Promise<EmailVerificationRecord> {
    const user = this.getUser(userId); if (!user) return Promise.reject(new Error(`unknown user ${userId}`));
    if (user.emailVerified) return Promise.reject(new Error(`email already verified for ${userId}`));
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hashVerificationToken(rawToken); const id = `ver_${randomBytes(12).toString("hex")}`;
    const record: EmailVerificationRecord = { id, userId, tokenHash, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString(), status: "pending" };
    this.state.verifications.push(record); this.persist();
    return sender.send({ to: user.email, subject: "Verify your Internet Factories email", text: `Verify your email address: ${baseUrl.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(rawToken)}`, idempotencyKey: id }).then((result) => {
      record.status = result.state === "accepted_unverified" ? "sent_unverified" : "sent"; record.providerMessageId = result.providerMessageId; this.persist(); return { ...record };
    }).catch((error) => { record.status = "failed"; this.persist(); throw error; });
  }

  verifyEmail(rawToken: string, now = new Date()): UserRecord {
    const tokenHash = hashVerificationToken(rawToken); const record = this.state.verifications.find((item) => safeEqual(item.tokenHash, tokenHash) && item.status !== "consumed");
    if (!record) throw new Error("invalid or already-used email verification token");
    if (new Date(record.expiresAt).getTime() <= now.getTime()) throw new Error("email verification token expired");
    const user = this.getUser(record.userId); if (!user) throw new Error(`unknown user ${record.userId}`);
    user.emailVerified = true; user.updatedAt = now.toISOString(); record.status = "consumed"; record.consumedAt = now.toISOString(); this.record("user.email_verified", "system:email-verification", user.id, { verificationId: record.id }); this.persist(); return { ...user };
  }

  revokeAdmin(adminId: string, actorId: string): void { const admin = this.state.admins.find((item) => item.id === adminId); if (!admin) throw new Error(`unknown admin ${adminId}`); admin.active = false; this.record("admin.revoked", actorId, admin.userId, { adminId }); this.persist(); }
  setUserStatus(userId: string, status: UserStatus, actorId: string): void { const user = this.getUser(userId); if (!user) throw new Error(`unknown user ${userId}`); user.status = status; user.updatedAt = new Date().toISOString(); this.record(status === "suspended" ? "user.suspended" : "user.activated", actorId, userId); this.persist(); }

  private record(action: IdentityAuditEvent["action"], actorId: string, targetId: string, metadata?: Record<string, string>) { this.state.audit.push({ id: `ida_${this.state.audit.length + 1}`, action, actorId, targetId, recordedAt: new Date().toISOString(), metadata }); }
  private persist() { const temporary = `${this.storagePath}.${process.pid}.tmp`; writeFileSync(temporary, JSON.stringify(this.state, null, 2)); renameSync(temporary, this.storagePath); }
}

function hashVerificationToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }

export function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }

export function can(identity: { user: UserRecord; admin?: AdminRecord }, capability: IdentityCapability): boolean {
  return identity.user.status === "active" && identity.user.emailVerified && Boolean(identity.admin?.active && identity.admin.capabilities.includes(capability));
}

export function seedLeoIdentity(store: IdentityStore, actorId = "system:bootstrap"): { user: UserRecord; admin: AdminRecord } {
  const existing = store.getUserByEmail("leo@ideanexusventures.com");
  const user = existing ?? store.createUser({ id: "usr_leo_ideanexusventures", email: "leo@ideanexusventures.com", displayName: "Leo", actorId, status: "active", emailVerified: false });
  const admin = store.getAdminForUser(user.id) ?? store.grantAdmin({ id: "adm_leo_ideanexusventures", userId: user.id, grantedBy: actorId });
  return { user, admin };
}
