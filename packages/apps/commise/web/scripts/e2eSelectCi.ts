/**
 * CI step: decides which web specs run and how many shards they need, and writes both to `$GITHUB_OUTPUT`.
 *
 *   tsx scripts/e2eSelectCi.ts
 *
 * The selection is the selector's own answer, judged by `e2eLanes.ts`'s `decideSpecs`, so CI and a developer's door cannot
 * disagree about which specs a change affects. The shard count is `@kitchensink/e2e-plan`'s `webShardCount`, capped by the web pool.
 * `FULL_SUITE=1` runs everything. Outputs: `web_tests`, `web_specs`, `web_shards`.
 */
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { POOL_ROSTER } from '@kitchensink/e2e-fixtures/testPool';
import { webSelectionOutputs, type WebSelection } from '@kitchensink/e2e-plan/ciMatrix';
import { runPlan } from '@kitchensink/e2e-plan/runPlan';

import { countTests, decideSpecs, flattenReport, listTests, specFilters, type ReportedTest } from './e2eLanes.js';

/** Tests one CI shard should hold. Setup costs about 35 s per shard, so a shard under this is mostly setup. */
export const WEB_TESTS_PER_SHARD = 14;

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../..');

type Env = Readonly<Record<string, string | undefined>>;
type WebTier = Awaited<ReturnType<typeof runPlan>>['web'];

/** What the selection needs from the outside world, so each branch can be tested without git or Playwright. */
export interface SelectDeps {
    /** The selector's answer for the web tier. May throw. */
    readonly plan: () => Promise<WebTier>;
    /** Lists the tests of the named specs. May throw. */
    readonly listSpecs: (ids: readonly string[]) => readonly ReportedTest[];
    /** How many tests the whole suite lists. */
    readonly countAll: () => number;
}

/**
 * Fails SAFE, as the local door does: a selector that cannot answer, or a spec that lists no test, selects everything.
 * The judgement of the specs is `decideSpecs`, the local door's own, so the two cannot differ.
 *
 * @param deps - The selector and the lister.
 * @returns What the web matrix reads.
 */
export async function selectWeb(deps: SelectDeps): Promise<WebSelection> {
    let web: WebTier;

    try {
        web = await deps.plan();
    } catch (error) {
        console.warn(
            `warning: the selector failed (${error instanceof Error ? error.message : String(error)}); running every spec`,
        );

        return { kind: 'unselected', tests: deps.countAll() };
    }

    const decision = decideSpecs(web, deps.listSpecs);

    if (decision.kind === 'none') {
        return { kind: 'none' };
    }

    if (decision.kind === 'unselected') {
        return { kind: 'unselected', tests: deps.countAll() };
    }

    return { kind: 'specs', filters: specFilters(web.kind === 'some' ? web.ids : []), tests: decision.tests.length };
}

const realDeps = (env: Env): SelectDeps => ({
    plan: async () => (await runPlan(REPO_ROOT, env as NodeJS.ProcessEnv)).web,
    listSpecs: (ids) => flattenReport(listTests(specFilters(ids), undefined, env)),
    countAll: () => countTests(listTests([], undefined, env)),
});

async function main(): Promise<void> {
    const outputs = webSelectionOutputs(
        await selectWeb(realDeps(process.env)),
        WEB_TESTS_PER_SHARD,
        POOL_ROSTER.web.length,
    );
    const lines = Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join('');
    const target = process.env['GITHUB_OUTPUT'];

    if (target === undefined || target === '') {
        process.stdout.write(lines);
    } else {
        appendFileSync(target, lines);
    }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
