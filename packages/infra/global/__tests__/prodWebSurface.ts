/**
 * Deployed-web-surface probe + classifiers, backing `prodWebSurface.test.ts` (hermetic) and
 * `prodWebSurface.integration.test.ts` (live).
 *
 * The classifiers are PURE so the invariant can be proved red/green against fixtures without a network, and
 * the impure probe is the thin adapter that hands them the real production artifact. This is the same split
 * `deploy-gate.{test,integration.test}.ts` uses for the deploy gate.
 *
 * ## Why the deployed ARTIFACT is the subject
 *
 * The web app is the one deployable in this repo with **no pipeline here**: Vercel's git integration builds
 * and promotes it, and its Clerk publishable key exists only as a value typed into the Vercel dashboard —
 * unversioned, unreviewable, and outside `src/config/env.ts`'s validation boundary. There is therefore no
 * source file an assertion could read. The served bundle is the only observable, so that is what we assert.
 */

/** Clerk instance kind, as encoded in the publishable key's prefix. */
export type ClerkInstanceKind = 'live' | 'test';

/** The Clerk instance a deployed page tells the browser to load. */
export interface ClerkInstanceRef {
    readonly publishableKey: string;
    readonly kind: ClerkInstanceKind;
    /** The Frontend API host the key encodes, e.g. `clerk.commise.app` or `nice-fowl-6.clerk.accounts.dev`. */
    readonly frontendApiHost: string;
}

/** Which deployment stage a backend origin belongs to. `unknown` is a failure, never a pass. */
export type OriginStage = 'prod' | 'non-prod' | 'unknown';

export interface StageCoherence {
    readonly coherent: boolean;
    readonly findings: readonly string[];
}

/** One hop of a redirect chain. */
export interface Hop {
    readonly url: string;
    readonly status: number;
    readonly location?: string;
}

export interface ChainVerdict {
    readonly terminated: boolean;
    readonly findings: readonly string[];
}

/**
 * Extract the Clerk instance a served HTML document loads.
 *
 * `@clerk/nextjs` renders its loader as `<script data-clerk-publishable-key="pk_(live|test)_<b64>">`, where
 * the base64 payload is the Frontend API host with a trailing `$`. Both halves matter: the PREFIX says which
 * instance class it is, and the decoded HOST says which concrete instance — a `pk_test` whose host is a
 * `*.clerk.accounts.dev` dev domain is a development instance no matter what else is configured.
 *
 * @param html - The served HTML document.
 * @returns The instance reference, or `null` when the document loads no Clerk script.
 */
export function parseClerkInstance(html: string): ClerkInstanceRef | null {
    const match = /data-clerk-publishable-key="(pk_(live|test)_[A-Za-z0-9+/=_-]+)"/.exec(html);

    if (match === null) {
        return null;
    }

    const publishableKey = match[1] as string;
    const kind = match[2] as ClerkInstanceKind;
    const payload = publishableKey.slice(`pk_${kind}_`.length);

    return {
        publishableKey,
        kind,
        frontendApiHost: Buffer.from(payload, 'base64').toString('utf8').replace(/\$$/, ''),
    };
}

/**
 * Extract every `NEXT_PUBLIC_*_API_URL` value the bundle was compiled with.
 *
 * `NEXT_PUBLIC_*` is inlined at BUILD time, so the deployed JavaScript literally contains
 * `NEXT_PUBLIC_IDENTITY_API_URL:"https://identity.commise.app"`. That inlined pair is the only record of
 * which backend the browser will call.
 *
 * @param bundleJs - Concatenated JavaScript from the page's chunks.
 * @returns Map of variable name → origin, for every `NEXT_PUBLIC_*_API_URL` found.
 */
export function parseBundleEndpoints(bundleJs: string): Readonly<Record<string, string>> {
    const found: Record<string, string> = {};

    for (const m of bundleJs.matchAll(/(NEXT_PUBLIC_[A-Z0-9_]*_API_URL)\s*:\s*"(https?:\/\/[^"]+)"/g)) {
        found[m[1] as string] = m[2] as string;
    }

    return found;
}

/**
 * Classify a host as production or non-production for the `commise.app` estate. Pure.
 *
 * Production backends are FIRST-LEVEL subdomains of the apex (`identity.commise.app`). Everything under
 * `sandbox.commise.app`, any `pr-{N}` host, and `localhost` are non-prod. Anything else is `unknown`, which
 * callers must treat as a failure — a classifier that silently passes hosts it does not recognize is how a
 * misconfiguration slips through a guard.
 *
 * @param host - A bare hostname.
 * @returns The stage the host belongs to.
 */
export function classifyHostStage(host: string): OriginStage {
    const lower = host.toLowerCase();

    if (lower === 'localhost' || lower.endsWith('.localhost') || /^127\.|^\[?::1\]?$/.test(lower)) {
        return 'non-prod';
    }

    if (lower.endsWith('.clerk.accounts.dev')) {
        return 'non-prod';
    }

    if (lower === 'commise.app' || lower === 'www.commise.app') {
        return 'prod';
    }

    if (!lower.endsWith('.commise.app')) {
        return 'unknown';
    }

    const label = lower.slice(0, -'.commise.app'.length);

    // `identity`, `recipe`, `food`, `clerk` — one label, no dots, not a per-PR host.
    if (!label.includes('.') && !/^pr-\d+/.test(label)) {
        return 'prod';
    }

    return 'non-prod';
}

