# Identity Factory

The identity factory separates a person record from administrative authority.

Initial seed:

- user: `leo@ideanexusventures.com`
- user ID: `usr_leo_ideanexusventures`
- admin ID: `adm_leo_ideanexusventures`
- status: active
- email verification: false until an authenticated verification flow proves it
- admin scope: global

The seed operation is idempotent. It creates an audit event for user creation and admin assignment, but it does not send an authentication email or claim that the address has been verified.

Administrative authority is checked separately from identity:

```text
authenticated user
  -> active user record
  -> active admin grant
  -> named capability
  -> audited action
```

The Resend-backed email validation layer creates a single-use random token, stores only its SHA-256 hash, sends the raw token through the configured email sender, and marks `emailVerified` only after token redemption. Admin records exist at bootstrap, but `can()` requires both an active admin grant and a verified email.

The current local store is file-backed. It is a development boundary, not production authentication. Passwords, OAuth tokens, session cookies, signing keys, and verification secrets do not belong in this store. Production still needs authenticated sessions, recovery, signing, replay protection, and durable database transactions.
