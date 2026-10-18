import assert from "node:assert/strict";
import { test } from "node:test";
import { ResendEmailSender, resendApiKeyFromEnv } from "../packages/adapters/src/resend.js";

test("Resend sender captures provider id and verifies email readback", async () => {
  const calls: string[] = [];
  const sender = new ResendEmailSender({ apiKey: ["fixture", "key"].join("-"), from: "noreply@example.test", endpoint: "https://resend.test", transport: async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (init?.method === "POST") return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    return new Response(JSON.stringify({ id: "email_123", to: ["leo@example.test"], subject: "Reconnect" }), { status: 200 });
  } });
  const receipt = await sender.send({ to: "leo@example.test", subject: "Reconnect", text: "Open link", idempotencyKey: "reauth_1" });
  assert.equal(receipt.state, "verified"); assert.equal(receipt.providerMessageId, "email_123"); assert.deepEqual(calls.map((call) => call.split(" ")[0]), ["POST", "GET"]);
});

test("Resend configuration fails closed when the selected environment variable is absent", () => {
  assert.throws(() => resendApiKeyFromEnv({}, "PROJECT_RESEND_API_KEY"), /PROJECT_RESEND_API_KEY is not configured/);
  assert.equal(resendApiKeyFromEnv({ PROJECT_RESEND_API_KEY: "configured" }, "PROJECT_RESEND_API_KEY"), "configured");
});
