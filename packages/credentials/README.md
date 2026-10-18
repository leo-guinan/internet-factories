# Credential plane

Factories do not read OAuth tokens directly. They request a short-lived access token from `EncryptedCredentialStore` through `CredentialBroker`.

Lifecycle:

```text
connection metadata + encrypted secret
  -> token validity check
  -> single-flight refresh when inside 15-minute safety window
  -> atomic secret/expiry update
  -> provider validation
  -> factory request continues
```

If a provider does not issue a refresh token, or refresh fails, the broker marks the connection `reauth_required` and fails closed. The scheduled publication remains queued rather than being marked as successfully posted.

`ReauthNotificationLedger` creates an idempotent notification per connection and reminder window. The email contains only an opaque one-time OAuth URL; it never contains a token. A production email adapter must record its provider message ID and independently read back the send before marking the notification sent.

The current local store is encrypted with AES-256-GCM using a master key supplied at runtime. The master key must not be stored in the repository or in the same file as the encrypted credential state. This file-backed store is a local development boundary; production should replace it with a managed encrypted secret store while preserving the same interfaces.

LinkedIn OAuth uses PKCE and requests `openid profile w_member_social`. The token response is inspected rather than assumed: `refresh_capable` is set only when a refresh token is actually returned.

Required runtime configuration for the LinkedIn OAuth flow:

- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- exact registered redirect URI
- external credential-store master key
- recipient for reauthorization notifications

No live OAuth callback or email was armed by this change.
