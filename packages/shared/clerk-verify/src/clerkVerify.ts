/**
 * Networkless Clerk token verification (shared between the identity service and food-service).
 *
 * Wraps `@clerk/backend`'s `verifyToken`, which validates a Clerk-signed JWT against a pinned PEM
 * public key (no Clerk secret key, no JWKS network round-trip), its expiry, and the `azp` claim
 * against an allowlist. Extracted from the identity service's `ClerkAuthService` so both services
 * share one implementation and cannot drift (plan §1 / §2A.1, T-046).
 *
 * Identity grants (`scopes`/`permissions`) are read ONLY from the token's signed `public_metadata`
 * (backend/admin-controlled), never from a top-level claim that could be mapped from user-editable
 * `unsafe_metadata` — a privilege-escalation footgun. Every verification failure (missing key, bad
 * signature, expiry, wrong `azp`, malformed token, missing `sub`) maps to a single
 * {@link ClerkVerificationError} so the reason is never leaked to the caller (fail-closed).
 *
 * @implements FR-036 FR-037 FR-038 FR-053
 */
import { verifyToken } from '@clerk/backend';

/** The subset of Clerk session/M2M-token claims consumers read. */
export interface VerifiedClerkClaims {
    /** The Clerk subject (the authenticated principal id). */
    readonly sub: string;
    /**
     * The app-user ULID (identity's canonical `users.id`), surfaced from the token's `external_id`
     * claim. Optional: absent until the Clerk session-token customization emits `external_id` AND the
     * user's external_id has been backfilled (first-token sync race). Per-service policy decides
     * whether to fail closed on absence — recipe ownership (T019) requires it; identity/food do not.
     */
    readonly userId?: string;
    /** The authorized party (origin / service-client id) the token was minted for. */
    readonly azp?: string;
    /** Customized session-token email claim, when present. */
    readonly email?: string;
    /** Customized first-name claim, when present. */
    readonly firstName?: string;
    /** Customized last-name claim, when present. */
    readonly lastName?: string;
    /** Customized avatar/picture claim, when present. */
    readonly picture?: string;
    /** Authorization scopes from `public_metadata` (empty = no privilege). */
    readonly scopes: string[];
    /** Authorization permissions from `public_metadata` (empty = no privilege). */
    readonly permissions: string[];
}

/** Verification configuration: the public PEM key and the `azp` allowlist (both non-secret, FR-042). */
export interface ClerkVerifyConfig {
    /** The instance's public JWT key (PEM). Absence is a fail-closed error. */
    readonly jwtKey: string | undefined;
    /** The allowed `azp` values; empty skips the `azp` check (never passed as `[]` to Clerk). */
    readonly authorizedParties: string[];
    /**
     * When set, the verified `azp` is validated against THIS anchored pattern instead of the exact-match
     * `authorizedParties` list — the SDK `azp` check is skipped and we enforce it ourselves. This lets a
     * bounded family of origins (per-PR preview subdomains) pass without an unbounded allowlist. Build it
     * with {@link buildPreviewAzpPattern} so it is anchored and dot-escaped. Callers enforce "exactly one
     * of pattern or list" per stage; prod stays on the list and leaves this undefined.
     */
    readonly authorizedPartyPattern?: RegExp;
    /**
     * Optional gate that admits a token whose `azp` is ABSENT (e.g. a native `@clerk/expo` token) under
     * pattern mode. Receives the raw verified payload and returns `true` to admit. Without it, an absent
     * `azp` under pattern mode is rejected. It MUST key on a positive native-token signal — never admit on
     * `azp`-absence alone, or any client able to obtain an `azp`-less token bypasses the origin check.
     */
    readonly admitAzplessToken?: (payload: Readonly<Record<string, unknown>>) => boolean;
}

/**
 * The single, opaque verification failure. Carries a generic message only — never the underlying
 * Clerk error, token, or key — so a caller (and its logs) cannot leak why verification failed.
 */
export class ClerkVerificationError extends Error {
    public constructor(message = 'Clerk token verification failed') {
        super(message);
        this.name = 'ClerkVerificationError';
        Object.setPrototypeOf(this, ClerkVerificationError.prototype);
    }
}

/**
 * Type guard for {@link ClerkVerificationError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is a {@link ClerkVerificationError}.
 */
export function isClerkVerificationError(error: unknown): error is ClerkVerificationError {
    return error instanceof ClerkVerificationError;
}

/** Coerce a value to a non-empty string, else `undefined`. Pure. */
function asNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Coerce a value to a string array (filtering non-strings), else `[]`. Pure. */
function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Coerce a value to a plain object, else `{}`. Pure. */
function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

