# LinkedIn scheduled publisher

This is a guarded publication lane for accepted `linkedin-draft@1` artifacts. It is separate from draft generation and publishes only records explicitly placed in the `approved` queue state.

Flow:

```text
accepted draft artifact
  -> exact post body frozen
  -> scheduled queue record (approved)
  -> due tick
  -> LinkedIn POST /rest/posts
  -> x-restli-id captured
  -> LinkedIn readback
  -> posted or posted_unverified receipt
```

The adapter never logs credentials. Runtime configuration must provide:

- `LINKEDIN_ACCESS_TOKEN` — a valid access token with `w_member_social`
- `LINKEDIN_AUTHOR_URN` — for example `urn:li:person:...`
- `LINKEDIN_VERSION` — optional, defaults to `202503`

`LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` in `~/.hermes/.env` are OAuth application credentials, not a publish token. They can start an OAuth consent flow but cannot publish by themselves. The current repository setup therefore remains fail-closed until a valid access token and author URN are obtained and loaded at runtime.

The queue requires a `PublicationApproval` bound to the exact artifact hash, approved body hash, approver, account connection, and scheduled time. The artifact resolver reads the accepted artifact envelope and content from the factory server and recomputes the publication body binding before scheduling.

Execution persists `dispatching` before contacting LinkedIn. A restart converts any `dispatching` record to `reconciliation_required`; it is never blindly republished. Credential failures become `reauth_required`. At execution, the caller must provide an authorization check; a revoked, suspended, or unverified approver moves the post to `authorization_required` without contacting LinkedIn.

Verification:

```sh
pnpm validate
pnpm build
```
