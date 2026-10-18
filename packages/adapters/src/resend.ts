export type ResendTransport = (url: string, init?: RequestInit) => Promise<Response>;

export interface ResendEmailInput { to: string; subject: string; text: string; from: string; idempotencyKey: string; }
export interface ResendEmailReceipt { state: "verified" | "accepted_unverified"; providerMessageId: string; status: number; readback?: unknown; readbackMatches: boolean; }

export class ResendEmailSender {
  private readonly transport: ResendTransport;
  private readonly endpoint: string;
  constructor(private readonly options: { apiKey: string; from: string; endpoint?: string; transport?: ResendTransport }) {
    if (!options.apiKey) throw new Error("Resend API key is required");
    if (!options.from) throw new Error("Resend from address is required");
    this.transport = options.transport ?? fetch;
    this.endpoint = (options.endpoint ?? "https://api.resend.com").replace(/\/$/, "");
  }

  async send(input: Omit<ResendEmailInput, "from">): Promise<ResendEmailReceipt> {
    const response = await this.transport(`${this.endpoint}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ from: this.options.from, to: [input.to], subject: input.subject, text: input.text })
    });
    if (!response.ok) throw new Error(`Resend send HTTP ${response.status}: ${await response.text()}`);
    const created = await response.json() as { id?: string };
    if (!created.id) throw new Error("Resend accepted email without an id");
    const readbackResponse = await this.transport(`${this.endpoint}/emails/${encodeURIComponent(created.id)}`, { method: "GET", headers: { Authorization: `Bearer ${this.options.apiKey}` } });
    if (!readbackResponse.ok) return { state: "accepted_unverified", providerMessageId: created.id, status: response.status, readbackMatches: false };
    const readback = await readbackResponse.json() as { id?: string; to?: string[]; subject?: string };
    const readbackMatches = readback.id === created.id && Array.isArray(readback.to) && readback.to.includes(input.to) && readback.subject === input.subject;
    return { state: readbackMatches ? "verified" : "accepted_unverified", providerMessageId: created.id, status: response.status, readback, readbackMatches };
  }
}

export function resendApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env, variable = "RESEND_API_KEY"): string {
  const value = env[variable];
  if (!value) throw new Error(`${variable} is not configured`);
  return value;
}