/**
 * The stage-coherence invariant: **a deployed bundle's Clerk instance and every backend origin it calls must
 * belong to the same stage.**
 *
 * This is stated as coherence rather than "prod must carry `pk_live`" on purpose. The incident was not "a
 * `pk_test` key existed" — it was that the token ISSUER and the token VERIFIER were different Clerk
 * instances, so every request was unauthorizable. Coherence catches that in both directions (a prod key
 * pointed at sandbox backends is equally broken) and does not need to know which stage it is looking at.
 *
 * @param input - The parsed Clerk instance and the bundle's compiled-in endpoints.
 * @returns Whether the bundle is stage-coherent, with a finding per violation.
 */
export function classifyStageCoherence(input: {
    readonly clerk: ClerkInstanceRef | null;
    readonly endpoints: Readonly<Record<string, string>>;
}): StageCoherence {
    const findings: string[] = [];
    const { clerk, endpoints } = input;

    if (clerk === null) {
        return { coherent: false, findings: ['no Clerk publishable key found in the served document'] };
    }

    const clerkStage: OriginStage = clerk.kind === 'live' ? 'prod' : 'non-prod';
    const clerkHostStage = classifyHostStage(clerk.frontendApiHost);

    if (clerkHostStage !== clerkStage) {
        findings.push(
            `Clerk key kind (pk_${clerk.kind} ⇒ ${clerkStage}) disagrees with its Frontend API host ` +
                `${clerk.frontendApiHost} (${clerkHostStage})`,
        );
    }

    const names = Object.keys(endpoints).sort();

    if (names.length === 0) {
        findings.push('no NEXT_PUBLIC_*_API_URL was compiled into the bundle — cannot prove stage coherence');
    }

    for (const name of names) {
        const origin = endpoints[name] as string;
        const stage = classifyHostStage(new URL(origin).hostname);

        if (stage === 'unknown') {
            findings.push(`${name}=${origin} is an unrecognized origin — refusing to classify it as coherent`);
            continue;
        }

        if (stage !== clerkStage) {
            findings.push(
                `${name}=${origin} is a ${stage} backend but the bundle loads a ${clerkStage} Clerk instance ` +
                    `(${clerk.publishableKey.slice(0, 11)}… @ ${clerk.frontendApiHost}) — its tokens cannot verify there`,
            );
        }
    }

    return { coherent: findings.length === 0, findings };
}

/**
 * The termination invariant: **following the signed-out front door must reach a final response, and no URL
 * may be visited twice.**
 *
 * A "redirects to sign-in" assertion is satisfied by the FIRST hop of an infinite bounce, which is exactly
 * how the loop stayed invisible. Requiring a terminal non-3xx response AND a bounded revisit count turns a
 * loop into a failure instead of a green first sample.
 *
 * A URL appearing TWICE is tolerated because one legitimate round trip exists: an auth handshake that
 * Set-Cookies and redirects back to where it started. Three or more visits cannot be that, and a genuine
 * unbounded loop also exhausts `maxHops`, so both signals are kept.
 *
 * @param hops - The chain in order, each with its status and `Location`.
 * @param maxHops - The budget the chain was followed with.
 * @returns Whether the chain terminated cleanly, with a finding per violation.
 */
export function classifyChainTermination(hops: readonly Hop[], maxHops: number): ChainVerdict {
    const findings: string[] = [];

    if (hops.length === 0) {
        return { terminated: false, findings: ['empty redirect chain — the origin was never reached'] };
    }

    const visits = new Map<string, number>();

    for (const hop of hops) {
        const count = (visits.get(hop.url) ?? 0) + 1;

        visits.set(hop.url, count);

        if (count > 2) {
            findings.push(`redirect CYCLE: ${hop.url} was requested ${count} times in one chain`);
            break;
        }
    }

    const last = hops[hops.length - 1] as Hop;

    if (last.status >= 300 && last.status < 400) {
        findings.push(
            `chain did not terminate within ${maxHops} hops — still redirecting at ${last.url} → ${last.location ?? '?'}`,
        );
    }

    return { terminated: findings.length === 0, findings };
}

/**
 * Hosts a hop may legitimately visit while resolving the app's own front door.
 *
 * A Clerk **production** instance completes its handshake on the app's own domain. A Clerk **development**
 * instance bounces the browser through its `*.clerk.accounts.dev` Frontend API to mint a `__clerk_db_jwt`
 * dev browser. So a hop into `*.clerk.accounts.dev` while loading a production origin is, on its own,
 * conclusive proof that production is serving a development instance — no bundle parsing required.
 *
 * @param hops - The chain in order.
 * @returns A finding per hop whose host is a Clerk development Frontend API.
 */
