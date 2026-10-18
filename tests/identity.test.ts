import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { can, IdentityStore, seedLeoIdentity } from "../packages/identity/src/index.js";

test("identity factory seeds Leo as an active user with a separate admin grant", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-identity-")); const store = new IdentityStore(join(directory, "identity.json"));
  const seeded = seedLeoIdentity(store);
  assert.equal(seeded.user.email, "leo@ideanexusventures.com"); assert.equal(seeded.user.status, "active"); assert.equal(seeded.user.emailVerified, false);
  assert.equal(seeded.admin.userId, seeded.user.id); assert.equal(seeded.admin.role, "admin"); assert.equal(seeded.admin.scope, "global");
  assert.equal(can({ user: seeded.user, admin: seeded.admin }, "factory.publish"), false);
  const persisted = await readFile(join(directory, "identity.json"), "utf8"); assert.match(persisted, /leo@ideanexusventures\.com/); assert.match(persisted, /admin\.granted/);
});

test("identity bootstrap is idempotent and does not create duplicate admin grants", () => {
  return mkdtemp(join(process.cwd(), ".tmp-identity-")).then((directory) => {
    const store = new IdentityStore(join(directory, "identity.json")); seedLeoIdentity(store); seedLeoIdentity(store);
    assert.equal(store.listUsers().length, 1); assert.equal(store.listAdmins().length, 1); assert.equal(store.listAudit().filter((event) => event.action === "admin.granted").length, 1);
  });
});

test("email verification is single-use, hashed at rest, and unlocks authority", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-identity-")); const store = new IdentityStore(join(directory, "identity.json")); const seeded = seedLeoIdentity(store); let body = "";
  const sender = { send: async (input: { text: string }) => { body = input.text; return { providerMessageId: "email-verification-1", state: "verified" as const }; } };
  const record = await store.createEmailVerification(seeded.user.id, "https://auth.example.test", sender, new Date("2026-10-18T12:00:00.000Z"));
  assert.equal(record.status, "sent"); assert.equal((await readFile(join(directory, "identity.json"), "utf8")).includes(body.split("token=")[1] ?? "never"), false);
  const token = decodeURIComponent(body.split("token=")[1]!); const verified = store.verifyEmail(token, new Date("2026-10-18T12:05:00.000Z"));
  assert.equal(verified.emailVerified, true); assert.equal(can({ user: verified, admin: seeded.admin }, "factory.publish"), true); assert.throws(() => store.verifyEmail(token, new Date("2026-10-18T12:06:00.000Z")), /invalid or already-used/);
});

test("unverified or suspended users cannot exercise admin capabilities", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-identity-")); const store = new IdentityStore(join(directory, "identity.json")); const seeded = seedLeoIdentity(store);
  assert.equal(can({ user: seeded.user, admin: seeded.admin }, "identity.manage"), false);
  store.setUserStatus(seeded.user.id, "suspended", "system:test"); const suspended = store.getUser(seeded.user.id)!;
  assert.equal(can({ user: suspended, admin: seeded.admin }, "identity.manage"), false);
});

test("admin revocation is audited and removes effective authority", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-identity-")); const store = new IdentityStore(join(directory, "identity.json")); const seeded = seedLeoIdentity(store);
  store.revokeAdmin(seeded.admin.id, "system:test"); assert.equal(store.getAdminForUser(seeded.user.id), undefined); assert.equal(store.listAudit().at(-1)?.action, "admin.revoked");
});
