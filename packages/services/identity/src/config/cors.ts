/** Structural subset of Nest's `CorsOptions` that this service sets (avoids a deep internal import). */
export interface AppCorsOptions {
    origin: string[] | boolean;
    credentials: boolean;
    allowedHeaders: string[];
}

/**
 * CORS for the identity service (U11/F3). The service had no `enableCors()` at all, so cross-origin
 * web/mobile → service calls were blocked outright.
 *
 * The legitimate cross-origin callers are exactly the Clerk authorized parties (the web/mobile
 * origins also checked against the token `azp`), so reuse that allowlist rather than maintaining a
 * second one. The web client sends `credentials: 'include'`, so `credentials: true` is required —
 * which forbids a wildcard origin. On deployed stages we therefore pin the explicit party list; with
 * no parties configured (dev/local) we reflect the request origin (`true`). `sentry-trace`/`baggage`
 * are allowed so distributed-tracing headers survive the preflight (B1/B2).
 */
export const buildCorsOptions = (authorizedParties: string[]): AppCorsOptions => ({
    origin: authorizedParties.length > 0 ? authorizedParties : true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'sentry-trace', 'baggage'],
});
