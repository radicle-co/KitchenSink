import type { TierJson } from './planJson.js';

const isCount = (value: number): boolean => Number.isInteger(value) && value >= 0;

/**
 * How many web shards CI runs: enough for `perShard` tests each, never more than the pool has lanes, none for none.
 * Pure. The workflow does no arithmetic of its own, so this is the one place the web matrix is sized.
 *
 * @param listed - Tests the selection lists.
 * @param perShard - Tests one shard should hold.
 * @param rosterLanes - Lanes the web pool declares (`POOL_ROSTER.web.length`). Shard N signs in as lane N.
 * @returns The shard count, from 0 to `rosterLanes`.
 * @throws When an input is not a whole number in range. A guessed size could run a shard the pool cannot identify.
 */
export function webShardCount(listed: number, perShard: number, rosterLanes: number): number {
    if (!isCount(listed) || !isCount(rosterLanes) || !Number.isInteger(perShard) || perShard < 1) {
        throw new Error(
            `error: cannot size the web matrix from listed=${listed} perShard=${perShard} lanes=${rosterLanes}`,
        );
    }

    return Math.min(rosterLanes, Math.ceil(listed / perShard));
}

/**
 * The matrix `shard:` value for a count.
 *
 * @param count - Shards to run.
 * @returns JSON text such as `[1,2,3]`.
 */
export const webShardMatrix = (count: number): string =>
    JSON.stringify(Array.from({ length: count }, (_, index) => index + 1));

const FLOW_ID = /^[A-Za-z0-9_][A-Za-z0-9_/.-]*$/;

/**
 * The Maestro selector string for a tier answer. The whole suite is the empty selector, which the runner reads as
 * every flow. A list becomes one `flow:<id>=true` key per flow.
 *
 * @param tier - The mobile tier of the plan.
 * @returns The selector text.
 * @throws When an id has a character that would split the selector into more arguments.
 */
export function maestroSelector(tier: TierJson): string {
    if (tier.kind === 'all') {
        return '';
    }

    const bad = tier.ids.find((id) => !FLOW_ID.test(id));

    if (bad !== undefined) {
        throw new Error(`error: the flow id ${JSON.stringify(bad)} cannot be written as a selector key`);
    }

    return tier.ids.map((id) => `flow:${id}=true`).join(' ');
}

/** What the web selection step found. `filters` are the Playwright file filters that match exactly the chosen specs. */
export type WebSelection =
    | { readonly kind: 'none' }
    | { readonly kind: 'specs'; readonly filters: readonly string[]; readonly tests: number }
    | { readonly kind: 'unselected'; readonly tests: number };

/**
 * The step outputs the web matrix reads: how many tests, which spec filters (empty for the whole suite), the shards.
 *
 * @param selection - What the selection found.
 * @param perShard - Tests one shard should hold.
 * @param rosterLanes - Lanes the web pool declares.
 * @returns Output names and values, as the workflow reads them.
 */
export function webSelectionOutputs(
    selection: WebSelection,
    perShard: number,
    rosterLanes: number,
): Readonly<Record<'web_tests' | 'web_specs' | 'web_shards', string>> {
    const tests = selection.kind === 'none' ? 0 : selection.tests;

    return {
        web_tests: String(tests),
        web_specs: selection.kind === 'specs' ? selection.filters.join(' ') : '',
        web_shards: webShardMatrix(webShardCount(tests, perShard, rosterLanes)),
    };
}

/**
 * The step outputs the Maestro tier reads. A list of no flows must not become the empty selector, which the runner
 * reads as every flow, so it switches the tier off instead.
 *
 * @param tier - The mobile tier of the plan.
 * @returns Output names and values.
 */
export function maestroOutputs(tier: TierJson): Readonly<Record<'maestro_run' | 'maestro_selector', string>> {
    const run = tier.kind === 'all' || tier.ids.length > 0;

    return { maestro_run: String(run), maestro_selector: run ? maestroSelector(tier) : '' };
}
