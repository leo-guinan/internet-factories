export type LinkedInTransport = (url: string, init?: RequestInit) => Promise<Response>;

export interface LinkedInPostPublisherOptions {
  accessToken?: string;
  tokenProvider?: () => Promise<string>;
  authorUrn: string;
  apiVersion?: string;
  endpoint?: string;
  transport?: LinkedInTransport;
}

export interface LinkedInPostReceipt {
  state: "verified" | "posted_unverified";
  postUrn: string;
  status: number;
  readback?: unknown;
  readbackMatches: boolean;
}

function headers(accessToken: string, apiVersion: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "LinkedIn-Version": apiVersion,
    "X-Restli-Protocol-Version": "2.0.0"
  };
}

export class LinkedInPostPublisher {
  private readonly transport: LinkedInTransport;
  private readonly endpoint: string;
  private readonly apiVersion: string;

  constructor(private readonly options: LinkedInPostPublisherOptions) {
    if (!options.accessToken && !options.tokenProvider) throw new Error("LinkedIn access token or token provider is required");
    if (!options.authorUrn.startsWith("urn:li:")) throw new Error("LinkedIn author URN is invalid");
    this.transport = options.transport ?? fetch;
    this.endpoint = (options.endpoint ?? "https://api.linkedin.com").replace(/\/$/, "");
    this.apiVersion = options.apiVersion ?? "202503";
  }

  async publishText(commentary: string): Promise<LinkedInPostReceipt> {
    if (!commentary.trim()) throw new Error("LinkedIn post cannot be empty");
    const accessToken = this.options.tokenProvider ? await this.options.tokenProvider() : this.options.accessToken;
    if (!accessToken) throw new Error("LinkedIn access token provider returned no token");
    const response = await this.transport(`${this.endpoint}/rest/posts`, {
      method: "POST",
      headers: headers(accessToken, this.apiVersion),
      body: JSON.stringify({
        author: this.options.authorUrn,
        commentary,
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false
      })
    });
    if (!response.ok) throw new Error(`LinkedIn publish HTTP ${response.status}: ${await response.text()}`);
    const postUrn = response.headers.get("x-restli-id");
    if (!postUrn) throw new Error("LinkedIn publish succeeded without x-restli-id");
    const readbackResponse = await this.transport(`${this.endpoint}/rest/posts/${encodeURIComponent(postUrn)}`, {
      method: "GET",
      headers: headers(accessToken, this.apiVersion)
    });
    if (!readbackResponse.ok) return { state: "posted_unverified", postUrn, status: response.status, readbackMatches: false };
    const readback = await readbackResponse.json() as { author?: string; commentary?: string };
    const readbackMatches = readback.author === this.options.authorUrn && readback.commentary === commentary;
    return { state: readbackMatches ? "verified" : "posted_unverified", postUrn, status: response.status, readback, readbackMatches };
  }
}