export function findDevInstanceHandshakeHops(hops: readonly Hop[]): readonly string[] {
    return hops
        .filter((hop) => new URL(hop.url).hostname.toLowerCase().endsWith('.clerk.accounts.dev'))
        .map(
            (hop) =>
                `handshake through a Clerk DEVELOPMENT Frontend API: ${new URL(hop.url).hostname} ` +
                `— a production instance handshakes on the app's own domain`,
        );
}

/**
 * The minimum cookie jar a faithful front-door probe needs, keyed by registrable domain.
 *
 * A Clerk DEVELOPMENT instance completes its handshake by Set-Cookie-ing a `__clerk_db_jwt` dev browser and
 * then redirecting back to the original URL. A cookie-less client therefore re-enters the handshake on the
 * return hop and loops forever at the HTTP layer — a probe artifact, not a defect, and one that would make
 * this guard fail for the wrong reason. Keying by registrable domain also stops app cookies from being
 * offered to Clerk's Frontend API.
 */
class CookieJar {
    private readonly byDomain = new Map<string, Map<string, string>>();

    /** The registrable domain a URL's cookies are filed under. */
    private static domainOf(url: string): string {
        return new URL(url).hostname.toLowerCase().split('.').slice(-2).join('.');
    }

    /**
     * File the `Set-Cookie` values from a response.
     *
     * @param url - The URL the response came from.
     * @param setCookies - Raw `Set-Cookie` header values.
     * @sideEffect Mutates the jar.
     */
    store(url: string, setCookies: readonly string[]): void {
        const domain = CookieJar.domainOf(url);
        const jar = this.byDomain.get(domain) ?? new Map<string, string>();

        for (const raw of setCookies) {
            const [pair] = raw.split(';');
            const eq = (pair ?? '').indexOf('=');

            if (eq <= 0) {
                continue;
            }

            const name = (pair as string).slice(0, eq).trim();
            const value = (pair as string).slice(eq + 1).trim();

            // An empty value with an expiry in the past is Clerk clearing a cookie; drop it rather than
            // echoing `name=` back, which some middlewares read as a present-but-blank session.
            if (value.length === 0) {
                jar.delete(name);
                continue;
            }

            jar.set(name, value);
        }

        this.byDomain.set(domain, jar);
    }

    /**
     * The `Cookie` request header for a URL, or `undefined` when the jar holds nothing for its domain.
     *
     * @param url - The URL about to be requested.
     * @returns A `Cookie` header value, or `undefined`.
     */
    header(url: string): string | undefined {
        const jar = this.byDomain.get(CookieJar.domainOf(url));

        if (jar === undefined || jar.size === 0) {
            return undefined;
        }

        return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    }
}

export interface WebSurface {
    readonly hops: readonly Hop[];
    readonly finalUrl: string;
    readonly finalStatus: number;
    readonly html: string;
    readonly bundleJs: string;
}

/**
 * Fetch a deployed web surface the way a browser does, following redirects MANUALLY so the chain is
 * observable, then pull down every script chunk the terminal document references.
 *
 * `Accept: text/html` is load-bearing: Clerk's middleware only issues its handshake redirect for
 * handshake-ELIGIBLE requests (GET + an HTML `Accept`). A bare `fetch` sends `Accept: * / *`, silently skips
 * the handshake, and comes back `200 signed-out` — which is exactly the false "OK" that
 * `packages/apps/commise/web/scripts/cutoverSmoke.ts` documents having reported.
 *
 * @param origin - Origin to probe, e.g. `https://commise.app`.
 * @param path - Path to request, e.g. `/en`.
 * @param maxHops - Redirect budget; exceeding it is reported by {@link classifyChainTermination}.
 * @returns The chain, the terminal document, and its concatenated chunk JavaScript.
 * @sideEffect Performs HTTP requests against a deployed origin.
 */
export async function probeWebSurface(origin: string, path: string, maxHops = 10): Promise<WebSurface> {
    const hops: Hop[] = [];
    const jar = new CookieJar();
    let url = new URL(path, origin).toString();
    let response: Response | undefined;

    for (let hop = 0; hop < maxHops; hop += 1) {
        const cookie = jar.header(url);

        response = await fetch(url, {
            redirect: 'manual',
            headers: {
                accept: 'text/html,application/xhtml+xml',
                ...(cookie === undefined ? {} : { cookie }),
            },
        });

        jar.store(url, response.headers.getSetCookie());

        const location = response.headers.get('location') ?? undefined;

        hops.push({ url, status: response.status, location });

        if (response.status < 300 || response.status >= 400 || location === undefined) {
            break;
        }

        url = new URL(location, url).toString();
    }

    const finalStatus = response?.status ?? 0;
    const html = finalStatus === 200 ? await (response as Response).text() : '';
    const chunkPaths = [...new Set([...html.matchAll(/"(\/_next\/static\/chunks\/[^"]+?\.js)"/g)].map((m) => m[1]))];
    const chunks = await Promise.all(
        chunkPaths.map(async (chunk) => {
            const res = await fetch(new URL(chunk as string, url).toString());

            return res.ok ? res.text() : '';
        }),
    );

    return { hops, finalUrl: url, finalStatus, html, bundleJs: chunks.join('\n') };
}
