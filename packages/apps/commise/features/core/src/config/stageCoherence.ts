/**
 * @module @commise/features-core/config/stageCoherence — the Clerk instance and the API endpoints must belong to the SAME stage.
 *
 * This exists because of the 2026-08-07 production outage: Vercel's Production environment held a
 * SANDBOX Clerk publishable key while the API URLs pointed at PRODUCTION services. Identity verifies
 * Clerk tokens networklessly against the production PEM, so every browser-minted token failed signature
 * verification, `/api/v1/users/me` returned a permanent 401, and the app's redirect-to-sign-in handler
 * turned that into an infinite loop.
 *
 * The check is COHERENCE, not "production must use `pk_live`". The defect was that the token issuer and
 * the token verifier were different Clerk instances, which is equally broken in the other direction and
 * equally invisible. Coherence catches both and needs no knowledge of which stage the build is for —
 * which matters, because the build does not reliably know either.
 *
 * A Clerk publishable key is `pk_(test|live)_` followed by base64 of the Frontend API host with a
 * trailing `$`. Decoding it is what makes the instance identity legible: `pk_test_bmljZS1mb3dsLTYu…`
 * decodes to `nice-fowl-6.clerk.accounts.dev`, which is unmistakably not production.
 *
 * KNOWN DUPLICATION, recorded rather than hidden: `packages/infra/global/__tests__/prodWebSurface.ts`
 * implements the same classification for the post-deploy runtime probe. One rule, two places — a
 * build-time gate here and a live check there. Extracting to a shared package is the correct end state;
 * it is not done here only because that copy lives in a test directory this package cannot import.
 * ⚠️ They ALREADY drifted once — both carried an OPTIONAL terminator strip — so both now mirror the SAME
 * upstream predicate, `isValidDecodedPublishableKey` from `@clerk/shared/keys`, rather than each inventing
 * its own notion of validity. Change one and the other must change to the same VENDOR rule.
 *
 * SHARED by both hosts (web's build-time env module, mobile's startup env module) — the rule is one piece of
 * knowledge and the two apps used to hold only half of it: web enforced it, mobile read the key as a bare
 * presence check and would have shipped the same outage in a binary.
 *
 * Every function below is pure.
 */

/**
 * Clerk's OWN validity rule for a decoded publishable key, mirrored from `isValidDecodedPublishableKey` in
 * `@clerk/shared/keys`: exactly one trailing `$`, no other `$`, and a `.` in what remains — a Frontend API
 * host is never a single label.
 *
 * MIRRORED rather than imported, and mirrored rather than hand-tightened. `@clerk/shared` is not a declared
 * dependency of this package (it arrives transitively under `@clerk/nextjs`) and this module is a build-time
 * guard that must not acquire a runtime Clerk import; its twin in `prodWebSurface.ts` could not import from
 * here either. Copying the VENDOR's predicate is what stops the two copies becoming two different opinions,
 * which is exactly what happened while each had its own terminator handling. A stricter hostname regex of
 * our own was written first and discarded for the same reason: refusing a key Clerk accepts would fail a
 * build that would have worked.
 *
 * @param decoded - The base64-decoded payload of a `pk_(test|live)_…` key.
 * @returns `true` when Clerk itself would accept it.
 */
function isValidDecodedPublishableKey(decoded: string): boolean {
    if (!decoded.endsWith('$')) {
        return false;
    }

    const withoutTerminator = decoded.slice(0, -1);

    return !withoutTerminator.includes('$') && withoutTerminator.includes('.');
}

/** Which Clerk instance a publishable key belongs to. */
export interface ClerkKeyRef {
    /** `live` for a production instance, `test` for a development/sandbox one. */
    readonly kind: 'live' | 'test';
    /** The Frontend API host the key encodes, e.g. `clerk.commise.app`. */
    readonly fapiHost: string;
}

/** The stage an API origin belongs to. `unknown` is a failure, never a pass. */
export type EndpointStage = 'production' | 'non-production' | 'local' | 'unknown';

/**
 * Decode a Clerk publishable key into its instance kind and Frontend API host.
 *
 * @param key - The raw publishable-key value (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` on web, `EXPO_PUBLIC_IDP_PUBLISHABLE_KEY` on mobile).
 * @returns The instance reference, or `null` when the value is not a publishable key — including one that
 *   decodes but was never minted by Clerk (no `$` terminator, or a payload that is not a hostname).
 */
