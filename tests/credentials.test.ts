import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { CredentialBroker, EncryptedCredentialStore, ReauthNotificationLedger, type CredentialConnection } from "../packages/credentials/src/index.js";

const connection: CredentialConnection = { id: "linkedin-leo", provider: "linkedin", accountLabel: "Leo LinkedIn", scopes: ["openid", "profile", "w_member_social"], accessExpiresAt: "2026-10-18T12:00:00.000Z", refreshCapability: "refresh_capable", status: "active", updatedAt: "2026-10-18T00:00:00.000Z" };

test("encrypted credential store does not persist token plaintext and round-trips it", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-credentials-"));
  const path = join(directory, "credentials.json"); const store = new EncryptedCredentialStore(path, "local-development-master-key");
  const fixtureAccess = ["access", "fixture"].join("-"); const fixtureRefresh = ["refresh", "fixture"].join("-");
  store.put(connection, { accessToken: fixtureAccess, refreshToken: fixtureRefresh });
  const raw = await readFile(path, "utf8");
  assert.equal(raw.includes(fixtureAccess), false); assert.equal(store.getSecret(connection.id)?.accessToken, fixtureAccess);
});

test("credential broker refreshes once when token is inside the safety window", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-credentials-")); const store = new EncryptedCredentialStore(join(directory, "credentials.json"), "local-development-master-key");
  const oldAccess = ["old", "fixture"].join("-"); const refreshGrant = ["refresh", "grant"].join("-");
  store.put(connection, { accessToken: oldAccess, refreshToken: refreshGrant }); let calls = 0;
  const broker = new CredentialBroker(store, 15 * 60 * 1000);
  const refreshedAccess = ["new", "fixture"].join("-");
  const refresh = async () => { calls += 1; return { accessToken: refreshedAccess, accessExpiresAt: "2026-10-18T13:00:00.000Z" }; };
  const [one, two] = await Promise.all([broker.accessToken(connection.id, new Date("2026-10-18T11:50:00.000Z"), refresh), broker.accessToken(connection.id, new Date("2026-10-18T11:50:00.000Z"), refresh)]);
  assert.equal(one, refreshedAccess); assert.equal(two, refreshedAccess); assert.equal(calls, 1); assert.equal(store.getSecret(connection.id)?.accessToken, refreshedAccess);
});

test("missing refresh grant blocks publication and marks reauthorization required", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-credentials-")); const store = new EncryptedCredentialStore(join(directory, "credentials.json"), "local-development-master-key");
  store.put({ ...connection, refreshCapability: "unknown" }, { accessToken: ["expired", "fixture"].join("-") });
  await assert.rejects(() => new CredentialBroker(store).accessToken(connection.id, new Date("2026-10-18T11:50:00.000Z")), /reauthorization required/);
  assert.equal(store.getConnection(connection.id)?.status, "reauth_required");
});

test("reauthorization email is idempotent per connection and reminder window", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-credentials-")); const ledger = new ReauthNotificationLedger(join(directory, "emails.json")); let sends = 0;
  const sender = { send: async () => { sends += 1; return { providerMessageId: "msg-1" }; } };
  const first = await ledger.sendOnce(connection, "leo@example.test", "30d", "https://auth.example.test/reauth/one", sender);
  const second = await ledger.sendOnce(connection, "leo@example.test", "30d", "https://auth.example.test/reauth/one", sender);
  assert.equal(first.status, "sent"); assert.equal(second.providerMessageId, "msg-1"); assert.equal(sends, 1);
});
