/**
 * EVERY DISCOVER SEARCH A FLOW RUNS REACHES ONLY ITS OWN LANE'S DATA.
 *
 * CI runs the deployed Maestro suite as concurrent lanes (one per shard and platform) against ONE sandbox, and every
 * lane's co-author seeds the same public recipes under its own run key. Discover searches PUBLIC data, so a query
 * without the lane's key matches every lane's copy. One lane on a laptop sees one copy, so the flow passes there, and
 * in CI the lane's own card falls below the fold: run 39165813897 matched 10 to 12 "Herb Risotto" cards and failed
 * `searchNavigation` and `discoverSaveCopy`. A local pass must predict a CI pass, so this class is refused here
 * rather than found by a red CI run.
 *
 * Two rules, over every committed flow, parsed as YAML (not grepped, so comments and quoting cannot hide a call):
 *
 *   1. Every call to `common/searchDiscover.yaml` passes a QUERY containing `${E2E_RUN_KEY}`, or a query on the closed
 *      allowlist below, each of which matches nothing by construction.
 *   2. No other flow types into the Discover field itself, so rule 1 covers every Discover search.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FLOW_ROOT = 'packages/apps/commise/mobile/.maestro';
const SEARCH_FLOW = 'common/searchDiscover.yaml';
const RUN_KEY = '${E2E_RUN_KEY}';

/** Queries that need no run key, because no recipe on any lane can match them. Closed: an entry is a reviewed edit. */
const UNSCOPED_ALLOWED: Readonly<Record<string, string>> = {
    zzzznosuchrecipe: 'the no-match probe: it must find nothing, on every lane',
};

/** One call to the Discover search flow. */
interface SearchCall {
    readonly file: string;
    readonly query: string | undefined;
}

/** Every node in a parsed YAML value, depth first. Pure. */
function* walk(value: unknown): Generator<unknown> {
    yield value;

    if (Array.isArray(value)) {
        for (const item of value) {
            yield* walk(item);
        }
    } else if (value !== null && typeof value === 'object') {
        for (const item of Object.values(value)) {
            yield* walk(item);
        }
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Every call to the Discover search flow in one flow's source, with the QUERY it passes. Pure.
 *
 * @param file - The flow's path, for the report.
 * @param source - The flow's YAML.
 * @returns One entry per `runFlow` whose file is the search flow.
 */
export function searchCallsIn(file: string, source: string): readonly SearchCall[] {
    return parseAllDocuments(source).flatMap((document) =>
        [...walk(document.toJS())].flatMap((node): SearchCall[] => {
            if (!isRecord(node) || !isRecord(node['runFlow'])) {
                return [];
            }

            const call = node['runFlow'];
            const target = call['file'];

            if (typeof target !== 'string' || !target.endsWith(SEARCH_FLOW)) {
                return [];
            }

            const env = isRecord(call['env']) ? call['env'] : {};
            const query = env['QUERY'];

            return [{ file, query: typeof query === 'string' ? query : undefined }];
        }),
    );
}

/**
 * The calls whose query can match another lane's recipes. Pure.
 *
 * @param calls - Every search call found.
 * @returns One message per call that is neither scoped by the run key nor allowlisted.
 */
export function unscopedCalls(calls: readonly SearchCall[]): readonly string[] {
    return calls
        .filter(({ query }) => query === undefined || !(query.includes(RUN_KEY) || query in UNSCOPED_ALLOWED))
        .map(({ file, query }) => `${file}: QUERY ${JSON.stringify(query)} does not contain ${RUN_KEY}`);
}

/**
 * Whether a flow types into the Discover field itself: an `inputText` straight after a tap on the field. Pure.
 *
 * @param source - The flow's YAML.
 * @returns True when the flow bypasses the search flow.
 */
export function typesIntoDiscoverField(source: string): boolean {
    return parseAllDocuments(source).some((document) => {
        const steps: unknown = document.toJS();

        if (!Array.isArray(steps)) {
            return false;
        }

        return steps.some(
            (step, index) =>
                isRecord(step) &&
                step['tapOn'] === 'Search recipes' &&
                isRecord(steps[index + 1]) &&
                'inputText' in (steps[index + 1] as Record<string, unknown>),
        );
    });
}

/** Every committed flow, repo-relative. */
function flowFiles(): readonly string[] {
    return execFileSync('git', ['ls-files', `${FLOW_ROOT}/**/*.yaml`, `${FLOW_ROOT}/*.yaml`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((line) => line.length > 0);
}

describe('the rules themselves', () => {
    const call = (query: string): string =>
        `appId: x\n---\n- runFlow:\n      file: common/searchDiscover.yaml\n      env:\n          QUERY: '${query}'\n`;

    it('accepts a query carrying the run key', () => {
        expect(unscopedCalls(searchCallsIn('a.yaml', call('Risotto ${E2E_RUN_KEY}')))).toEqual([]);
    });

    it('refuses a bare word, which every lane’s copy of the recipe answers', () => {
        expect(unscopedCalls(searchCallsIn('a.yaml', call('Risotto')))).toHaveLength(1);
    });

    it('accepts an allowlisted no-match probe and refuses a call with no QUERY at all', () => {
        expect(unscopedCalls(searchCallsIn('a.yaml', call('zzzznosuchrecipe')))).toEqual([]);
        expect(
            unscopedCalls(
                searchCallsIn('a.yaml', 'appId: x\n---\n- runFlow:\n      file: common/searchDiscover.yaml\n'),
            ),
        ).toHaveLength(1);
    });

    it('finds a call nested inside a conditional block, and ignores one that is only in a comment', () => {
        const nested = `appId: x\n---\n- runFlow:\n      when:\n          platform: iOS\n      commands:\n          - runFlow:\n                file: common/searchDiscover.yaml\n                env:\n                    QUERY: 'Risotto'\n`;
        const commented = `appId: x\n---\n# - runFlow: { file: common/searchDiscover.yaml, env: { QUERY: 'Risotto' } }\n- tapOn: 'Discover'\n`;

        expect(searchCallsIn('a.yaml', nested)).toHaveLength(1);
        expect(searchCallsIn('a.yaml', commented)).toEqual([]);
    });

    it('sees a flow that types into the Discover field without the search flow', () => {
        expect(typesIntoDiscoverField("appId: x\n---\n- tapOn: 'Search recipes'\n- inputText: 'Risotto'\n")).toBe(true);
        expect(typesIntoDiscoverField("appId: x\n---\n- tapOn: 'Search recipes'\n- eraseText\n")).toBe(false);
    });
});

describe('every Discover search in the suite is scoped to its lane', () => {
    const flows = flowFiles().map((file) => ({ file, source: readFileSync(join(REPO_ROOT, file), 'utf8') }));
    const calls = flows.flatMap(({ file, source }) => searchCallsIn(file, source));

    it('finds the search calls at all — a vacuous pass would assert nothing', () => {
        expect(calls.length).toBeGreaterThanOrEqual(8);
    });

    it('passes the run key in every query that could match a recipe', () => {
        expect(unscopedCalls(calls)).toEqual([]);
    });

    it('still uses every allowlisted query, so the allowlist cannot grow stale', () => {
        const used = new Set(calls.map(({ query }) => query));

        expect(Object.keys(UNSCOPED_ALLOWED).filter((query) => !used.has(query))).toEqual([]);
    });

    it('types into the Discover field only through the search flow', () => {
        expect(
            flows
                .filter(({ file }) => !file.endsWith(SEARCH_FLOW))
                .filter(({ source }) => typesIntoDiscoverField(source))
                .map(({ file }) => file),
        ).toEqual([]);
    });
});
