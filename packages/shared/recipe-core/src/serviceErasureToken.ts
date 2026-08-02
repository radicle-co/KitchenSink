/**
 * The **service-principal account-erasure token** contract (CR-002 / U4a).
 *
 * This is a cross-package WIRE CONTRACT with a producer and a consumer in different packages — exactly
 * the reason {@link AccountErasureMessage} lives here too, and exactly the shape that WILL drift if each
 * side declares its own copy:
 *
 *  - **Producer (signer) — the identity deletion-worker Lambda (`@kitchensink/identity-webhooks`, U4b).**
 *    On a verified `user.deleted`/close event it mints a short-lived, single-target JWT and calls
 *    recipe-service's internal erasure route. It holds the PRIVATE signing key. See
 *    {@link buildServiceErasureJwtClaims} for the exact custom claims it must set (and the JSDoc there for
 *    the registered claims + algorithm it must set via `jose`).
 *  - **Consumer (verifier) — `@kitchensink/recipe-service` (U4a).** Verifies the token NETWORKLESSLY with
 *    a dedicated PUBLIC key (`RECIPE_SERVICE_PRINCIPAL_JWT_KEY`), pinning this contract's issuer, audience,
 *    and algorithm, and reads the bound target `ownerId` from the token — never from the request body.
 *
 * **Why an internal asymmetric JWT and NOT a Clerk M2M token (design decision).** recipe-service today
 * verifies Clerk *user* session tokens networklessly; food's `svc_*` is a worker-side provenance string,
 * not inbound auth; no Clerk M2M issuer is wired. A Clerk M2M token identifies a *machine client* with
 * static scopes — it is an **ambient** capability ("this client may erase") with no way to bind ONE call
 * to ONE target account + ONE event without layering our own claims on top anyway, and admitting it would
 * both widen the recipe-service `azp`/Clerk surface and make a Clerk-secret leak an erase-any-account
 * capability. An internal **asymmetric** JWT instead: the signer holds the private key, the public-ALB
 * service holds only the PUBLIC key (a compromise of that service cannot forge a token), verification is
 * networkless exactly like the Clerk public-key path, and the claims **bind the capability to a single
 * event**: one target `ownerId` ({@link ServiceErasureTokenClaims.ownerId}), one correlation/event id
 * ({@link ServiceErasureTokenClaims.eventId}), a short `exp`, and a fixed issuer + audience. A leaked
 * token can therefore erase only its one bound account within its (seconds-long) window — never an
 * arbitrary account at will.
 */
import { z } from 'zod';

/**
 * The JWT `iss` (issuer) every service-erasure token MUST carry — the identity deletion-worker. The
 * verifier pins this exact value, so a token from any other issuer is rejected.
 */
export const SERVICE_ERASURE_TOKEN_ISSUER = 'urn:commise:identity:deletion-worker';

/**
 * The JWT `aud` (audience) a service-erasure token minted for **recipe-service** MUST carry — recipe's
 * account-erasure capability. The recipe verifier pins this exact value, so a token minted for any other
 * audience (e.g. the food endpoint below, or an identity endpoint) cannot be replayed against recipe erasure.
 */
export const SERVICE_ERASURE_TOKEN_AUDIENCE = 'urn:commise:recipe-service:account-erasure';

/**
 * The JWT `aud` (audience) a service-erasure token minted for **food-service** MUST carry — food's
 * account-erasure capability (CR-002 / U4b / R11). The food verifier pins this exact value.
 *
 * **Why a SEPARATE audience, not a reuse of {@link SERVICE_ERASURE_TOKEN_AUDIENCE}.** The erasure fan-out
 * signs BOTH legs with the same private key and the same {@link SERVICE_ERASURE_TOKEN_ISSUER}, so the
 * audience is the ONLY claim binding a minted token to exactly one target service. Reusing recipe's
 * audience would make a token captured on the recipe leg replayable against food (and vice versa); pinning
 * a distinct audience per service keeps each token single-target. The signer sets it via `SignJWT`'s
 * `.setAudience()`; the food verifier passes it to `jwtVerify({ audience })`.
 */
export const SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD = 'urn:commise:food-service:account-erasure';

/**
 * The ONE JWS algorithm a service-erasure token may use. Asymmetric (EdDSA/Ed25519): the signer holds the
 * private key, the verifier only the public key. The verifier pins this in `jwtVerify({ algorithms })`, so
 * an `alg: none` token or an algorithm-confusion swap (e.g. an `HS256` token signed with the public PEM as
 * an HMAC secret) is rejected outright.
 */
export const SERVICE_ERASURE_TOKEN_ALG = 'EdDSA';

