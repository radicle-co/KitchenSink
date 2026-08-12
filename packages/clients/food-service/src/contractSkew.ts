/**
 * DRIFT LAYER 3 (Skew), CONSUMER HALF — `docs/CODING_STANDARDS.md` §15.2.5.
 *
 * The service publishes the wire-contract fingerprint it was built against on `GET /health`
 * (`contractHash`). This module holds it against the fingerprint THIS client was built against — the
 * `CONTRACT_HASH` bundled from `@kitchensink/schema-food` — and reports a difference.
 *
 * ── THE RULING: A MISMATCH WARNS. IT DOES NOT REFUSE. (owner, 2026-08-11) ──
 *
 * This is the one decision the layer was blocked on, and the asymmetry with the SERVICE-side boot check
 * (`packages/services/food-service/src/contract/contract-skew.ts`, which is fail-closed) is deliberate:
 *
 *   - The boot check compares two stamps baked into ONE artifact. Its outcome is fully determined by the
 *     image, so refusing to start costs no availability — an image that boots once boots always.
 *   - This check compares two INDEPENDENTLY DEPLOYED artifacts. Its inputs change whenever either side ships.
 *     A refusal here would mean every backend deploy briefly bricks every client that had not shipped in
 *     lockstep — and on mobile, where a released binary cannot be updated in step with a backend deploy (the
 *     motivating case for the whole layer), it would brick the app until an App Store release cleared it.
 *
 * So this path is a DIAGNOSTIC, and it is engineered to behave like one:
 *
 *   1. **It never throws, never blocks, never retries, and never alters a response the caller sees.** Not on
 *      mismatch, not on a failed probe, not even when the supplied `warn` callback itself throws.
 *   2. **Absence is silence, not a mismatch.** A service deployed before publication existed serves no
 *      `contractHash` at all. Reporting that as skew would make every pre-publication deployment noisy, which
 *      is how a real warning gets muted. Same for a malformed value, and for a `contractHash` we cannot read
 *      because the probe returned a non-`200` or a non-JSON body (the shared ALB's HTML error page, ADR-0003).
 *      In all of those we do not know, so we say nothing.
 *   3. **It warns ONCE per origin per process.** A per-call warning on a hot path is log spam, and log spam
 *      gets filtered — which is operationally identical to having no warning at all. See
 *      {@link reportContractSkewOnce}.
 *
 * ── WHERE THE COMPARISON FIRES, AND WHY THERE ──
 *
 * `FoodServiceClient` calls {@link reportContractSkewOnce} from its transport funnel AFTER a response has been
 * received — never from its constructor. Three reasons, and the first is a live constraint rather than taste:
 *
 *   - **A client instance is NOT long-lived here.** `FoodServiceClients` (the recipe service's factory) mints a
 *     fresh `FoodServiceClient` per request, and its typeahead variant mints one PER KEYSTROKE. Probing on
 *     construction — or latching per instance — would therefore fire a `/health` request per keystroke, i.e.
 *     put a network call on the hottest path in the system. The latch is keyed on the ORIGIN at module scope
 *     precisely so that construction pattern collapses to one probe per process.
 *   - **After a response, not before it,** so the one-shot is not spent on an origin we never reached. If the
 *     transport is failing there is nothing to learn and no point asking.
 *   - **Fire-and-forget, never awaited,** so it adds exactly zero latency to the caller's request.
 *
 * ⚠️ ACCEPTED CONSEQUENCE, recorded rather than hidden: because the latch is claimed on ATTEMPT, a probe that
 * fails (or races a deploy) means no skew signal for the remaining life of that process. That is the right
 * trade — the alternative is re-probing, which reintroduces the per-request network call this design exists to
 * avoid — and the cost is bounded, because the signal is diagnostic and the process is replaced on the next
 * deploy.
 *
 * ⚠️ SECOND COPY, RECORDED RATHER THAN HIDDEN. `packages/clients/recipe-service/src/contract-skew.ts` is the
 * equivalent for the recipe contract, and the three services each carry a copy of the sibling BOOT predicate.
 * The right home for all of it is ONE zero-dependency leaf package. It is not extracted here because this
 * module is bundled into the web app (`next.config.ts` `transpilePackages` is an explicit allowlist) and into
 * the released MOBILE binary via the recipe client, so introducing a new workspace package on this path is a
 * bundler-resolution change that cannot be verified without a real device/bundle build — an unacceptable risk
 * to take in service of a diagnostic. Extracting it belongs in a dedicated change that can prove the bundle.
 *
 * DESIGN PATTERN: Specification (a pure verdict predicate) + a fire-and-forget Command with an idempotence
 * latch. The verdict, the message, and the probe are separated so the DECISION is testable without a socket.
 */
import { CONTRACT_HASH } from '@kitchensink/schema-food';

/** A lower-case hex SHA-256 — the shape of every fingerprint the contract generator emits. */
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/** How many leading hex characters a warning prints. Matches the generator's own `slice(0, 12)` log format. */
const HASH_PREVIEW_LENGTH = 12;

