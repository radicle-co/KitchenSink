/**
 * Prints which Playwright specs and Maestro flows a change affects, and why.
 *
 *   npm run e2e:plan [-- --repo <path>] [-- --base <ref>] [-- --platform web|android|ios] [-- --json | --tier web|mobile]
 *
 * The change is measured from, in order: `--base` or `TURBO_SCM_BASE`; in CI or with no `--platform`, `origin/main`;
 * otherwise the tree of the last fully passing local run for this branch and platform (ADR-0086). With no such
 * stamp the whole suite runs, and with a stamp and no change nothing runs.
 *
 * With `--json` it prints one object, `{ web, mobile, warnings }`, where a tier is `{ kind: 'all', reasons }` (run
 * the whole tier; no list) or `{ kind: 'some', ids }` (run these; an empty list means run none).
 *
 * Fails SAFE: if the selector itself fails, it answers the full suite with a warning and exits 0.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { Platform } from '../src/greenStamp.js';
import { onEmptyOf } from '../src/greenStamp.js';
import { planChange, type Models } from '../src/planChange.js';
import { idsOf, renderPlan } from '../src/render.js';
import { loadRepoModels } from '../src/repoModels.js';
import { findRepoRoot } from '../src/repoRoot.js';
import { tierLines, toPlanJson, type BaseJson, type PlanMeta } from '../src/planJson.js';
import { resolveChange } from '../src/resolveChange.js';
import { fullPlan, type Plan } from '../src/selection.js';

const { values } = parseArgs({
    options: {
        repo: { type: 'string' },
        base: { type: 'string' },
        json: { type: 'boolean', default: false },
        tier: { type: 'string' },
        platform: { type: 'string' },
    },
});

const repo = values.repo !== undefined ? resolve(values.repo) : findRepoRoot(process.cwd(), process.env['INIT_CWD']);
const explicitBase = values.base ?? process.env['TURBO_SCM_BASE'];
const PLATFORMS: readonly string[] = ['web', 'android', 'ios'];
const platform = PLATFORMS.includes(values.platform ?? '') ? (values.platform as Platform) : undefined;

async function main(): Promise<void> {
    let plan: Plan;
    let changed = 0;
    let models: Models | undefined;
    let meta: PlanMeta = { base: { kind: 'none', reason: 'the selector failed' }, treeAtStart: null, previous: null };
    let described = explicitBase ?? 'origin/main';

    try {
        const change = await resolveChange({ repo, explicitBase, ci: Boolean(process.env['CI']), platform });
        const base = change.base;

        changed = change.files.length;
        meta = {
            base: baseJson(base),
            treeAtStart: change.tree,
            previous: change.previous ?? null,
        };
        described = describeBase(base);

        if (base.kind === 'none' && process.env['FULL_SUITE'] !== '1') {
            plan = fullPlan(base.reason);
        } else {
            plan = await planChange(
                change.files,
                async () => {
                    models = await loadRepoModels(repo, change.from);

                    return models;
                },
                {
                    fullSuite: process.env['FULL_SUITE'] === '1',
                    onEmpty: base.kind === 'none' ? 'full' : onEmptyOf(base),
                },
            );
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        plan = fullPlan('the selector failed', [`the selector failed (${message}); running everything`]);
    }

    if (meta.base.kind === 'stamp' && meta.base.owed.length > 0) {
        process.stderr.write(`  owed (sandbox-only flows not yet run): ${meta.base.owed.join(', ')}\n`);
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
        process.stdout.write(`${toPlanJson(plan, meta)}\n`);

        return;
    }

    // The inventory only labels "N of M"; a failure to build it must not hide the plan.
    models ??= await loadRepoModels(repo).catch(() => undefined);
    process.stdout.write(
        renderPlan(
            plan,
            { web: models?.web.tests ?? [], mobile: models?.mobile.tests ?? [] },
            { base: described, changed },
        ),
    );
}

await main();

function baseJson(base: Awaited<ReturnType<typeof resolveChange>>['base']): BaseJson {
    return base.kind === 'stamp' ? { kind: 'stamp', tree: base.stamp.tree, owed: base.stamp.owed } : base;
}

function describeBase(base: Awaited<ReturnType<typeof resolveChange>>['base']): string {
    return base.kind === 'ref'
        ? base.ref
        : base.kind === 'stamp'
          ? `the last green run (${base.stamp.at})`
          : `no base (${base.reason})`;
}
