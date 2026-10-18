# Email Delivery Factory

The email delivery factory is a guarded provider adapter for transactional notifications such as OAuth reauthorization requests. It uses Resend only through an injected API key and never logs or stores that key.

Flow:

```text
notification due
  -> stable idempotency key
  -> Resend POST /emails
  -> provider message ID
  -> Resend GET /emails/:id
  -> verified / accepted_unverified / failed receipt
```

Configuration is explicit. The adapter does not guess which project-scoped key in `~/.hermes/.env` should be used. Supply the selected environment variable name at process startup, for example:

```sh
RESEND_KEY_ENV=BIPU_RESEND_API_KEY
```

The currently discovered environment contains several Resend keys (`BIPU_RESEND_API_KEY`, `COURSE_RESEND_API_KEY`, and `GUIDE_RESEND_API_KEY`). The correct key must match the verified sending domain and `from` address. Do not silently select one.

Required runtime values:

- selected Resend API key environment variable
- verified `from` address/domain
- exact recipient
- notification category and content projection

A provider-accepted email with failed readback is recorded as `sent_unverified`, not delivered. The factory does not send a live email merely because the key exists; an explicit runtime invocation and approved recipient are still required.
