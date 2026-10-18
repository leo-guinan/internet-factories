import { createHash, randomBytes } from "node:crypto";
import type { RefreshedToken } from "../../credentials/src/index.js";

export interface LinkedInOAuthOptions { clientId: string; clientSecret: string; redirectUri: string; transport?: (url: string, init?: RequestInit) => Promise<Response>; }
export interface LinkedInTokenResponse { access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number; }

export class LinkedInOAuthClient {
  private readonly transport: NonNullable<LinkedInOAuthOptions["transport"]>;
  constructor(private readonly options: LinkedInOAuthOptions) { if (!options.clientId || !options.clientSecret || !options.redirectUri) throw new Error("LinkedIn OAuth configuration is incomplete"); this.transport = options.transport ?? fetch; }
  createAuthorizationRequest(state: string, codeVerifier = randomBytes(32).toString("base64url")) {
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.search = new URLSearchParams({ response_type: "code", client_id: this.options.clientId, redirect_uri: this.options.redirectUri, state, scope: "openid profile w_member_social", code_challenge: challenge, code_challenge_method: "S256" }).toString();
    return { url: url.toString(), codeVerifier };
  }
  async exchangeCode(code: string, codeVerifier: string): Promise<RefreshedToken & { refreshCapability: "refresh_capable" | "refresh_unavailable" }> {
    const response = await this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: this.options.redirectUri, code_verifier: codeVerifier });
    return this.normalize(response);
  }
  async refresh(secret: { refreshToken: string }): Promise<RefreshedToken> { if (!secret.refreshToken) throw new Error("LinkedIn refresh token is missing"); return this.normalize(await this.tokenRequest({ grant_type: "refresh_token", refresh_token: secret.refreshToken })); }
  async userInfo(accessToken: string): Promise<{ sub: string; name?: string }> {
    const response = await this.transport("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`LinkedIn userinfo HTTP ${response.status}`); return await response.json() as { sub: string; name?: string };
  }
  private async tokenRequest(parameters: Record<string, string>): Promise<LinkedInTokenResponse> {
    const response = await this.transport("https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...parameters, client_id: this.options.clientId, client_secret: this.options.clientSecret }).toString() });
    if (!response.ok) throw new Error(`LinkedIn OAuth HTTP ${response.status}`); return await response.json() as LinkedInTokenResponse;
  }
  private normalize(token: LinkedInTokenResponse): RefreshedToken & { refreshCapability: "refresh_capable" | "refresh_unavailable" } { return { accessToken: token.access_token, refreshToken: token.refresh_token, accessExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(), refreshExpiresAt: token.refresh_token_expires_in ? new Date(Date.now() + token.refresh_token_expires_in * 1000).toISOString() : undefined, refreshCapability: token.refresh_token ? "refresh_capable" : "refresh_unavailable" }; }
}
