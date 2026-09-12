/**
 * DRIFT LAYER 3 (Skew), CONSUMER HALF — `docs/CODING_STANDARDS.md` §15.2.5. Holds the `CONTRACT_HASH` this
 * client bundles from `@kitchensink/schema-recipe` against the `contractHash` the service publishes on
 * `GET /health`, and reports a difference.
 *
 * ⚠️ A MISMATCH WARNS, IT DOES NOT REFUSE (owner ruling, 2026-08-11). The asymmetry with the fail-closed
 * SERVICE-side boot check (`recipe-service/src/contract/contractSkew.ts`) is deliberate: that one compares two
 * stamps baked into ONE image, so refusing costs no availability, whereas this compares two INDEPENDENTLY
 * DEPLOYED artifacts. THIS client is where a refusal would be worst: it ships inside the released MOBILE
 * binary — the case §15.2.5 names as the reason drift layer 3 exists — so it could not be rolled back by
 * redeploying anything, and would take an App Store release to clear with every installed app dark meanwhile.
 * A diagnostic must never be able to do that. So it is engineered as one:
 *
 *   1. It never throws, blocks, retries, or alters a response the caller sees — not on mismatch, not on a
 *      failed probe, not when the supplied `warn` itself throws.
 *   2. ABSENCE IS SILENCE, never a mismatch: an absent `contractHash` (a service older than publication), a
 *      malformed one, a non-`200`, or a non-JSON body (the shared ALB's HTML error page, ADR-0003) all mean
 *      we do not know. Reporting those as skew would make every pre-publication deployment noisy, which is
 *      how a real warning gets muted.
 *   3. It warns ONCE per origin per process; log spam gets filtered, which equals having no warning at all.
 *
 * `RecipeServiceClient` fires it from its transport funnel (`send`) AFTER a response, never from the
 * constructor and never from a hook or render path. A client is built wherever the app composes one — a
 * `<RecipeServiceProvider>` mount on web and mobile, and per-request on any server-rendered path — so probing
 * in the constructor would make construction a network operation, and on the server a per-request one; the
 * latch is keyed on ORIGIN at MODULE scope so any construction pattern collapses to one probe per process.
 * Firing after a response also keeps the one-shot off an origin never reached, and off first paint.
 * Fire-and-forget, never awaited, so it adds zero latency to a TanStack Query feeding a loading state.
 *
 * ⚠️ Accepted consequence: the latch is claimed on ATTEMPT, so a probe that fails or races a deploy means no
 * signal for that process's life — re-probing would reintroduce the per-request network call this design
 * avoids, and the cost is bounded because the process is replaced on the next deploy.
 *
 * ⚠️ ONE OF THREE CONSUMER COPIES, DEFERRED DELIBERATELY — do not "fix" it by extracting one here.
 * `contractSkew.ts` in the food client and in `@commise/features-account` (identity's consumer half) are the
 * equivalents, and each of the three services carries a copy of the sibling BOOT predicate.
 * One zero-dependency leaf package is the right home, but this module is bundled into the web app
 * (`next.config.ts` `transpilePackages` is an explicit allowlist) and into the released MOBILE binary, so
 * introducing a workspace package on this path is a bundler-resolution change that cannot be verified without
 * a real device/bundle build. Extraction belongs in a change that can prove the bundle.
 *
 * DESIGN PATTERN: Specification (a pure verdict predicate) + a fire-and-forget Command with an idempotence
 * latch — verdict, message and probe are separated so the DECISION is testable without a socket.
 */
import { CONTRACT_HASH, healthStatusSchema } from '@kitchensink/schema-recipe';

/** A lower-case hex SHA-256 — the shape of every fingerprint the contract generator emits. */
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/** How many leading hex characters a warning prints. Matches the generator's own `slice(0, 12)` log format. */
const HASH_PREVIEW_LENGTH = 12;