export function classifyClerkKey(key: string): ClerkKeyRef | null {
    const match = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(key);

    if (match === null) {
        return null;
    }

    const kind = match[1] === 'live' ? 'live' : 'test';
    let decoded: string;

    try {
        // The payload is standard base64 of `<host>$`. `atob` exists in Node 24 and every browser.
        decoded = atob(match[2]?.replace(/-/g, '+').replace(/_/g, '/') ?? '');
    } catch {
        return null;
    }

    // The terminator is part of the format Clerk mints, not decoration. An earlier `replace(/\$+$/, '')` made
    // it optional, so ANY decodable payload classified — `pk_live_` + base64('foo') read as a production
    // instance at `foo`, and this guard would have waved through a key clerk-js cannot initialize with.
    if (!isValidDecodedPublishableKey(decoded)) {
        return null;
    }

    return { kind, fapiHost: decoded.slice(0, -1) };
}

/** An IPv4 octet, 0-255. */
const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;

/**
 * RFC 1918 — 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 — where a phone reaches a developer's services: the Android
 * emulator's host alias `10.0.2.2` (the `e2e` EAS profile) or a LAN address (`.env.template`'s advice for a device).
 * Neither can be a production host, so they classify as local, exactly as `localhost` does. Three fixed ranges are
 * bounded by hand; no IP library is worth a runtime import in a build-time guard.
 */
const PRIVATE_IPV4 = new RegExp(
    String.raw`^(?:10\.${OCTET}\.${OCTET}\.${OCTET}|172\.(?:1[6-9]|2\d|3[01])\.${OCTET}\.${OCTET}|192\.168\.${OCTET}\.${OCTET})$`,
    'u',
);

/**
 * Classify an API origin by stage.
 *
 * Production is the bare `commise.app` service subdomains. Anything under `sandbox.commise.app`, or a
 * per-PR host such as `recipe-pr-73.commise.app`, is non-production. `unknown` is returned rather than
 * guessed — an unclassified host is precisely where the next variant of this bug would hide.
 *
 * @param url - An absolute http(s) origin.
 * @returns The stage classification.
 */
export function classifyEndpointStage(url: string): EndpointStage {
    let host: string;

    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return 'unknown';
    }

    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost') || PRIVATE_IPV4.test(host)) {
        return 'local';
    }

    if (host.endsWith('.sandbox.commise.app') || host === 'sandbox.commise.app') {
        return 'non-production';
    }

    if (host.endsWith('.commise.app') || host === 'commise.app') {
        // A per-PR service host carries a `-pr-{N}` segment; everything else on the apex is production.
        return /-pr-\d+\./.test(`${host}.`) ? 'non-production' : 'production';
    }

    return 'unknown';
}

/** The inputs the coherence rule reads. */
export interface StageCoherenceInput {
    readonly clerkPublishableKey: string;
    /** The variable the key was read from, so a refusal names the setting the operator must fix. */
    readonly clerkKeyName: string;
    /** Endpoint variable name → its configured URL. */
    readonly endpoints: Readonly<Record<string, string | undefined>>;
}

/**
 * Find every way the Clerk instance and the configured endpoints disagree about which stage this build
 * is for.
 *
 * @param input - The publishable key and the endpoint URLs.
 * @returns Human-readable problems; empty means coherent.
 */
export function findStageIncoherence(input: StageCoherenceInput): readonly string[] {
    const problems: string[] = [];
    const clerk = classifyClerkKey(input.clerkPublishableKey);

    if (clerk === null) {
        return [
            `${input.clerkKeyName} is not a Clerk publishable key (expected pk_test_… or pk_live_…). ` +
                'Without it the Clerk instance cannot be identified, so stage coherence cannot be checked.',
        ];
    }

    for (const [name, url] of Object.entries(input.endpoints)) {
        if (url === undefined || url === '') {
            continue;
        }

        const stage = classifyEndpointStage(url);

        if (stage === 'unknown') {
            problems.push(
                `${name}=${url} is a host this guard cannot place as production, non-production or local. ` +
                    'Classify it in classifyEndpointStage rather than leaving it unchecked.',
            );
            continue;
        }

        if (stage === 'production' && clerk.kind !== 'live') {
            problems.push(
                `${name}=${url} is a PRODUCTION endpoint but the Clerk instance is a development one ` +
                    `(${clerk.fapiHost}). Tokens it mints cannot be verified by the production service, so ` +
                    'every authenticated request would 401. This is the 2026-08-07 outage.',
            );
        }

        if (stage === 'non-production' && clerk.kind === 'live') {
            problems.push(
                `${name}=${url} is a NON-PRODUCTION endpoint but the Clerk instance is production ` +
                    `(${clerk.fapiHost}). The mismatch fails the same way, in the other direction.`,
            );
        }

        if (stage === 'local' && clerk.kind === 'live') {
            problems.push(
                `${name}=${url} is localhost but the Clerk instance is production (${clerk.fapiHost}). ` +
                    'Production Clerk instances are domain-locked and clerk-js aborts on localhost — use the ' +
                    'development instance for local work.',
            );
        }
    }

    return problems;
}
