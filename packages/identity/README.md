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

The current local store is file-backed. It is a development boundary, not production authentication. Passwords, OAuth tokens, session cookies, signing keys, and verification secrets do not belong in this store. Production still needs authenticated sessions, email verification, recovery, signing, replay protection, and durable database transactions.
