/**
 * Prints which Playwright specs and Maestro flows a change affects, and why.
 *
 *   npm run e2e:plan [-- --repo <path>] [-- --base <ref>] [-- --json | --tier web|mobile]
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
import { idsOf, renderPlan } from '../src/render.js';
import { loadRepoModels } from '../src/repoModels.js';
import { tierLines, toPlanJson } from '../src/planJson.js';
import { fullPlan, type Plan } from '../src/selection.js';

const { values } = parseArgs({
    options: {
        repo: { type: 'string', default: process.cwd() },
        base: { type: 'string' },
        json: { type: 'boolean', default: false },
        tier: { type: 'string' },
    },
});

const repo = resolve(values.repo ?? process.cwd());
const base = values.base ?? process.env['TURBO_SCM_BASE'] ?? 'origin/main';

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

    if (values.tier === 'web' || values.tier === 'mobile') {
        // For a shell: `all`, or `some` and the ids in the tier's own order (the Maestro plan's order matters). The
        // reasons go to stderr so a person sees them and a pipe does not.
        const selection = plan[values.tier];

        if (selection.kind === 'all') {
            selection.reasons.slice(0, 10).forEach((reason) => process.stderr.write(`  ${reason}\n`));
            process.stdout.write(tierLines({ kind: 'all', reasons: selection.reasons }));
        } else {
            const order = models?.[values.tier].tests ?? [];

            process.stdout.write(
                tierLines({
                    kind: 'some',
                    ids: order.length > 0 ? idsOf(selection, order) : selection.picks.map((pick) => pick.id),
                }),
            );
        }

        return;
    }

    if (values.json) {
        process.stdout.write(`${toPlanJson(plan)}\n`);

        return;
    }

    // The inventory only labels "N of M"; a failure to build it must not hide the plan.
    models ??= await loadRepoModels(repo).catch(() => undefined);
    process.stdout.write(
        renderPlan(plan, { web: models?.web.tests ?? [], mobile: models?.mobile.tests ?? [] }, { base, changed }),
    );
}

await main();