/**
 * Upper bound (ms) on the skew probe. It is not the client's request timeout: this is a background diagnostic,
 * so it gets its own short leash and is abandoned rather than allowed to hold a socket open.
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
    /** The food service origin, with no trailing slash (the client normalizes it before passing it). */
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
 * Pure. Both sides must be a well-formed lower-case 64-hex SHA-256 for the comparison to mean anything: a bare
 * equality test would happily "match" two empty strings or two `undefined`s coerced to a string, and would
 * report a truncated or absent value as a MISMATCH — the exact false positive that would make every
 * pre-publication deployment noisy. Anything unusable on either side is {@link ContractSkewVerdict}
 * `indeterminate`.
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
 * Pure. It names BOTH fingerprints and which side each belongs to, states that nothing is blocked, and gives
 * the remedy — a warning a reader cannot act on is noise, and one that reads like an outage sends someone
 * hunting a problem that is not happening.
 *
 * @param pinned - The fingerprint this client was built against.
 * @param served - The fingerprint the service published.
 * @param healthUrl - The probe URL, so the message identifies WHICH deployment disagreed.
 * @returns The multi-line warning.
 */
export function formatContractSkewWarning(pinned: string, served: string, healthUrl: string): string {
    return (
        'CONTRACT SKEW (warning — nothing is blocked): this client was built against a different wire ' +
        'contract than the food service is serving, so a field one side expects may be absent or changed. ' +
        'Requests continue normally.\n' +
        `  client  (@kitchensink/schema-food CONTRACT_HASH): ${pinned.slice(0, HASH_PREVIEW_LENGTH)}…\n` +
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
 * Resolves — never rejects — on every path: a transport failure, a non-`200`, a non-JSON body, an absent or
 * malformed fingerprint, and a `warn` callback that throws all resolve to silence. That total containment is
 * the point: this is a diagnostic, and a diagnostic that can fail a caller is a defect.
 *
 * The probe is UNAUTHENTICATED. `/health` is public precisely so a consumer can ask about skew before it holds
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
        // Deliberately total. Every failure mode above — DNS, refused connection, abort, a malformed body, a
        // throwing `warn` — means "no usable skew signal", and a diagnostic reports that by saying nothing.
    }
}

/**
 * Origins whose fingerprint has already been probed in this process, keyed by origin + pinned hash.
 *
 * ── WHY MODULE SCOPE RATHER THAN PER CLIENT INSTANCE ──
 *
 * Because a `FoodServiceClient` instance is not the right unit. The recipe service's `FoodServiceClients`
 * factory mints one per request — and one PER KEYSTROKE for the typeahead — so a per-instance latch would put
 * a `/health` request on the per-keystroke path. Keying on the origin makes "once" mean once per process,
 * which is what the warning actually wants to be.
 *
 * The pinned hash is part of the key so the entry describes the comparison that was made, not merely the host
 * that was asked. (Within one process `CONTRACT_HASH` is a build-time constant, so this is documentation of
 * intent rather than live variation — but it is what makes the key honest about what has been decided.)
 *
 * Vitest gives each test FILE a fresh module registry, so this state does not leak between test files;
 * {@link resetContractSkewLatchForTests} clears it between CASES.
 */
const probedOrigins = new Set<string>();

/**
 * Clear the once-per-origin latch. **Test seam only** — never call this from production code.
 *
 * Without it, whichever test ran first would consume the latch and every later test in the file would
 * silently observe "no probe", passing for the wrong reason. Mirrors `resetConfigCacheForTests` in
 * `identity-webhooks`.
 *
 * @sideEffect Empties the module-scope probed-origin set.
 */
export function resetContractSkewLatchForTests(): void {
    probedOrigins.clear();
}

/**
 * Run the skew comparison for this origin at most once per process, off the caller's critical path.
 *
 * Synchronous and returns `void` BY DESIGN: there is no promise for a caller to accidentally `await`, so it
 * cannot add latency to a request even by mistake.
 *
 * The latch is claimed BEFORE the first `await` — that ordering is load-bearing. A burst of concurrent first
 * calls (again: one client per keystroke) would otherwise all pass the membership test before any of them had
 * yielded, and each would fire its own probe.
 *
 * @param options - Origin, `fetch`, warning sink, and an optional deadline.
 * @sideEffect Records the origin as probed and may issue one unauthenticated `GET {baseUrl}/health`.
 */
export function reportContractSkewOnce(options: ContractSkewProbeOptions): void {
    const key = `${options.baseUrl} ${CONTRACT_HASH}`;

    if (probedOrigins.has(key)) {
        return;
    }

    probedOrigins.add(key);

    // `checkContractSkew` cannot reject, but the `.catch` stays: it is what guarantees no unhandled rejection
    // can ever escape this line, even if that invariant is broken later. `try` covers a `fetch` double that
    // throws synchronously.
    try {
        void checkContractSkew(options).catch(() => undefined);
    } catch {
        // Same containment as inside the probe: a diagnostic never propagates.
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

        const body: unknown = JSON.parse(await response.text());

        return typeof body === 'object' && body !== null
            ? (body as { contractHash?: unknown }).contractHash
            : undefined;
    } finally {
        clearTimeout(timer);
    }
}
