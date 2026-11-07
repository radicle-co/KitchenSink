export interface PackInput {
    /** The tests to run, one id each (a repeated id is one entry: its tests travel together). */
    readonly ids: readonly string[];
    /** Recorded duration per id, in milliseconds. */
    readonly durations: Readonly<Record<string, number>>;
    readonly laneCount: number;
    /** What a test with no recorded duration is assumed to take. */
    readonly defaultMs: number;
}

export interface Packing {
    /** One list of ids per lane. Never empty, so there can be fewer than `laneCount`. */
    readonly lanes: readonly (readonly string[])[];
    /** The estimated duration of each lane. */
    readonly estimateMs: readonly number[];
    /** The ids that had no recorded duration and were given the default. */
    readonly defaulted: readonly string[];
}

/**
 * Splits tests across lanes so the lanes finish together: longest first, each onto the lightest lane (LPT greedy,
 * within 4/3 of the best possible split). Ties break on the id, so the same input always packs the same way. Pure.
 *
 * @param input - The tests, their durations and the lane count.
 * @returns The lanes, their estimates, and the ids whose duration was assumed.
 */
export function packLanes(input: PackInput): Packing {
    const unique = [...new Set(input.ids)].sort();
    const defaulted = unique.filter((id) => input.durations[id] === undefined);
    const weighted = unique
        .map((id) => ({ id, ms: input.durations[id] ?? input.defaultMs }))
        .sort((a, b) => b.ms - a.ms || a.id.localeCompare(b.id));
    const count = Math.max(1, Math.min(input.laneCount, weighted.length));
    const lanes: string[][] = Array.from({ length: count }, () => []);
    const estimateMs: number[] = Array.from({ length: count }, () => 0);

    for (const { id, ms } of weighted) {
        const lightest = estimateMs.indexOf(Math.min(...estimateMs));

        lanes[lightest]?.push(id);
        estimateMs[lightest] = (estimateMs[lightest] ?? 0) + ms;
    }

    return weighted.length === 0 ? { lanes: [], estimateMs: [], defaulted } : { lanes, estimateMs, defaulted };
}

/**
 * Compares a duration table with the tests that exist.
 *
 * @param ids - The ids of the tests listed now.
 * @param durations - The committed table.
 * @returns The listed tests with no duration, and the durations for tests that are gone.
 */
export function staleDurations(
    ids: readonly string[],
    durations: Readonly<Record<string, number>>,
): { readonly missing: readonly string[]; readonly unused: readonly string[] } {
    const listed = new Set(ids);

    return {
        missing: [...listed].filter((id) => durations[id] === undefined).sort(),
        unused: Object.keys(durations)
            .filter((id) => !listed.has(id))
            .sort(),
    };
}
