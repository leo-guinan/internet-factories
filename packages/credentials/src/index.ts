import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type RefreshCapability = "unknown" | "refresh_capable" | "refresh_unavailable";
export type ConnectionStatus = "active" | "reauth_required" | "disabled";

export interface CredentialConnection {
  id: string;
  provider: string;
  accountLabel: string;
  accountSubject?: string;
  authorUrn?: string;
  scopes: string[];
  accessExpiresAt: string;
  refreshExpiresAt?: string;
  refreshCapability: RefreshCapability;
  status: ConnectionStatus;
  updatedAt: string;
}

export interface OAuthSecret {
  accessToken: string;
  refreshToken?: string;
}

interface EncryptedSecret { iv: string; tag: string; ciphertext: string; }
interface PersistedState { connections: CredentialConnection[]; secrets: Record<string, EncryptedSecret>; }

export class ReauthorizationRequiredError extends Error {
  constructor(public readonly connectionId: string, message = "provider reauthorization required") { super(message); this.name = "ReauthorizationRequiredError"; }
}

export class EncryptedCredentialStore {
  private state: PersistedState;
  private readonly key: Buffer;

  constructor(private readonly path: string, masterKey: string) {
    if (!masterKey || masterKey.length < 16) throw new Error("credential store master key must be at least 16 characters");
    this.key = scryptSync(masterKey, "internet-factories-credential-store-v1", 32);
    mkdirSync(dirname(path), { recursive: true });
    this.state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as PersistedState : { connections: [], secrets: {} };
  }

  getConnection(id: string): CredentialConnection | undefined { return this.state.connections.find((connection) => connection.id === id); }
  getSecret(id: string): OAuthSecret | undefined { const encrypted = this.state.secrets[id]; return encrypted ? this.decrypt(encrypted) : undefined; }

  put(connection: CredentialConnection, secret: OAuthSecret): void {
    this.state.connections = [...this.state.connections.filter((item) => item.id !== connection.id), connection];
    this.state.secrets[connection.id] = this.encrypt(secret);
    this.persist();
  }

  updateConnection(id: string, update: Partial<CredentialConnection>): CredentialConnection {
    const current = this.getConnection(id);
    if (!current) throw new Error(`unknown credential connection ${id}`);
    const next = { ...current, ...update, updatedAt: new Date().toISOString() };
    this.state.connections = this.state.connections.map((item) => item.id === id ? next : item);
    this.persist();
    return next;
  }

  updateSecret(id: string, secret: OAuthSecret): void { if (!this.getConnection(id)) throw new Error(`unknown credential connection ${id}`); this.state.secrets[id] = this.encrypt(secret); this.persist(); }

  private encrypt(secret: OAuthSecret): EncryptedSecret {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secret), "utf8"), cipher.final()]);
    return { iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
  }
  private decrypt(encrypted: EncryptedSecret): OAuthSecret {
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(encrypted.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64url")), decipher.final()]).toString("utf8")) as OAuthSecret;
  }
  private persist(): void { const temporary = `${this.path}.${process.pid}.tmp`; writeFileSync(temporary, JSON.stringify(this.state, null, 2)); renameSync(temporary, this.path); }
}

export interface RefreshedToken { accessToken: string; refreshToken?: string; accessExpiresAt: string; refreshExpiresAt?: string; }

export class CredentialBroker {
  private readonly inFlight = new Map<string, Promise<string>>();
  constructor(private readonly store: EncryptedCredentialStore, private readonly refreshSkewMs = 15 * 60 * 1000) {}

  async accessToken(id: string, now = new Date(), refresh?: (secret: OAuthSecret) => Promise<RefreshedToken>): Promise<string> {
    const existing = this.inFlight.get(id); if (existing) return existing;
    const operation = this.resolve(id, now, refresh).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, operation); return operation;
  }

  private async resolve(id: string, now: Date, refresh?: (secret: OAuthSecret) => Promise<RefreshedToken>): Promise<string> {
    const connection = this.store.getConnection(id); const secret = this.store.getSecret(id);
    if (!connection || !secret) throw new ReauthorizationRequiredError(id, "credential connection is not configured");
    if (connection.status !== "active") throw new ReauthorizationRequiredError(id, `connection status is ${connection.status}`);
    if (new Date(connection.accessExpiresAt).getTime() - now.getTime() > this.refreshSkewMs) return secret.accessToken;
    if (!secret.refreshToken || connection.refreshCapability === "refresh_unavailable" || !refresh) {
      this.store.updateConnection(id, { status: "reauth_required", refreshCapability: secret.refreshToken ? connection.refreshCapability : "refresh_unavailable" });
      throw new ReauthorizationRequiredError(id, "reauthorization required: access token is expiring and no usable refresh grant exists");
    }
    try {
      const refreshed = await refresh(secret);
      this.store.updateSecret(id, { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken ?? secret.refreshToken });
      this.store.updateConnection(id, { accessExpiresAt: refreshed.accessExpiresAt, refreshExpiresAt: refreshed.refreshExpiresAt ?? connection.refreshExpiresAt, refreshCapability: "refresh_capable", status: "active" });
      return refreshed.accessToken;
    } catch (error) {
      this.store.updateConnection(id, { status: "reauth_required" });
      throw new ReauthorizationRequiredError(id, `refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export interface ReauthEmail { id: string; connectionId: string; recipient: string; reason: "access_expiring" | "reauth_required"; reminderWindow: string; createdAt: string; status: "pending" | "sent" | "sent_unverified" | "failed"; providerMessageId?: string; }
export interface EmailSender { send(input: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<{ providerMessageId: string; state?: "verified" | "accepted_unverified" }>; }

export class ReauthNotificationLedger {
  private readonly entries: ReauthEmail[];
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.entries = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as ReauthEmail[] : [];
  }
  list(): ReauthEmail[] { return this.entries.map((entry) => ({ ...entry })); }
  async sendOnce(connection: CredentialConnection, recipient: string, window: string, authUrl: string, sender: EmailSender, reason: ReauthEmail["reason"] = "access_expiring"): Promise<ReauthEmail> {
    const existing = this.entries.find((entry) => entry.connectionId === connection.id && entry.reminderWindow === window && entry.status === "sent");
    if (existing) return { ...existing };
    const id = `reauth_${connection.id}_${window}`; const entry: ReauthEmail = { id, connectionId: connection.id, recipient, reason, reminderWindow: window, createdAt: new Date().toISOString(), status: "pending" };
    this.entries.push(entry); this.persist();
    try { const result = await sender.send({ to: recipient, subject: `Reconnect ${connection.accountLabel} before scheduled publishing stops`, text: `Reauthorization is required for ${connection.accountLabel}. Open this one-time link: ${authUrl}`, idempotencyKey: id }); entry.status = result.state === "accepted_unverified" ? "sent_unverified" : "sent"; entry.providerMessageId = result.providerMessageId; }
    catch (error) { entry.status = "failed"; }
    this.persist(); return { ...entry };
  }
  private persist() { const temporary = `${this.path}.${process.pid}.tmp`; writeFileSync(temporary, JSON.stringify(this.entries, null, 2)); renameSync(temporary, this.path); }
}