/**
 * Upper bound (ms) on the skew probe — deliberately NOT the client's request timeout: a background diagnostic
 * gets its own short leash and is abandoned rather than allowed to hold a socket open.
 */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * The outcome of holding this client's pinned fingerprint against the one a service published.
 *
 * `indeterminate` is a first-class outcome, not an error: it is what "the service did not tell us, or told us
 * something unusable" resolves to, and it must never be reported as skew.
 */
export type ContractSkewVerdict = 'match' | 'indeterminate' | 'skew';

/** What {@link checkContractSkew} and {@link reportContractSkewOnce} need to do their work. */
export interface ContractSkewProbeOptions {
    /** The recipe service origin, with no trailing slash (the client normalizes it before passing it). */
    readonly baseUrl: string;
    /** The `fetch` the client is configured with — so an injected test double is honoured here too. */
    readonly fetch: typeof fetch;
    /** Where a warning goes. The client defaults this to `console.warn`. */
    readonly warn: (message: string) => void;
    /** Probe deadline in ms; defaults to {@link PROBE_TIMEOUT_MS}. */
    readonly timeoutMs?: number;
}

/**
 * Compare a pinned fingerprint against whatever the service served.
 *
 * Pure. Both sides must be a well-formed lower-case 64-hex SHA-256: a bare equality test would "match" two
 * empty strings and would report a truncated or absent value as a MISMATCH, the false positive rule 2 above
 * exists to prevent. Anything unusable on either side is `indeterminate`.
 *
 * @param pinned - The fingerprint this client was built against.
 * @param served - The `contractHash` the service published, or whatever was found in its place.
 * @returns `skew` only when both sides are well-formed and differ.
 */
export function compareContractHashes(pinned: string, served: unknown): ContractSkewVerdict {
    if (!SHA256_HEX.test(pinned)) {
        return 'indeterminate';
    }

    if (typeof served !== 'string' || !SHA256_HEX.test(served)) {
        return 'indeterminate';
    }

    return pinned === served ? 'match' : 'skew';
}

/**
 * Build the warning text.
 *
 * Pure. Names BOTH fingerprints and whose each is, says nothing is blocked, and gives the remedy: a warning a
 * reader cannot act on is noise, and one that reads like an outage sends someone hunting a non-problem.
 *
 * @param pinned - The fingerprint this client was built against.
 * @param served - The fingerprint the service published.
 * @param healthUrl - The probe URL, so the message identifies WHICH deployment disagreed.
 * @returns The multi-line warning.
 */
export function formatContractSkewWarning(pinned: string, served: string, healthUrl: string): string {
    return (
        'CONTRACT SKEW (warning — nothing is blocked): this client was built against a different wire ' +
        'contract than the recipe service is serving, so a field one side expects may be absent or changed. ' +
        'Requests continue normally.\n' +
        `  client  (@kitchensink/schema-recipe CONTRACT_HASH): ${pinned.slice(0, HASH_PREVIEW_LENGTH)}…\n` +
        `  service (GET ${healthUrl} → contractHash):        ${served.slice(0, HASH_PREVIEW_LENGTH)}…\n` +
        "Regenerate this client's contract against the service and rebuild/redeploy it " +
        "('npm run contract:generate'), or redeploy the service on the contract this client was built against."
    );
}

/**
 * Probe the service's `/health` and warn if its fingerprint differs from this client's.
 *
 * Awaitable, and NOT latched — {@link reportContractSkewOnce} is what production calls. This exists as its own
 * export so the probe's behaviour is testable without racing a fire-and-forget promise.
 *
 * Resolves — never rejects — on every path (rule 1): transport failure, non-`200`, non-JSON body, absent or
 * malformed fingerprint, and a throwing `warn` all resolve to silence.
 *
 * The probe is UNAUTHENTICATED: `/health` is public precisely so a consumer can ask about skew before it holds
 * a credential, and a background diagnostic has no business spending the caller's token.
 *
 * @param options - Origin, `fetch`, warning sink, and an optional deadline.
 * @sideEffect Issues one unauthenticated `GET {baseUrl}/health` and may invoke `warn`.
 */
