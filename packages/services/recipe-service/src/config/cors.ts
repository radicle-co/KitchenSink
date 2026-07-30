/** Structural subset of Nest's `CorsOptions` that this service sets (avoids a deep internal import). */
export interface AppCorsOptions {
    origin: string[] | boolean;
    credentials: boolean;
    allowedHeaders: string[];
}

/**
 * CORS for the recipe service. The web app calls this service from the browser on a DIFFERENT origin
 * (web on Vercel/its own host, recipe on the shared ALB), so cross-origin reads/writes need CORS — with
 * none, every browser call is blocked (the web e2e route-mocks the API, which hid this).
 *
 * Mirrors the identity service (`identity/src/config/cors.ts`) so the two do not drift: the legitimate
 * cross-origin callers are exactly the Clerk authorized parties (the same web origins checked against the
 * token `azp`), so reuse that allowlist rather than maintaining a second one. On deployed stages that pin
 * an exact party list (prod), CORS pins those origins; where no parties are configured — non-prod pattern
 * mode and local/dev — it reflects the request origin (`true`). The token (not the origin) is the security
 * boundary here: the Authorization bearer is unforgeable by a foreign site, so reflecting the origin does
 * not grant it access. `credentials: true` matches the web client; `sentry-trace`/`baggage` survive the
 * preflight so distributed tracing works.
 *
 * @param authorizedParties - The parsed `CLERK_AUTHORIZED_PARTIES` allowlist (empty in pattern/local mode).
 * @returns The CORS options for `app.enableCors`.
 */
export const buildCorsOptions = (authorizedParties: string[]): AppCorsOptions => ({
    origin: authorizedParties.length > 0 ? authorizedParties : true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'sentry-trace', 'baggage'],
});
