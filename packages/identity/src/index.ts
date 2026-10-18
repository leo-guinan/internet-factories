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

export interface IdentityAuditEvent {
  id: string;
  action: "user.created" | "admin.granted" | "admin.revoked" | "user.suspended" | "user.activated";
  actorId: string;
  targetId: string;
  recordedAt: string;
  metadata?: Record<string, string>;
}

interface IdentityState { users: UserRecord[]; admins: AdminRecord[]; audit: IdentityAuditEvent[]; }

export class IdentityStore {
  private state: IdentityState;
  constructor(private readonly storagePath: string) {
    mkdirSync(dirname(storagePath), { recursive: true });
    this.state = existsSync(storagePath) ? JSON.parse(readFileSync(storagePath, "utf8")) as IdentityState : { users: [], admins: [], audit: [] };
  }
  getUser(id: string): UserRecord | undefined { return this.state.users.find((user) => user.id === id); }
  getUserByEmail(email: string): UserRecord | undefined { return this.state.users.find((user) => user.normalizedEmail === normalizeEmail(email)); }
  getAdminForUser(userId: string): AdminRecord | undefined { return this.state.admins.find((admin) => admin.userId === userId && admin.active); }
  listUsers(): UserRecord[] { return this.state.users.map((user) => ({ ...user })); }
  listAdmins(): AdminRecord[] { return this.state.admins.filter((admin) => admin.active).map((admin) => ({ ...admin, capabilities: [...admin.capabilities] })); }
  listAudit(): IdentityAuditEvent[] { return this.state.audit.map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined })); }

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

  revokeAdmin(adminId: string, actorId: string): void { const admin = this.state.admins.find((item) => item.id === adminId); if (!admin) throw new Error(`unknown admin ${adminId}`); admin.active = false; this.record("admin.revoked", actorId, admin.userId, { adminId }); this.persist(); }
  setUserStatus(userId: string, status: UserStatus, actorId: string): void { const user = this.getUser(userId); if (!user) throw new Error(`unknown user ${userId}`); user.status = status; user.updatedAt = new Date().toISOString(); this.record(status === "suspended" ? "user.suspended" : "user.activated", actorId, userId); this.persist(); }

  private record(action: IdentityAuditEvent["action"], actorId: string, targetId: string, metadata?: Record<string, string>) { this.state.audit.push({ id: `ida_${this.state.audit.length + 1}`, action, actorId, targetId, recordedAt: new Date().toISOString(), metadata }); }
  private persist() { const temporary = `${this.storagePath}.${process.pid}.tmp`; writeFileSync(temporary, JSON.stringify(this.state, null, 2)); renameSync(temporary, this.storagePath); }
}

export function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }

export function can(identity: { user: UserRecord; admin?: AdminRecord }, capability: IdentityCapability): boolean {
  return identity.user.status === "active" && Boolean(identity.admin?.active && identity.admin.capabilities.includes(capability));
}

export function seedLeoIdentity(store: IdentityStore, actorId = "system:bootstrap"): { user: UserRecord; admin: AdminRecord } {
  const existing = store.getUserByEmail("leo@ideanexusventures.com");
  const user = existing ?? store.createUser({ id: "usr_leo_ideanexusventures", email: "leo@ideanexusventures.com", displayName: "Leo", actorId, status: "active", emailVerified: false });
  const admin = store.getAdminForUser(user.id) ?? store.grantAdmin({ id: "adm_leo_ideanexusventures", userId: user.id, grantedBy: actorId });
  return { user, admin };
}
