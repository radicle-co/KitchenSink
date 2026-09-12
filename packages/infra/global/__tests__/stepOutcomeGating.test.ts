// @vitest-environment node
/**
 * Repo-wide guard: a step that reads a predecessor's OUTPUT, and that suppresses GitHub's implicit
 * `success()`, must also assert that the predecessor SUCCEEDED.
 *
 * ## The mechanism, which is not obvious and bites in the destructive direction
 *
 * Three GitHub behaviours compose into a fail-open:
 *
 * 1. A step that exits non-zero before writing `$GITHUB_OUTPUT` leaves its outputs UNSET.
 * 2. An unset output is the empty string in an `if:` expression — indistinguishable from a step that ran
 *    fine and legitimately produced `''`.
 * 3. An `if:` containing ANY status-check function (`always()`, `!cancelled()`, `failure()`) drops the
 *    implicit `success()` GitHub otherwise applies. So `if: !cancelled() && steps.x.outputs.y == ''` RUNS
 *    after `x` has failed.
 *
 * Together: a guard written as "abort rather than conclude wrongly" produces exactly the wrong conclusion,
 * and the abort is what produces it.
 *
 * ## The incident this was written from
 *
 * `sandbox-reconcile.yml` asks whether any per-PR preview is live, and — when none is — DELETES the shared
 * sandbox ALB and the identity service every preview signs in against. Its discovery step was given a
 * fail-closed guard: `list-stacks` failing runs `echo '::error::refusing to conclude the shared tier is
 * idle'; exit 1`. That exit happens BEFORE the `$GITHUB_OUTPUT` write, so `live` is unset, so `''`, so the
 * two downstream steps — both carrying `!cancelled()` — ran anyway, found nothing busy (the normal state),
 * and reclaimed the shared tier. A CloudFormation hiccup at :17 past any hour would have taken down the
 * tier every open preview depends on, with the run's own logs stating it had refused to do so.
 *
 * ⛔ `!cancelled()` is NOT the defect and must not be removed — `sandboxReclamationReachability.test.ts`
 * requires it, because a failed predecessor silently skipping reclamation is the OTHER incident this
 * repository has already paid for (9 PRs' infrastructure, 11 dead reaper runs). Both rules hold together:
 * run on your own merits, AND do not act on a number nobody computed. That is what `outcome` expresses.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { WORKFLOWS_DIR } from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

/** Functions whose presence in an `if:` suppresses GitHub's implicit `success()`. */
const STATUS_FUNCTIONS = /\b(?:always|cancelled|failure)\s*\(\s*\)/u;

/**
 * A read of a predecessor's output that the EMPTY STRING SATISFIES.
 *
 * ⛔ Polarity is the whole rule, not a detail. An unset output is `''`, so:
 *
 *   `steps.x.outputs.y == ''`      — unset SATISFIES it; the step runs on a value nobody computed. Unsafe.
 *   `steps.x.outputs.y != 'true'`  — unset satisfies it too. Unsafe, same shape.
 *   `steps.x.outputs.y != ''`      — unset does NOT satisfy; the step skips. Safe, and the common form.
 *
 * `_ci-heavy.yml` publishes its k6 reports under `always() && steps.live.outputs.recipe != ''`, which is
 * correct and must not be flagged: if the probe died there is nothing to publish and the step rightly does
 * not run. A guard that demanded an `outcome` check there would be noise, and noise is what gets a guard
 * deleted before it catches the case that matters.
 *
 * ⚠️ Built fresh at each use rather than shared as a `/g` module constant. A global regex carries
 * `lastIndex` across calls, so `.test()` on one alternates true/false down a list — which made the first
 * version of this guard pass over the very step it was written for.
 */
const outputRead = (): RegExp =>
    /steps\.([A-Za-z_][A-Za-z0-9_-]*)\.outputs\.[A-Za-z0-9_-]+\s*(?:==\s*''|!=\s*'[^']+')/gu;

interface Step {
    readonly workflow: string;
    readonly job: string;
    readonly name: string;
    readonly if: string;
}

/** Every step in every tracked workflow that carries an `if:`. */
function gatedSteps(): readonly Step[] {
    return trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .flatMap((file) => {
            const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                jobs?: Record<string, { steps?: { name?: string; if?: string }[] }>;
            } | null;

            return Object.entries(doc?.jobs ?? {}).flatMap(([job, body]) =>
                (body.steps ?? [])
                    .filter((step) => typeof step.if === 'string')
                    .map((step) => ({
                        workflow: path.basename(file),
                        job,
                        name: step.name ?? '(unnamed)',
                        if: step.if ?? '',
                    })),
            );
        });
}

describe('a step that acts on a predecessor’s output checks that it succeeded', () => {
    const subjects = (): readonly Step[] =>
        gatedSteps().filter((step) => STATUS_FUNCTIONS.test(step.if) && outputRead().test(step.if));

    it('finds the steps this applies to', () => {
        // Non-vacuity. Every assertion below filters this population, so a derivation that stopped matching
        // would report perfect compliance.
        expect(subjects().length).toBeGreaterThan(0);
    });

    it('every such step also asserts the producing step’s outcome', () => {
        const unguarded = subjects().flatMap((step) => {
            const producers = [...new Set([...step.if.matchAll(outputRead())].map((match) => match[1] ?? ''))];

            return producers
                .filter((producer) => !new RegExp(`steps\\.${producer}\\.(?:outcome|conclusion)`, 'u').test(step.if))
                .map(
                    (producer) =>
                        `${step.workflow}:${step.job} » "${step.name}" reads steps.${producer}.outputs.* under a ` +
                        `status-check function, but never checks steps.${producer}.outcome — an unset output ` +
                        `is '' and is indistinguishable from a real ''`,
                );
        });

        expect(unguarded).toEqual([]);
    });
});
