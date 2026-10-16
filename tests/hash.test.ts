import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize, sha256Of } from "../packages/runtime/src/index.js";

test("canonical serialization makes object key order irrelevant", () => {
  assert.equal(canonicalize({ a: 1, b: 2 }), canonicalize({ b: 2, a: 1 }));
  assert.equal(sha256Of({ a: 1, b: 2 }), sha256Of({ b: 2, a: 1 }));
});
