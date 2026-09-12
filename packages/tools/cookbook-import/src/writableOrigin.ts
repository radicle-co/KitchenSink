/**
 * The write gate: which recipe-service origin this importer is ALLOWED to create public recipes against.
 *
 * `importCookbook.ts` has always said, in bold, that the tool "has no production affordance and must never
 * be given one" — but `--recipe-url` was read straight into the mutating client, so the property lived only
 * in a docstring. One pasted or mistyped origin would have created real, PUBLIC `imported_public` recipes in
 * production, from a CLI whose whole purpose is bulk creation, with no second confirmation and no undo.
 *
 * DESIGN PATTERN: **Specification, as an ALLOW-list**. An origin this module does not recognise is REFUSED,
 * never classified. That is deliberately a different shape from the tree's two stage CLASSIFIERS
 * (`packages/infra/global/__tests__/prodWebSurface.ts` `classifyHostStage`, and
 * `packages/apps/commise/web/src/config/clerkStageCoherence.ts` `classifyEndpointStage`), which must place
 * every host and answer `unknown` for the rest: `unknown` is the honest answer for a coherence REPORT and
 * the wrong one for a WRITE gate, where the unrecognised host is exactly the one to stop. So this is not a
 * third copy of that rule — it is the narrower question "may this tool write here", and it fails closed.
 *
 * ⛔ There is deliberately NO override flag. The requirement today is "never production"; an escape hatch
 * would be capability built for a presumed future need, and the first thing a hurried operator reaches for.
 * If importing into production ever becomes a real requirement, it should arrive as its own reviewed change.
 *
 * Every function here is pure.
 */

/** A `pr-{N}` segment, which is what makes an ephemeral per-PR host recognisable (ADR-0005). */
const PER_PR_SEGMENT = /-pr-\d+\./;

/** The sandbox estate's apex. */
const SANDBOX_APEX = 'sandbox.commise.app';

/** Thrown when the importer is pointed at an origin it may not write to. */
export class ForbiddenImportOriginError extends Error {
    /** The origin exactly as the operator supplied it. */
    public readonly origin: string;

    public constructor(origin: string, message: string) {
        super(message);
        this.name = 'ForbiddenImportOriginError';
        this.origin = origin;
        Object.setPrototypeOf(this, ForbiddenImportOriginError.prototype);
    }
}

/** Type guard for {@link ForbiddenImportOriginError}. */
export function isForbiddenImportOriginError(error: unknown): error is ForbiddenImportOriginError {
    return error instanceof ForbiddenImportOriginError;
}

/**
 * Whether this importer may create recipes against `origin`.
 *
 * The host is taken from a parsed `URL`, never matched inside the raw string: a substring test would admit
 * `https://evil.com/?x=sandbox.commise.app`, and the dot-anchored suffix is what stops
 * `sandbox.commise.app.evil.com`.
 *
 * @param origin - The `--recipe-url` value.
 * @returns `true` only for a local, per-PR or sandbox origin. Pure.
 */
export function isWritableImportOrigin(origin: string): boolean {
    let url: URL;

    try {
        url = new URL(origin);
    } catch {
        return false;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false;
    }

    const host = url.hostname.toLowerCase();

    if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]') {
        return true;
    }

    // `URL` strips the brackets from an IPv6 literal, so `http://[::1]:3000` arrives as `::1`.
    if (host === '::1') {
        return true;
    }

    if (host === SANDBOX_APEX || host.endsWith(`.${SANDBOX_APEX}`)) {
        return true;
    }

    return PER_PR_SEGMENT.test(host);
}

/**
 * Return `origin` if this importer may write to it, and otherwise refuse.
 *
 * @param origin - The `--recipe-url` value.
 * @returns The origin, unchanged, so it can wrap the argument in place.
 * @throws {ForbiddenImportOriginError} When the origin is not a local, per-PR or sandbox one.
 */
export function assertWritableImportOrigin(origin: string): string {
    if (isWritableImportOrigin(origin)) {
        return origin;
    }

    throw new ForbiddenImportOriginError(
        origin,
        `cookbook-import: refusing to write to '${origin}'. This tool creates PUBLIC recipes in bulk and has ` +
            'no production affordance: it writes only to localhost, a `pr-{N}` preview, or a `sandbox.commise.app` ' +
            'host. If that origin is genuinely non-production, it needs to be added to the allow-list in a ' +
            'reviewed change — there is deliberately no override flag.',
    );
}
