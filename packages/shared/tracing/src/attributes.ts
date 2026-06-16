/**
 * Span/attribute name constants shared across every runtime (web, mobile, identity service,
 * webhooks) so a "trace user X" query keys on the same attribute names everywhere. SDK-agnostic —
 * each runtime passes these into its own Sentry/OTel SDK.
 */
export const ATTR = {
    /** App-internal ULID. Present only once provisioning has succeeded — NOT a reliable join key on
     *  the failure path (use CLERK_SUB for cross-trace correlation). */
    APP_USER_ID: 'app.user.id',
    /** Clerk `sub`. The PRIMARY cross-trace correlation key — always present (even before a DB row
     *  exists), so a failed/unprovisioned flow is still reconstructable. */
    CLERK_SUB: 'clerk.sub',
    /** Auth/provisioning outcome: `created` | `resolved` | `failed`. */
    AUTH_OUTCOME: 'auth.outcome',
    /** Coarse step within the signup/auth flow (e.g. verify, provision, persist). */
    SIGNUP_STEP: 'app.signup.step',
    /** svix message id on the webhook span — the per-event idempotency key. */
    SVIX_MESSAGE_ID: 'messaging.message.id',
} as const;

/** Canonical span names for the signup/auth flow (B4). */
export const SPAN = {
    AUTH_VERIFY: 'auth.verify',
    AUTH_PROVISION: 'auth.provision',
    WEBHOOK_RECEIVE: 'webhook.user',
    RECONCILE_RUN: 'reconcile.run',
    DELETION_PROCESS: 'deletion.process',
} as const;

/**
 * PII keys that must be scrubbed from span attributes / events / logs in every runtime. The scrubber
 * *logic* stays per-runtime (each wires its own `beforeSend`/`beforeSendSpan`); this is the shared
 * key list only.
 *
 * `clerk.sub` and `app.user.id` are deliberately ABSENT — they are the opaque correlation identifiers
 * the whole "trace user X" capability depends on, consistent with `Sentry.setUser({ id })`.
 */
export const PII_DENYLIST_KEYS = [
    'email',
    'email_address',
    'name',
    'first_name',
    'last_name',
    'picture',
    'image_url',
    'avatar_url',
    'password',
    'token',
    'authorization',
    'secret',
] as const;
