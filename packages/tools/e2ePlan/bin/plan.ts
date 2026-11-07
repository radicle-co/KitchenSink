/**
 * Prints which Playwright specs and Maestro flows a change affects, and why.
 *
 *   npm run e2e:plan [-- --repo <path>] [-- --base <ref>] [-- --json]
 *
 * With `--json` it prints one object, `{ web, mobile, warnings }`, where a tier is `{ kind: 'all', reasons }` (run
 * the whole tier; no list) or `{ kind: 'some', ids }` (run these; an empty list means run none).
 *
 * Fails SAFE: if the selector itself fails, it answers the full suite with a warning and exits 0.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { changedFiles } from '../src/gitChangeSet.js';
import { planChange, type Models } from '../src/planChange.js';
import { renderPlan } from '../src/render.js';
import { loadRepoModels } from '../src/repoModels.js';
import { fullPlan, type Plan, type TierSelection } from '../src/selection.js';

const { values } = parseArgs({
    options: {
        repo: { type: 'string', default: process.cwd() },
        base: { type: 'string' },
        json: { type: 'boolean', default: false },
    },
});

const repo = resolve(values.repo ?? process.cwd());
const base = values.base ?? process.env['TURBO_SCM_BASE'] ?? 'origin/main';

const tierJson = (selection: TierSelection): unknown =>
    selection.kind === 'all'
        ? { kind: 'all', reasons: selection.reasons }
        : { kind: 'some', ids: selection.picks.map((pick) => pick.id) };

async function main(): Promise<void> {
    let plan: Plan;
    let changed = 0;
    let models: Models | undefined;

    try {
        const { files, mergeBase } = await changedFiles(repo, base);

        changed = files.length;
        plan = await planChange(
            files,
            async () => {
                models = await loadRepoModels(repo, mergeBase);

                return models;
            },
            { fullSuite: process.env['FULL_SUITE'] === '1' },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        plan = fullPlan('the selector failed', [`the selector failed (${message}); running everything`]);
    }

    if (values.json) {
        process.stdout.write(
            `${JSON.stringify({ web: tierJson(plan.web), mobile: tierJson(plan.mobile), warnings: plan.warnings }, null, 2)}\n`,
        );

        return;
    }

    // The inventory only labels "N of M"; a failure to build it must not hide the plan.
    models ??= await loadRepoModels(repo).catch(() => undefined);
    process.stdout.write(
        renderPlan(plan, { web: models?.web.tests ?? [], mobile: models?.mobile.tests ?? [] }, { base, changed }),
    );
}

await main();
