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
  assert.equal(can({ user: seeded.user, admin: seeded.admin }, "factory.publish"), true);
  const persisted = await readFile(join(directory, "identity.json"), "utf8"); assert.match(persisted, /leo@ideanexusventures\.com/); assert.match(persisted, /admin\.granted/);
});

test("identity bootstrap is idempotent and does not create duplicate admin grants", () => {
  return mkdtemp(join(process.cwd(), ".tmp-identity-")).then((directory) => {
    const store = new IdentityStore(join(directory, "identity.json")); seedLeoIdentity(store); seedLeoIdentity(store);
    assert.equal(store.listUsers().length, 1); assert.equal(store.listAdmins().length, 1); assert.equal(store.listAudit().filter((event) => event.action === "admin.granted").length, 1);
  });
});

test("unverified or suspended users cannot exercise admin capabilities", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-identity-")); const store = new IdentityStore(join(directory, "identity.json")); const seeded = seedLeoIdentity(store);
  assert.equal(can({ user: seeded.user, admin: seeded.admin }, "identity.manage"), true);
  store.setUserStatus(seeded.user.id, "suspended", "system:test"); const suspended = store.getUser(seeded.user.id)!;
  assert.equal(can({ user: suspended, admin: seeded.admin }, "identity.manage"), false);
});

test("admin revocation is audited and removes effective authority", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-identity-")); const store = new IdentityStore(join(directory, "identity.json")); const seeded = seedLeoIdentity(store);
  store.revokeAdmin(seeded.admin.id, "system:test"); assert.equal(store.getAdminForUser(seeded.user.id), undefined); assert.equal(store.listAudit().at(-1)?.action, "admin.revoked");
});
