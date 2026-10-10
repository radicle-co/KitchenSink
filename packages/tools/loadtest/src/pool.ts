/**
 * The k6 credential pool's PURE decisions about stored sessions.
 *
 * ⚠️ The ROSTER no longer lives here. Which users the pool addresses is the fixed test pool's
 * (`@kitchensink/e2e-fixtures/testPool`), shared with every other tier, and only `poolAdmin` creates them; what
 * remains is the one decision `../provisionPool.ts` makes about its own persisted handles.
 */

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