/** Escape regex metacharacters so a literal string matches only itself. Pure. */
function escapeRegExp(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the anchored, dot-escaped `azp` pattern for per-PR preview subdomains under `baseDomain`
 * (e.g. `'sandbox.commise.app'` → `/^https:\/\/pr-\d+\.sandbox\.commise\.app$/`). Anchored at both ends
 * and ReDoS-safe (one bounded `\d+` followed by a literal — no catastrophic backtracking), so it is safe
 * to use as the `azp` security boundary. Pure.
 *
 * @param baseDomain - The apex the preview subdomains sit under (no scheme, no leading dot).
 * @returns A RegExp matching exactly `https://pr-<digits>.<baseDomain>`.
 */
export function buildPreviewAzpPattern(baseDomain: string): RegExp {
    return new RegExp(`^https://pr-\\d+\\.${escapeRegExp(baseDomain)}$`);
}

/**
 * Build the **cutover** `azp` pattern: like {@link buildPreviewAzpPattern} but the `pr-<digits>.` label is
 * OPTIONAL, so it also matches the bare apex origin `https://<baseDomain>`. This is the transition-safe
 * boundary used ONLY while the shared sandbox is migrating from path routing to per-PR subdomains — during
 * that window path-routed previews still mint `azp = https://sandbox.commise.app` while new subdomain
 * previews mint `azp = https://pr-<N>.sandbox.commise.app`, and both must pass so no in-flight preview 401s.
 * Every other constraint is identical to the strict pattern (anchored, dot-escaped, single bounded `\d+`,
 * ReDoS-safe). Once every preview serves on a subdomain, callers revert to {@link buildPreviewAzpPattern} to
 * drop base-apex acceptance. Pure.
 *
 * @param baseDomain - The apex the preview subdomains sit under (no scheme, no leading dot).
 * @returns A RegExp matching `https://<baseDomain>` OR `https://pr-<digits>.<baseDomain>`.
 */
export function buildTransitionAzpPattern(baseDomain: string): RegExp {
    return new RegExp(`^https://(?:pr-\\d+\\.)?${escapeRegExp(baseDomain)}$`);
}

/**
 * The positive native-client signal for admitting an `azp`-less token in pattern mode: the token carries
 * `client_type: 'native'`, a claim minted ONLY by the mobile app's dedicated Clerk JWT template
 * (`commise-native`). Web session tokens never set it AND always carry an `azp`, so this gate is never
 * even consulted for them (see {@link assertAzpMatchesPattern} — a present `azp` short-circuits to the
 * pattern check). Keying on this explicit claim — never on `azp`-absence alone — is the security
 * requirement: a token is admitted because it PROVES it is native, not merely because it lacks an origin.
 * Pure.
 *
 * @param payload - The verified token payload.
 * @returns `true` when `client_type` is exactly the string `'native'`.
 */
export function isNativeClientToken(payload: Readonly<Record<string, unknown>>): boolean {
    return payload['client_type'] === 'native';
}

/**
 * Whether exactly one `azp` enforcement mode is selected — an exact-match list XOR a preview pattern.
 * `false` when BOTH are set (ambiguous) or NEITHER is (fail-open: `verifyToken` would skip the `azp`
 * check entirely). A service's config validation uses this to fail closed on deployed stages. Pure.
 */
export function hasExactlyOneAzpMode(hasList: boolean, hasPattern: boolean): boolean {
    return hasList !== hasPattern;
}

/**
 * Resolve the `azp`-enforcement fields of a {@link ClerkVerifyConfig} from env selectors: an exact-match
 * comma list OR a preview-subdomain base domain (pattern mode). A non-empty base domain selects pattern
 * mode and the anchored pattern is built from it; otherwise the exact-match list is used. Callers own the
 * "exactly one per stage" check (see {@link hasExactlyOneAzpMode}) — this is the runtime resolver. Pure.
 */
export function resolveAzpEnforcement(input: {
    readonly authorizedPartiesRaw: string | undefined;
    readonly previewBaseDomain: string | undefined;
    /**
     * Selects which preview pattern to build when `previewBaseDomain` is set. The raw env value
     * `'transition'` (exactly, trimmed) builds the cutover pattern that ALSO accepts the base apex
     * ({@link buildTransitionAzpPattern}); ANY other value (unset, `'strict'`, a typo) is fail-safe and
     * builds the strict subdomain-only pattern ({@link buildPreviewAzpPattern}). Ignored in list mode.
     */
    readonly previewMode?: string;
    readonly admitAzplessToken?: (payload: Readonly<Record<string, unknown>>) => boolean;
    /**
     * Convenience for the common case: when `true` (and no explicit {@link admitAzplessToken} is given),
     * wire the shared {@link isNativeClientToken} gate so pattern mode admits azp-less native-app tokens
     * (`client_type: 'native'`). Services set this from an env flag so the security signal lives once here,
     * not copied per service. An explicit `admitAzplessToken` still wins. Ignored in list mode.
     */
    readonly admitNativeClient?: boolean;
}): Pick<ClerkVerifyConfig, 'authorizedParties' | 'authorizedPartyPattern' | 'admitAzplessToken'> {
    const authorizedParties = (input.authorizedPartiesRaw ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    const base = input.previewBaseDomain?.trim();

    if (base !== undefined && base.length > 0) {
        // Fail safe: only the exact `'transition'` value relaxes to the apex-accepting pattern; anything
        // else stays strict, so a mistyped env can never silently widen the azp boundary.
        const authorizedPartyPattern =
            input.previewMode?.trim() === 'transition' ? buildTransitionAzpPattern(base) : buildPreviewAzpPattern(base);

        return {
            authorizedParties,
            authorizedPartyPattern,
            // An explicit gate wins; otherwise the `admitNativeClient` flag wires the shared native gate.
            admitAzplessToken:
                input.admitAzplessToken ?? (input.admitNativeClient === true ? isNativeClientToken : undefined),
        };
    }

    return { authorizedParties };
}

/**
 * Enforce the self-owned `azp` boundary in pattern mode. A present `azp` must match `pattern`; an absent
 * `azp` is admitted only when `admitAzpless` returns `true` for the payload (a positive native-token
 * signal), never on absence alone. Throws {@link ClerkVerificationError} otherwise.
 */
function assertAzpMatchesPattern(
    payload: Record<string, unknown>,
    pattern: RegExp,
    admitAzpless?: (payload: Readonly<Record<string, unknown>>) => boolean,
): void {
    const azp = asNonEmptyString(payload['azp']);

    if (azp === undefined) {
        if (admitAzpless?.(payload) === true) {
            return;
        }

        throw new ClerkVerificationError();
    }

    if (!pattern.test(azp)) {
        throw new ClerkVerificationError();
    }
}

/**
 * Verify a Clerk JWT networklessly and return the claims consumers read.
 *
 * @param token - The raw bearer token.
 * @param config - The public PEM key + `azp` allowlist.
 * @returns The verified claims (`sub` guaranteed present).
 * @throws {ClerkVerificationError} on ANY failure (missing key, bad signature/expiry/azp, missing sub).
 * @sideEffect None beyond the in-process signature check — no network call (jwtKey, not secretKey).
 */
export async function verifyClerkToken(token: string, config: ClerkVerifyConfig): Promise<VerifiedClerkClaims> {
    if (!config.jwtKey) {
        // Fail closed: a missing public key cannot verify anything, and we never reach out for one.
        throw new ClerkVerificationError();
    }

    let result: Awaited<ReturnType<typeof verifyToken>>;

    const usePattern = config.authorizedPartyPattern !== undefined;

    try {
        result = await verifyToken(token, {
            jwtKey: config.jwtKey,
            // Pattern mode enforces `azp` ourselves (below), so skip the SDK check. Otherwise pass the
            // list — undefined when empty; Clerk treats an empty array as "reject all".
            authorizedParties: usePattern
                ? undefined
                : config.authorizedParties.length > 0
                  ? config.authorizedParties
                  : undefined,
        });
    } catch {
        throw new ClerkVerificationError();
    }

    // `@clerk/backend`'s `verifyToken` THROWS on failure (caught above) and resolves the verified token
    // on success. Its declared return type is the legacy `{ data, errors }` envelope, but at runtime
    // (>= 1.34) it resolves the BARE JWT payload — the declared types lag the runtime. Accept either: a
    // legacy `{ data }` envelope OR the payload itself; still reject a legacy failure envelope (`errors`).
    const raw = result as unknown as Record<string, unknown>;

    if (raw['errors']) {
        throw new ClerkVerificationError();
    }

    const payload = asRecord(raw['data'] ?? raw);
    const sub = asNonEmptyString(payload['sub']);

    if (!sub) {
        throw new ClerkVerificationError();
    }

    // Self-owned `azp` boundary: in pattern mode we validated nothing at the SDK layer, so enforce it here.
    if (config.authorizedPartyPattern !== undefined) {
        assertAzpMatchesPattern(payload, config.authorizedPartyPattern, config.admitAzplessToken);
    }

    const publicMetadata = asRecord(payload['public_metadata']);

    return {
        sub,
        userId: asNonEmptyString(payload['external_id']),
        azp: asNonEmptyString(payload['azp']),
        email: asNonEmptyString(payload['email']),
        firstName: asNonEmptyString(payload['first_name']),
        lastName: asNonEmptyString(payload['last_name']),
        picture: asNonEmptyString(payload['image_url']) ?? asNonEmptyString(payload['picture']),
        scopes: asStringArray(publicMetadata['scopes']),
        permissions: asStringArray(publicMetadata['permissions']),
    };
}
