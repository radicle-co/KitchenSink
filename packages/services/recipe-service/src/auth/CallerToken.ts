/**
 * `CallerToken` — the caller's own Clerk bearer, modelled as an opaque **Value Object** so it can be
 * forwarded to the food service on the caller's behalf without ever becoming a loggable string (issue #120).
 *
 * ## Why this type exists (the seam it replaces)
 *
 * The ingredients vertical reads nutrition and catalog suggestions from the food service (003), whose
 * `FoodAuthGuard` verifies a **Clerk** token. It was wired to a static `FOOD_SERVICE_TOKEN` env string —
 * which cannot ever work: Clerk session tokens live ~60s, so no long-lived env value satisfies that
 * verifier, and the variable was in fact never set anywhere. The owner's decision is to forward the
 * CALLER's already-verified token: the end user is authenticated to recipe, and recipe calls food *as them*.
 *
 * That makes the credential a **per-request** value, which is exactly the kind of thing that leaks. So it is
 * not passed around as a `string`:
 *
 *  1. **The raw bytes are held OFF the object**, in a module-private `WeakMap`. A `CallerToken` therefore has
 *     no own property, no inherited property, and nothing to enumerate — `{...caller}`, `Object.assign`,
 *     `structuredClone` and a stray spread into a response body all come up empty. Not "redacted": absent.
 *  2. **Every stringification is redacted** — `toString`, `toJSON` and Node's `inspect.custom` all yield
 *     {@link REDACTED}. So a template-literal log line, a `JSON.stringify`d error/response, and a debugger
 *     or crash dump each print `[REDACTED]` rather than a live session token.
 *  3. **There is exactly ONE accessor** ({@link revealCallerToken}), and the package's ESLint config
 *     restricts importing it to the single food-service client factory that must hand the bytes to
 *     `Authorization`. Every other module can hold, pass and store a `CallerToken` but cannot read it.
 *
 * ## Why forwarding transfers no trust
 *
 * Recipe asserts NOTHING to food about this token: it forwards the opaque bearer, and food's own
 * `FoodAuthGuard` verifies signature, expiry and `azp` independently, with the same public Clerk key and the
 * same `azp` posture (both services read the SAME SSM parameters). So the token grants exactly the authority
 * Clerk minted it with — no more. A caller holding a token recipe accepts could call food directly with it
 * anyway, which is what makes this forwarding a pass-through rather than a privilege amplification. It also
 * means the non-production dev-auth bypass (where recipe itself skips verification) cannot smuggle anything
 * past food: an unverified header simply 401s there.
 *
 * A service credential would have been strictly worse, not merely harder: food's enqueue paths
 * (`POST /api/v1/foods`, `/batch`) require the token's `external_id` (the app-user ULID) to attribute the fetch,
 * and a machine principal has none.
 *
 * ## Confused-deputy boundary
 *
 * A forwarded user credential is a confused-deputy risk: the danger is not holding it, it is aiming it. That
 * half of the guarantee lives in `ingredients/FoodServiceClients.factory.ts`, whose target origin comes
 * only from boot-validated config — never from a request — so there is no code path that points a
 * caller-supplied URL at a caller-supplied credential. This module's job is narrower and complementary:
 * make the credential unreadable and unprintable everywhere else.
 *
 * @see revealCallerToken
 * @implements FR-038 FR-047
 */
import { extractBearer } from './bearer.js';

/** What every stringification of a {@link CallerToken} yields. Never the credential. */
export const REDACTED = '[REDACTED]';

/** Node's `util.inspect` hook symbol (well-known registry symbol; `unique symbol` via `const`). */
const inspectCustom = Symbol.for('nodejs.util.inspect.custom');

/**
 * The raw credentials, keyed by their wrapper. Module-private and WEAK: the bytes are unreachable from
 * outside this file and are collected with the request's token object, so nothing accumulates.
 */
const rawCredentials = new WeakMap<CallerToken, string>();

export class CallerToken {
    /**
     * Private so {@link CallerToken.fromAuthorizationHeader} is the ONLY construction path — a token that
     * exists always has a credential registered, and no caller can fabricate one from a bare string.
     */
    private constructor() {}

    /**
     * Wrap the bearer credential from an `Authorization` header value, or `undefined` when there is none.
     *
     * Uses {@link extractBearer} — the same single authoritative parse the `AuthMiddleware` and the
     * service-principal guard use — so the credential forwarded downstream is byte-identical to the one this
     * service verified. `undefined` (no/blank/non-bearer header) is a normal, expected outcome: the
     * non-production dev-auth bypass authenticates with no token at all, and callers must degrade rather
     * than substitute some other credential.
     *
     * @param authorization - The raw `Authorization` header value, if any.
     * @returns An opaque token, or `undefined` when the header carries no bearer credential.
     * @sideEffect Registers the credential in this module's private `WeakMap`.
     */
    public static fromAuthorizationHeader(authorization: string | undefined): CallerToken | undefined {
        const bearer = extractBearer(authorization);

        if (bearer === undefined || bearer.length === 0) {
            return undefined;
        }

        const token = new CallerToken();

        rawCredentials.set(token, bearer);

        return token;
    }

    /** Redacted: a template literal / `String()` must never interpolate a live session token. Pure. */
    public toString(): string {
        return REDACTED;
    }

    /** Redacted: `JSON.stringify` of a response body or error envelope must not carry the token. Pure. */
    public toJSON(): string {
        return REDACTED;
    }

    /** Redacted: `util.inspect` (debugger, crash dump, Nest's own error rendering). Pure. */
    public [inspectCustom](): string {
        return REDACTED;
    }
}

/**
 * Read the raw bearer out of a {@link CallerToken} — the ONE sanctioned accessor.
 *
 * **Restricted import.** Only `ingredients/FoodServiceClients.factory.ts` may import this: it is the sole
 * place the bytes are needed (to build the `Authorization` header for the fixed, config-supplied food-service
 * origin). The package ESLint config enforces that, so a new caller cannot quietly widen the credential's
 * blast radius. If you are reaching for this function somewhere else, the answer is to pass the
 * `CallerToken` along instead.
 *
 * @param token - A token produced by {@link CallerToken.fromAuthorizationHeader}.
 * @returns The exact bearer credential the caller presented.
 * @throws {Error} When the argument did not come from this module (a forged look-alike) — fail closed
 *   rather than return a blank credential that would make an unauthenticated call look authenticated. The
 *   message deliberately names nothing but the type.
 */
export function revealCallerToken(token: CallerToken): string {
    const raw = rawCredentials.get(token);

    if (raw === undefined) {
        throw new Error('CallerToken carries no credential (not created by CallerToken.fromAuthorizationHeader)');
    }

    return raw;
}