export async function checkContractSkew(options: ContractSkewProbeOptions): Promise<void> {
    const healthUrl = `${options.baseUrl}/health`;

    try {
        const served = await readPublishedContractHash(healthUrl, options);

        if (compareContractHashes(CONTRACT_HASH, served) !== 'skew') {
            return;
        }

        options.warn(formatContractSkewWarning(CONTRACT_HASH, served as string, healthUrl));
    } catch {
        // Deliberately total (rule 1): every failure above means "no usable skew signal", reported by silence.
    }
}

/**
 * Origins already probed in this process, keyed by origin + pinned hash (module scope for the reason given
 * above). The hash is in the key so an entry describes the comparison made, not merely the host asked.
 *
 * Vitest gives each test FILE a fresh module registry, so this does not leak between files;
 * {@link resetContractSkewLatchForTests} clears it between CASES.
 */
const probedOrigins = new Set<string>();

/**
 * Clear the once-per-origin latch. **Test seam only** — never call this from production code.
 *
 * Without it the first test consumes the latch and every later test in the file silently observes "no probe",
 * passing for the wrong reason. Mirrors `resetConfigCacheForTests` in `identity-webhooks`.
 *
 * @sideEffect Empties the module-scope probed-origin set.
 */
export function resetContractSkewLatchForTests(): void {
    probedOrigins.clear();
}

/**
 * Run the skew comparison for this origin at most once per process, off the caller's critical path.
 *
 * Synchronous and returns `void` BY DESIGN: there is no promise a caller could accidentally `await`, so it
 * cannot add latency even by mistake.
 *
 * ⚠️ The latch is claimed BEFORE the first `await`, and that ordering is load-bearing: a burst of concurrent
 * first calls would otherwise all pass the membership test before any had yielded, and each would fire its
 * own probe.
 *
 * @param options - Origin, `fetch`, warning sink, and an optional deadline.
 * @sideEffect Records the origin as probed and may issue one unauthenticated `GET {baseUrl}/health`.
 */
export function reportContractSkewOnce(options: ContractSkewProbeOptions): void {
    const key = `${options.baseUrl}\u0000${CONTRACT_HASH}`;

    if (probedOrigins.has(key)) {
        return;
    }

    probedOrigins.add(key);

    // The `.catch` stays even though `checkContractSkew` cannot reject: it guarantees no unhandled rejection
    // escapes this line if that invariant is ever broken. `try` covers a `fetch` double that throws
    // synchronously.
    try {
        void checkContractSkew(options).catch(() => undefined);
    } catch {
        // Containment as above.
    }
}

/**
 * Read `contractHash` off the health payload, or return `undefined` when it cannot be read.
 *
 * The probe is bounded by a real `AbortSignal` rather than a raced timer, so a stalled `/health` cannot leave a
 * socket pending for the life of the process. The body is read INSIDE the armed deadline, because a
 * load-degraded service can stall the body after the headers arrive.
 *
 * @param healthUrl - The fully-qualified probe URL.
 * @param options - The probe options (its `fetch` and deadline).
 * @returns The published fingerprint, or `undefined` for a non-`200`/non-JSON/absent value.
 * @sideEffect Issues an unauthenticated network request.
 */
async function readPublishedContractHash(
    healthUrl: string,
    options: ContractSkewProbeOptions,
): Promise<unknown | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort();
    }, options.timeoutMs ?? PROBE_TIMEOUT_MS);

    try {
        const response = await options.fetch(healthUrl, {
            method: 'GET',
            headers: { accept: 'application/json' },
            signal: controller.signal,
        });

        if (response.status !== 200) {
            return undefined;
        }

        // PARSED against the published `healthStatusSchema`, never cast: the probe that detects contract drift
        // must not itself be an unchecked belief about the contract. `.safeParse`, not `.parse`, so anything
        // unusable yields "no fingerprint" and stays silent (rule 2) instead of becoming a second failure mode.
        const parsed = healthStatusSchema.safeParse(JSON.parse(await response.text()));

        return parsed.success ? parsed.data.contractHash : undefined;
    } finally {
        clearTimeout(timer);
    }
}
