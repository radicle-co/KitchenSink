/**
 * The k6 credential pool's roster and the decisions about it that are PURE.
 *
 * Everything here is a fact about WHICH identities the pool addresses, kept separate from the network work
 * in `../provisionPool.ts` so it can be asserted without a Clerk instance — see
 * `packages/infra/global/__tests__/loadtestPool.test.ts` for what the two rules below actually protect.
 */

/**
 * Stable names → stable addresses, so the pool is deterministic and REUSED across runs rather than
 * re-created. Reuse is not tidiness: each new sign-in costs a per-IP-throttled Frontend API call, and each
 * new user is another row on the shared dev instance that `sweep.mjs` has to reclaim.
 */
export const POOL_NAMES = [
    'alfa',
    'bravo',
    'charlie',
    'delta',
    'echo',
    'foxtrot',
    'golf',
    'hotel',
    'india',
    'juliett',
    'kilo',
    'lima',
    'mike',
    'november',
    'oscar',
    'papa',
    'quebec',
    'romeo',
    'sierra',
    'tango',
] as const;

/** A pool member's address. */
export type PoolName = (typeof POOL_NAMES)[number] | 'admin';

/**
 * The Clerk address for a pool member.
 *
 * ⛔ The `+clerk_test` subaddress is LOAD-BEARING, not a naming convention. The pool signs in with the
 * email-code first factor and the fixed dev code; a plain address does not accept it, sends real mail, and
 * counts against the instance's monthly quota. The `test-` prefix and the domain are equally load-bearing
 * in the other direction — they are what `sweep.mjs` matches, and an address it does not match is a user
 * nobody ever reclaims from an instance every preview shares.
 *
 * @param name - A roster name.
 * @param domain - The mail domain, which must be one `sweep.mjs` covers.
 * @returns The address to find-or-create.
 */
export function poolEmail(name: string, domain: string): string {
    return `test-${name}+clerk_test@${domain}`;
}

/** Which roster names already have a session, and which must pay a throttled sign-in. */
export interface HandlePartition {
    /** Names whose stored handle can be re-minted from — no sign-in. */
    readonly reuse: readonly string[];
    /** Names with no usable handle, which must sign in. */
    readonly establish: readonly string[];
}

/**
 * Split `names` by whether `stored` already holds a handle for them.
 *
 * TOTAL and DISJOINT over `names` by construction: every requested name lands in exactly one side, so a
 * name cannot fall through and leave the run one token short of its VU count. A stored entry for a name
 * that is NOT requested is ignored rather than resurrected — shrinking the pool must shrink the run.
 *
 * @param stored - Whatever was previously persisted per roster name; only its PRESENCE is read.
 * @param names - The names this run wants.
 * @returns The partition.
 */
export function partitionHandles<T>(
    stored: Readonly<Record<string, T | null | undefined>>,
    names: readonly string[],
): HandlePartition {
    // `null` counts as ABSENT as well as `undefined`: the store is JSON on disk, so a null is what a
    // half-written or hand-edited file produces, and treating it as present mints nothing for that name.
    const held = (name: string): boolean => stored[name] !== undefined && stored[name] !== null;

    return { reuse: names.filter(held), establish: names.filter((name) => !held(name)) };
}

/**
 * The Clerk username for a pool member, DERIVED from the same address {@link poolEmail} produces.
 *
 * ⛔ MEASURED, run 34017385400 (2026-09-06). The first live provision died on
 * `422 form_identifier_exists / param_name: username`. The address had moved to a `+clerk_test`
 * subaddress while the username stayed `test_${name}` — and the PREVIOUS pool's users, minted at the plain
 * address, still hold that username on the shared instance. Find-by-email missed them; create-by-username
 * collided with them. Username is unique in Clerk, so deriving both identifiers from one input is what
 * stops them drifting apart; hard-coding a second pattern is what let them.
 *
 * @param name - A roster name.
 * @returns The username: the address's local part, with every non-alphanumeric run collapsed to `_`.
 */
export function poolUsername(name: string): string {
    const email = poolEmail(name, 'example.invalid');

    return email.slice(0, email.indexOf('@')).replace(/[^a-z0-9]+/gu, '_');
}
