import type { ExecutionContext, FunctionResult } from "../../runtime/src/index.js";

export type HttpTransport = (url: string, init: RequestInit) => Promise<Response>;

export async function executeHttp(url: string, input: unknown, context: ExecutionContext, transport: HttpTransport = fetch): Promise<FunctionResult> {
  const response = await transport(url, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": context.idempotencyKey },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { output: await response.json(), metadata: { idempotencyKey: context.idempotencyKey } };
}