/**
 * The maximum lifetime (`exp - iat`, seconds) the verifier accepts. A defense-in-depth cap ON TOP OF the
 * `exp` check: even if the signer mis-mints a far-future `exp`, the verifier rejects a token whose window
 * exceeds this, bounding a leaked token's usefulness to a couple of minutes. The signer SHOULD mint tokens
 * with an `exp` well inside this (single-request, single-target — seconds, not minutes).
 */
export const SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS = 120;

/** The two legitimate triggers of an account erasure job — the `account_erasure_jobs.trigger_source` audit value (R8). */
export const ERASURE_TRIGGER_SOURCES = ['user', 'service'] as const;

/**
 * Who/what triggered an erasure job (R8 audit). `user` — the account owner via the confirmation-gated
 * `POST /api/v1/account/erasure`; `service` — the deletion-worker's verified service principal via the
 * internal route (a `user.deleted`/close event), which skips the phrase because the signed token IS the
 * authorization.
 */
export type ErasureTriggerSource = (typeof ERASURE_TRIGGER_SOURCES)[number];

/**
 * The decoded, application-facing shape of a verified service-erasure token — the "service principal".
 * Everything here is read from the SIGNED token, never from the request body/query.
 */
export interface ServiceErasureTokenClaims {
    /** The bound target: the app-user ULID whose recipe data this ONE token authorizes erasing (JWT `sub`). */
    readonly ownerId: string;
    /** The correlation/event id this token is bound to (the `user.deleted`/close event) — single-event binding (JWT `evt`). */
    readonly eventId: string;
    /** The machine actor that minted the token, recorded as `account_erasure_jobs.actor` (R8) (JWT `act`). */
    readonly actor: string;
}

/**
 * The custom (non-registered) JWT claim payload of a service-erasure token. `sub` is a registered claim
 * but is included here because it carries the load-bearing bound target, so producer and consumer agree on
 * it in one place. Registered claims `iss`/`aud`/`exp`/`iat` are set by the signer through `jose`'s
 * `SignJWT` fluent API and are NOT part of this object.
 */
export interface ServiceErasureJwtClaims {
    /** JWT `sub` — the bound target owner ULID. */
    readonly sub: string;
    /** JWT `evt` — the correlation/event id (single-event binding). */
    readonly evt: string;
    /** JWT `act` — the machine actor label. */
    readonly act: string;
}

/** Runtime schema for the custom claims of a verified token. Every field is a required non-empty string. */
const serviceErasureJwtClaimsSchema = z.object({
    sub: z.string().min(1),
    evt: z.string().min(1),
    act: z.string().min(1),
});

/**
 * Build the custom JWT claim payload for a service-erasure token — the SINGLE authoritative mapping from
 * the app-facing fields to the wire claim names, imported by the signer (U4b) so it cannot drift from what
 * the verifier reads.
 *
 * The signer MUST additionally set, via `jose`'s `SignJWT`: the protected header `alg`
 * ({@link SERVICE_ERASURE_TOKEN_ALG}), `iss` ({@link SERVICE_ERASURE_TOKEN_ISSUER}), `aud`
 * ({@link SERVICE_ERASURE_TOKEN_AUDIENCE}), `iat`, and a short `exp` (≤ {@link
 * SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS} after `iat`).
 *
 * @param claims - The bound target owner, the event id, and the machine actor label.
 * @returns The custom claim payload (`{ sub, evt, act }`). Pure.
 */
export function buildServiceErasureJwtClaims(claims: ServiceErasureTokenClaims): ServiceErasureJwtClaims {
    return { sub: claims.ownerId, evt: claims.eventId, act: claims.actor };
}

/**
 * Parse + validate the custom claims of an already-cryptographically-verified token into the app-facing
 * {@link ServiceErasureTokenClaims}. Signature/issuer/audience/expiry are the verifier's job (via `jose`);
 * this only asserts the custom claims are structurally present, so a token that verified cryptographically
 * but omitted (or emptied) `sub`/`evt`/`act` is rejected rather than yielding an empty owner key.
 *
 * @param payload - The verified JWT payload (registered + custom claims).
 * @returns The decoded claims.
 * @throws {z.ZodError} When `sub`, `evt`, or `act` is missing or empty. Pure otherwise.
 */
export function parseServiceErasureClaims(payload: Record<string, unknown>): ServiceErasureTokenClaims {
    const parsed = serviceErasureJwtClaimsSchema.parse(payload);

    return { ownerId: parsed.sub, eventId: parsed.evt, actor: parsed.act };
}

/**
 * Type guard: whether `value` is a valid {@link ErasureTriggerSource}. Used at the DB→domain boundary so a
 * persisted `trigger_source` is narrowed to the union rather than trusted as a bare string.
 *
 * @param value - The value to check.
 * @returns True when `value` is `'user'` or `'service'`.
 */
export function isErasureTriggerSource(value: unknown): value is ErasureTriggerSource {
    return typeof value === 'string' && (ERASURE_TRIGGER_SOURCES as readonly string[]).includes(value);
}
