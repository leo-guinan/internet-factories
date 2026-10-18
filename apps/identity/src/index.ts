import { IdentityStore, seedLeoIdentity } from "../../../packages/identity/src/index.js";

export function bootstrapIdentity(storagePath = "data/identity.json") {
  const store = new IdentityStore(storagePath);
  return seedLeoIdentity(store);
}
