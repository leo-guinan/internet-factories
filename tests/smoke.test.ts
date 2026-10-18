import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { runSmoke } from "../apps/smoke/src/index.js";

test("smoke run executes the real API seam and saves a draft receipt without publication", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-smoke-"));
  const receiptPath = join(directory, "receipt.json");
  const result = await runSmoke({
    receiptPath,
    apiKey: ["test", "key"].join("-"),
    endpoint: "https://model.test/v1",
    model: "test/model",
    transport: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      assert.equal(request.messages[0]?.role, "system");
      return new Response(JSON.stringify({
        model: "test/model",
        choices: [{ message: { content: JSON.stringify({
          hook: "AI work should leave evidence.",
          body: "Independent builders need AI work as durable measurable production: durable, measurable factories make AI work inspectable and repeatable. A durable job ledger preserves inputs and failures, artifact hashes preserve outputs, and the process records inputs, failures, costs, and artifacts before the context disappears.",
          cta: "Read the public notes.",
          targetAction: "Read the public notes",
          destinationUrl: "https://github.com/leo-guinan/internet-factories"
        }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(result.published, false);
  assert.equal(result.run.status, "completed");
  assert.equal(result.artifact.accepted, true);
  assert.equal(result.receiptPath, receiptPath);
});
