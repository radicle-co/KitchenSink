/**
 * The origins a browser may PUT a presigned object from, for the media buckets' CORS rule.
 *
 * The pages that upload are exactly the pages the Clerk `azp` boundary admits, so the list is DERIVED from
 * {@link resolveAzpEnforcement} — the resolver the token check and {@link resolveCorsPolicy} already use (ADR-0047).
 * The three boundaries therefore cannot disagree about which origins are ours, including the `transition` widening.
 *
 * It is a SEPARATE function from `resolveCorsPolicy` on purpose: that one answers for a bearer-only HTTP service
 * (and `bearerOnlyPrecondition.test.ts` discovers adopters by the call), while a bucket's CORS rule has no
 * request-time code, no credentials, and a different value language — S3 `AllowedOrigin` strings, not `RegExp`s.
 *
 * ⚠️ S3 allows ONE `*` per origin and it matches ANY run of characters, dots included, so `https://pr-*.<base>` also
 * matches `https://pr-evil.com.<base>`. That is acceptable because every match still ends in `.<base>`, a zone we
 * own; credentials are off; and the presigned signature, not the origin, authorizes the write. A browser `Origin`
 * header never carries a path, query or fragment, so no suffix trick can reach the glob.
 *
 * Fail-closed: with no selector configured there is no list to return, so this THROWS rather than answering an empty
 * list (which CDK would turn into a rule that admits nothing, silently) or a wildcard.
 *
 * @pattern Policy — a pure function from configuration to the admitted origins, derived from the `azp` resolver
 * @module
 */
import { resolveAzpEnforcement } from './clerkVerify.js';

/** The `azp` configuration the upload origins are derived from (the global synth's `CLERK_*` settings). */
export interface UploadOriginInput {
    /** Raw `CLERK_AUTHORIZED_PARTIES` (comma-separated), if set. */
    readonly authorizedPartiesRaw: string | undefined;
    /** Raw `CLERK_AZP_PATTERN`, the preview base domain, if set. */
    readonly previewBaseDomain: string | undefined;
    /** Raw `CLERK_AZP_PREVIEW_MODE`. Only the exact value `transition` widens the pattern. */
    readonly previewMode: string | undefined;
}

/** Which rule produced the origin list. */
export type UploadOriginMode =
    /** An explicit `CLERK_AUTHORIZED_PARTIES` list (prod). */
    | 'exact-list'
    /** The anchored preview-subdomain pattern (sandbox), expressed as S3 globs. */
    | 'preview-pattern';

/** The admitted origins, as S3 CORS `AllowedOrigin` strings (at most one `*` each). */
export interface UploadOrigins {
    readonly mode: UploadOriginMode;
    readonly origins: readonly string[];
}

/** Raised when the configuration cannot produce a safe, non-empty origin list. */
export class UploadOriginPolicyError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'UploadOriginPolicyError';
        Object.setPrototypeOf(this, UploadOriginPolicyError.prototype);
    }
}

/** Type guard for {@link UploadOriginPolicyError}. */
export function isUploadOriginPolicyError(error: unknown): error is UploadOriginPolicyError {
    return error instanceof UploadOriginPolicyError;
}

/** A bare `https` origin: host and optional port, no path, no wildcard. */
const HTTPS_ORIGIN = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/;

/**
 * Resolve the origins allowed to PUT to a media bucket. Pure.
 *
 * Precedence mirrors the `azp` resolver: an explicit party list wins, otherwise the preview pattern.
 *
 * @param input - The raw `CLERK_*` settings.
 * @returns The named mode and the S3 `AllowedOrigin` strings.
 * @throws {UploadOriginPolicyError} when neither selector is set, or a party-list entry is not a bare `https` origin.
 */
export function resolveUploadOrigins(input: UploadOriginInput): UploadOrigins {
    const { authorizedParties, authorizedPartyPattern } = resolveAzpEnforcement(input);

    if (authorizedParties.length > 0) {
        const invalid = authorizedParties.filter((party) => !HTTPS_ORIGIN.test(party));

        if (invalid.length > 0) {
            throw new UploadOriginPolicyError(
                `CLERK_AUTHORIZED_PARTIES entries must be bare https origins without a wildcard; refused: ${invalid.join(', ')}`,
            );
        }

        return { mode: 'exact-list', origins: [...authorizedParties] };
    }

    const base = input.previewBaseDomain?.trim();

    if (authorizedPartyPattern === undefined || base === undefined || base.length === 0) {
        throw new UploadOriginPolicyError(
            'No upload origin can be derived: set CLERK_AUTHORIZED_PARTIES or CLERK_AZP_PATTERN for this synth',
        );
    }

    // The apex is admitted exactly when the azp pattern admits it, so the transition widening is read off the
    // authority rather than re-derived from the mode string.
    const apex = `https://${base}`;
    const admitsApex = authorizedPartyPattern.test(apex);

    return { mode: 'preview-pattern', origins: [`https://pr-*.${base}`, ...(admitsApex ? [apex] : [])] };
}
