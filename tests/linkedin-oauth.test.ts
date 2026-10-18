import assert from "node:assert/strict";
import { test } from "node:test";
import { LinkedInOAuthClient } from "../packages/adapters/src/linkedin-oauth.js";

test("LinkedIn OAuth authorization request uses PKCE and required scopes", () => {
  const client = new LinkedInOAuthClient({ clientId: "client", clientSecret: "secret", redirectUri: "https://auth.example.test/linkedin" });
  const request = client.createAuthorizationRequest("state-1", "verifier-1"); const url = new URL(request.url);
  assert.equal(url.searchParams.get("state"), "state-1"); assert.equal(url.searchParams.get("code_challenge_method"), "S256"); assert.equal(url.searchParams.get("scope"), "openid profile w_member_social"); assert.equal(request.codeVerifier, "verifier-1");
});

test("LinkedIn OAuth exchange records when refresh is unavailable", async () => {
  const client = new LinkedInOAuthClient({ clientId: "client", clientSecret: "secret", redirectUri: "https://auth.example.test/linkedin", transport: async () => new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), { status: 200 }) });
  const token = await client.exchangeCode("code", "verifier"); assert.equal(token.refreshCapability, "refresh_unavailable"); assert.equal(token.refreshToken, undefined);
});
